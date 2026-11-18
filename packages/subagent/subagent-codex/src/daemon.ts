/**
 * Codex daemon-socket transport. Connects the local `codex app-server daemon`
 * control socket and drives one persistent (non-ephemeral) thread/turn, leaving
 * the session materialized on the daemon so the Codex UI can list and resume it.
 *
 * The protocol is the same as the `--stdio` path; only the transport and
 * teardown differ. This module is deliberately a parallel implementation to
 * `startCodexRun` rather than a shared driver: a stdio run owns and terminates a
 * child process, while a socket run owns one connection to a daemon that must
 * stay alive, so their terminal-authority and teardown semantics differ.
 *
 * @module @deepseek-ai/dsh-subagent-codex/daemon
 */

import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { CodexAppServerWire } from './wire.ts'
import {
  CodexRunFailure,
  DEFAULT_DISPOSE_GRACE_MS,
  codexDaemonStartArgv,
  codexStartupFailure,
  failureDiagnostic,
  textTask,
  type CodexFailureFacts,
  type CodexPermissionMode,
} from './run.ts'

/** Fully resolved inputs for one Codex daemon-socket run. */
export interface CodexDaemonRunSpec {
  /** Selected child working directory, also supplied to `thread/start`. */
  readonly cwd: string
  /** Profile-selected native model; omitted to preserve Codex settings. */
  readonly model?: string
  /** Profile-selected native non-interactive permission mode. */
  readonly permissionMode: CodexPermissionMode
  /** Absolute path to the daemon's app-server control socket. */
  readonly socketPath: string
  /** Spawn the managed daemon first when it is not already running. */
  readonly ensureDaemon: boolean
  /** Explicit environment for the optional daemon-start child. */
  readonly env: Record<string, string>
  /** Shared subprocess service spawn operation (used only by `ensureDaemon`). */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed stream/protocol failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/** Codex home base (`CODEX_HOME`, else `$HOME/.codex`), when available. */
function codexHome(): string | undefined {
  const codHome = process.env.CODEX_HOME
  if (codHome !== undefined && codHome !== '') return codHome
  const home = process.env.HOME
  return home === undefined || home === ''
    ? undefined
    : `${home}/.codex`
}

/**
 * Default daemon control socket path, or `undefined` when no Codex home can be
 * derived from the environment.
 * @returns the absolute `app-server-control/app-server-control.sock` path.
 */
export function defaultDaemonSocketPath(): string | undefined {
  const home = codexHome()
  return home === undefined
    ? undefined
    : `${home}/app-server-control/app-server-control.sock`
}

/**
 * Start the managed daemon when `ensureDaemon` selected. The connect below
 * remains the authoritative fail-loud point: a daemon that is already running,
 * or that fails to start here, surfaces at the socket connect with a safe
 * `initialize` diagnostic.
 * @param spec - socket path, environment, and process service.
 * @param signal - unpublished-start cancellation.
 */
async function ensureCodexDaemon(
  spec: CodexDaemonRunSpec,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new Error('subagent-codex: request was aborted before app-server startup')
  }
  const child = spec.spawn({
    argv: codexDaemonStartArgv(),
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: DEFAULT_DISPOSE_GRACE_MS,
    env: spec.env,
  })
  // The `start` subcommand launches the detached daemon and exits; a non-zero
  // exit is not itself the run failure, the subsequent socket connect is.
  await child.done.catch(() => {})
}

/**
 * Connect one socket to the daemon control endpoint, resolving only after the
 * connection is established.
 * @param path - absolute unix socket path.
 * @param signal - unpublished-start cancellation.
 * @returns the connected socket.
 */
function connectDaemonSocket(path: string, signal: AbortSignal): Promise<Socket> {
  if (signal.aborted) {
    return Promise.reject(
      new Error('subagent-codex: request was aborted before app-server startup'),
    )
  }
  return new Promise((resolve, reject) => {
    const socket = connect({ path })
    const onError = (error: Error): void => {
      cleanup()
      reject(codexStartupFailure(error))
    }
    const onConnect = (): void => {
      cleanup()
      resolve(socket)
    }
    const onAbort = (): void => {
      cleanup()
      socket.destroy()
      reject(new Error('subagent-codex: request was aborted before app-server startup'))
    }
    const cleanup = (): void => {
      socket.off('error', onError)
      socket.off('connect', onConnect)
      signal.removeEventListener('abort', onAbort)
    }
    socket.once('error', onError)
    socket.once('connect', onConnect)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Start one persistent Codex run over the local daemon's control socket and
 * publish it after initialization and thread creation.
 * @param request - resolved shared subagent request.
 * @param spec - socket path, workspace, environment, process service, and diagnostic policy.
 * @returns the published run after a non-ephemeral thread exists on the daemon.
 */
export async function startCodexDaemonRun(
  request: SubagentStartRequest,
  spec: CodexDaemonRunSpec,
): Promise<SubagentRun> {
  const texts = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-codex: request was aborted before app-server startup')
  }

  let socket: Socket
  try {
    if (spec.ensureDaemon) {
      await ensureCodexDaemon(spec, request.signal)
    }
    socket = await connectDaemonSocket(spec.socketPath, request.signal)
  } catch (error: unknown) {
    throw error instanceof CodexRunFailure
      ? error
      : codexStartupFailure(error)
  }

  const wire = new CodexAppServerWire(
    socket,
    socket,
    spec.permissionMode,
    spec.model,
  )
  const disposeSocket = async (): Promise<void> => {
    wire.close()
    socket.destroy()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }

  const runAbort = new AbortController()
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-codex: run cancelled locally'))
    wire.interrupt()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  let startupStage: 'initialize' | 'thread-start' = 'initialize'
  try {
    wire.start()
    await wire.initialize(request.signal)
    startupStage = 'thread-start'
    await wire.startThread(spec.cwd, false, request.signal)
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = runAbort.signal.aborted
    const failure = new CodexRunFailure({
      stage: startupStage,
      category: 'unknown',
    }, thrown(error))
    try {
      await disposeSocket()
    } catch (disposeError: unknown) {
      const cleanupFailure = thrown(disposeError)
      throw new AggregateError(
        [failure, cleanupFailure],
        `${failure.message}; ${cleanupFailure.message}`,
      )
    }
    if (cancelledBeforeCleanup) {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    try {
      request.signal.throwIfAborted()
    } catch {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    throw failure
  }

  const collectOutput = (): ContentBlock[] => wire.collectOutput()
  let diagnostic: string | undefined
  const recordFailureDiagnostic = (facts: CodexFailureFacts): string => {
    const failure = failureDiagnostic(facts)
    const permission = wire.collectDiagnostic()
    diagnostic = permission === undefined
      ? failure
      : `${failure}\n${permission}`
    return diagnostic
  }
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      try {
        const terminal = await wire.runTurn(texts, runAbort.signal)
        if (terminal.stopReason === 'completed') return terminal
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        const facts = wire.collectFailure()
        return { ...terminal, diagnostic: recordFailureDiagnostic(facts) }
      } catch (error: unknown) {
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        const facts = error instanceof CodexRunFailure
          ? error.facts
          : wire.collectFailure()
        recordFailureDiagnostic(facts)
        throw error instanceof CodexRunFailure
          ? error
          : new CodexRunFailure(facts, thrown(error))
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: disposeSocket,
  })
}
