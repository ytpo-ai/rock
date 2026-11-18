/**
 * One-shot `dsh web` Remote run lifecycle: connect the Host, create a session
 * in the parent workspace, dispatch the text-only task, poll `session/wait`
 * until the turn reaches a stopping state, and publish under the seam's
 * never-reject result contract. Disposal cancels the active turn only; the
 * Host and its session persist.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-remote/run
 */

import { randomUUID } from 'node:crypto'
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
import { extractAssistantOutput, type DshRemoteClient } from './client.ts'
import { abortError, failureDiagnostic, DshRemoteRunFailure } from './failure.ts'

/** Fully resolved inputs for one DSH Remote run. */
export interface DshRemoteRunSpec {
  /** The connected Host client for this run. */
  readonly client: DshRemoteClient
  /** Absolute parent working directory supplied as the session cwd. */
  readonly cwd: string
  /** Optional child preset id. */
  readonly agentPreset?: string
  /** Per-poll `session/wait` deadline. */
  readonly waitTimeoutMs: number
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/**
 * Validate and preserve the one-shot task before crossing the wire.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
export function textTask(prompt: readonly ContentBlock[]): string[] {
  if (prompt.length === 0) {
    throw new Error('subagent-dsh-remote: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-dsh-remote: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-dsh-remote: the one-shot task must not be empty')
  }
  return texts
}

/**
 * Start and publish one DSH Remote run after the session and prompt are
 * accepted. Startup failures reject after best-effort cleanup; accepted
 * execution failures settle through the result.
 * @param request - the resolved shared subagent request.
 * @param spec - the connected client, workspace, preset, wait deadline, and
 * diagnostic policy.
 * @returns the ready run handle.
 */
export async function startDshRemoteRun(request: SubagentStartRequest, spec: DshRemoteRunSpec): Promise<SubagentRun> {
  const texts = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-dsh-remote: request was aborted before startup')
  }
  const id = brandString<SessionId>(randomUUID())

  const flags = { cancelled: false }
  let sessionId: string | undefined
  const interruptRemote = (): void => {
    if (sessionId === undefined) return
    void spec.client.cancel({ sessionId }).catch(() => {})
  }
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    interruptRemote()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  let startupStage: 'session-create' | 'prompt' = 'session-create'
  try {
    const session = await spec.client.createSession({
      cwd: spec.cwd,
      ...(spec.agentPreset === undefined ? {} : { agentPreset: spec.agentPreset }),
    }, request.signal)
    sessionId = session.sessionId
    startupStage = 'prompt'
    await spec.client.prompt({
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: texts.map(text => ({ type: 'text', text })),
    }, request.signal)
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    if (flags.cancelled) {
      throw new Error('subagent-dsh-remote: request was aborted before run publication')
    }
    throw error instanceof DshRemoteRunFailure
      ? error
      : new DshRemoteRunFailure({ stage: startupStage, category: 'unknown' }, error)
  }

  let outputBlocks: ContentBlock[] = []
  let diagnostic: string | undefined
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      try {
        while (true) {
          if (request.signal.aborted) throw abortError(request.signal)
          const wait = await spec.client.wait({ sessionId, timeoutMs: spec.waitTimeoutMs }, request.signal)
          const output = extractAssistantOutput(wait)
          outputBlocks = output
          if (wait.reason === 'timeout') continue
          if (wait.reason === 'input-required') {
            return {
              output,
              stopReason: 'error',
              diagnostic: failureDiagnostic({ stage: 'wait', category: 'gateway' }),
            }
          }
          return { output, stopReason: 'completed' }
        }
      } catch (error) {
        if (!request.signal.aborted) {
          diagnostic = error instanceof DshRemoteRunFailure
            ? failureDiagnostic(error.facts)
            : failureDiagnostic({ stage: 'wait', category: 'unknown' })
        }
        throw error
      }
    },
    collectOutput: () => outputBlocks,
    collectDiagnostic: () => diagnostic,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  const teardown = async (): Promise<void> => {
    // Disposal only cancels the active turn (best-effort, in requestCancel);
    // the Host and its durable session persist by design.
  }

  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown,
  })
}
