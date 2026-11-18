/**
 * Profile-named Codex one-shot subagent provider. Each accepted run starts a
 * fresh official package-local Codex wrapper in the delegating Session's
 * workspace and publishes only after a thread exists. The `stdio` transport
 * (default) spawns `codex app-server --stdio` with an ephemeral thread; the
 * `socket` transport connects the local `codex app-server daemon` control
 * socket and materializes the thread on disk so the Codex UI can list and
 * resume it.
 *
 * @module @deepseek-ai/dsh-subagent-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  assertUsableCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  defaultDaemonSocketPath,
  startCodexDaemonRun,
  type CodexDaemonRunSpec,
} from './daemon.ts'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
  startCodexRun,
  type CodexPermissionMode,
  type CodexRunSpec,
} from './run.ts'

export const name = 'subagent-codex'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'codex'

/** How the provider reaches the Codex app-server. */
export type CodexTransport = 'stdio' | 'socket'

const DEFAULT_TRANSPORT: CodexTransport = 'stdio'

/** Accepted transport values. */
export const CODEX_TRANSPORTS = ['stdio', 'socket'] as const satisfies readonly CodexTransport[]

/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `codex`). */
  providerName?: string
  /** Native Codex model fixed for this instance; omitted to inherit Codex settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Native non-interactive permission mode fixed for this Provider instance. */
  permissionMode?: CodexPermissionMode
  /** Grace in milliseconds between app-server managed-range termination tiers. */
  disposeGraceMs?: number
  /**
   * Transport used to reach the app-server: `stdio` spawns `codex app-server
   * --stdio` per run (default); `socket` connects the local app-server daemon
   * control socket and persists the thread.
   */
  transport?: CodexTransport
  /** Absolute daemon control socket path (default `$CODEX_HOME` or `~/.codex`). */
  socketPath?: string
  /** Spawn the managed daemon first when the socket transport is selected. */
  ensureDaemon?: boolean
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CODEX_PERMISSION_MODES])
    .default(DEFAULT_CODEX_PERMISSION_MODE),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  transport: z.union([...CODEX_TRANSPORTS]).default(DEFAULT_TRANSPORT),
  socketPath: z.string().min(1),
  ensureDaemon: z.boolean().default(false),
})

type ResolvedConfig = Omit<Required<Config>, 'model' | 'socketPath'> & Pick<Config, 'model' | 'socketPath'>

class CodexProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-codex', 'child cwd', request.cwd)
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error(
          'subagent-codex: request was aborted before app-server startup',
        )
      }
      throw codexStartupFailure(error)
    }
    const onError = (error: Error, stopReason: SubagentStopReason): void => {
      this.ctx.logger.warn(
        `subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`,
      )
    }
    if (this.config.transport === 'socket') {
      const socketPath = this.config.socketPath ?? defaultDaemonSocketPath()
      if (socketPath === undefined) {
        throw codexStartupFailure(new Error(
          'subagent-codex: socket transport requires socketPath when neither CODEX_HOME nor HOME is set',
        ))
      }
      const spec: CodexDaemonRunSpec = {
        cwd,
        ...this.config.model === undefined ? {} : { model: this.config.model },
        permissionMode: this.config.permissionMode,
        socketPath,
        ensureDaemon: this.config.ensureDaemon,
        env: this.config.env,
        spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
        onError,
      }
      return startCodexDaemonRun(request, spec)
    }
    const spec: CodexRunSpec = {
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      ephemeral: true,
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError,
    }
    return startCodexRun(request, spec)
  }
}

/**
 * Register one Profile-named Codex provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, optional model, permission mode, transport, environment, and disposal grace.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...config.model === undefined ? {} : { model: config.model },
    env: config.env as Record<string, string>,
    permissionMode: config.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
    disposeGraceMs: config.disposeGraceMs as number,
    transport: config.transport ?? DEFAULT_TRANSPORT,
    ensureDaemon: config.ensureDaemon ?? false,
    ...config.socketPath === undefined ? {} : { socketPath: config.socketPath },
  }
  assertPositiveFinite(
    'subagent-codex',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  ctx.subagents.registerProvider(new CodexProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
