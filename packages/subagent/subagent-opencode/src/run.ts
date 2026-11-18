/**
 * One-shot OpenCode run lifecycle: create a session in the parent workspace,
 * dispatch the text-only task, poll the durable message list until the idle
 * message settles the turn, and publish under the seam's never-reject result
 * contract. Disposal interrupts the active run only; the OpenCode server and
 * its session persist.
 *
 * @module @deepseek-ai/dsh-subagent-opencode/run
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
import type { OpencodeClient } from './client.ts'
import { abortError, failureDiagnostic, OpencodeRunFailure } from './failure.ts'
import type {
  OpencodeAssistantMessage,
  OpencodeFinish,
  OpencodeIdleMessage,
  OpencodeMessage,
} from './types.ts'

/** Fully resolved inputs for one OpenCode run. */
export interface OpencodeRunSpec {
  /** The discovered OpenCode server client for this run. */
  readonly client: OpencodeClient
  /** Absolute parent working directory supplied as the session location. */
  readonly cwd: string
  /** Optional session title (the request label). */
  readonly label?: string
  /** Optional OpenCode agent id. */
  readonly agent?: string
  /** Delay between message polls. */
  readonly pollIntervalMs: number
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
    throw new Error('subagent-opencode: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-opencode: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-opencode: the one-shot task must not be empty')
  }
  return texts
}

/** Resolve after `ms`, rejecting early on signal abort. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = (): void => { cleanup(); reject(abortError(signal)) }
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Find the idle completion message, when present. */
function findIdleMessage(messages: readonly OpencodeMessage[]): OpencodeIdleMessage | undefined {
  for (const message of messages) {
    if (message.type === 'idle') return message
  }
  return undefined
}

/** The assistant message with the greatest creation time, when any. */
function lastAssistantMessage(messages: readonly OpencodeMessage[]): OpencodeAssistantMessage | undefined {
  let latest: OpencodeAssistantMessage | undefined
  for (const message of messages) {
    if (message.type === 'assistant' && (latest === undefined || message.time.created > latest.time.created)) {
      latest = message
    }
  }
  return latest
}

/**
 * The child's final answer under the seam's selection rule: the text parts of
 * the last non-empty assistant message, as one newline-joined text block.
 * @param messages - the durable message records.
 * @returns the selected output, or `[]` when no assistant text exists.
 */
export function collectOutput(messages: readonly OpencodeMessage[]): ContentBlock[] {
  const assistants = messages
    .filter((message): message is OpencodeAssistantMessage => message.type === 'assistant')
    .sort((a, b) => b.time.created - a.time.created)
  for (const assistant of assistants) {
    const text = assistant.content
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
      .join('\n')
      .trim()
    if (text.length > 0) return [{ type: 'text', text }]
  }
  return []
}

/** Classify a failed idle outcome into fixed safe facts. */
function classifyIdleFailure(idle: OpencodeIdleMessage): { stage: 'poll'; category: 'limit' | 'auth' | 'product'; httpStatus?: number } {
  const error = idle.error
  if (error === undefined) return { stage: 'poll', category: 'product' }
  const type = error.type ?? ''
  const httpStatus = error.status === undefined ? {} : { httpStatus: error.status }
  if (type.includes('quota') || type.includes('credit') || type.includes('rate') || type.includes('limit')) {
    return { stage: 'poll', category: 'limit', ...httpStatus }
  }
  if (type.includes('auth')) {
    return { stage: 'poll', category: 'auth', ...httpStatus }
  }
  if (error.status !== undefined) {
    return { stage: 'poll', category: 'product', httpStatus: error.status }
  }
  return { stage: 'poll', category: 'product' }
}

/** Map a settled idle outcome and the message list to a shared result. */
function mapOutcome(idle: OpencodeIdleMessage, messages: readonly OpencodeMessage[]): SubagentResult {
  const output = collectOutput(messages)
  if (idle.outcome === 'failed') {
    return { output, stopReason: 'error', diagnostic: failureDiagnostic(classifyIdleFailure(idle)) }
  }
  if (idle.outcome === 'interrupted') {
    return { output, stopReason: 'error', diagnostic: failureDiagnostic({ stage: 'poll', category: 'product' }) }
  }
  const finish: OpencodeFinish = lastAssistantMessage(messages)?.finish ?? 'unknown'
  if (finish === 'length') return { output, stopReason: 'max-tokens' }
  if (finish === 'content-filter') {
    return { output, stopReason: 'refusal', diagnostic: failureDiagnostic({ stage: 'poll', category: 'product' }) }
  }
  return { output, stopReason: 'completed' }
}

/**
 * Start and publish one OpenCode run after the session and prompt are accepted.
 * Startup failures reject after the interrupt is best-effort; accepted
 * execution failures settle through the result.
 * @param request - the resolved shared subagent request.
 * @param spec - the discovered client, workspace, permissions, poll delay, and
 * diagnostic policy.
 * @returns the ready run handle.
 */
export async function startOpencodeRun(request: SubagentStartRequest, spec: OpencodeRunSpec): Promise<SubagentRun> {
  const texts = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-opencode: request was aborted before startup')
  }
  const id = brandString<SessionId>(randomUUID())

  const flags = { cancelled: false }
  let sessionId: string | undefined
  const interruptRemote = (): void => {
    if (sessionId === undefined) return
    void spec.client.interrupt(sessionId).catch(() => {})
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
      ...(spec.label === undefined ? {} : { title: spec.label }),
      ...(spec.agent === undefined ? {} : { agent: spec.agent }),
      location: { directory: spec.cwd },
    }, request.signal)
    sessionId = session.id
    startupStage = 'prompt'
    await spec.client.prompt(sessionId, texts.join('\n'), request.signal)
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    if (flags.cancelled) {
      throw new Error('subagent-opencode: request was aborted before run publication')
    }
    throw error instanceof OpencodeRunFailure
      ? error
      : new OpencodeRunFailure({ stage: startupStage, category: 'unknown' }, error)
  }

  let outputBlocks: ContentBlock[] = []
  let diagnostic: string | undefined
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      try {
        while (true) {
          if (request.signal.aborted) throw abortError(request.signal)
          const messages = await spec.client.listMessages(sessionId, request.signal)
          outputBlocks = collectOutput(messages)
          const idle = findIdleMessage(messages)
          if (idle !== undefined) return mapOutcome(idle, messages)
          await sleep(spec.pollIntervalMs, request.signal)
        }
      } catch (error) {
        if (!request.signal.aborted) {
          diagnostic = error instanceof OpencodeRunFailure
            ? failureDiagnostic(error.facts)
            : failureDiagnostic({ stage: 'poll', category: 'unknown' })
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
    // Disposal only interrupts the active run (best-effort, in requestCancel);
    // the OpenCode server and its durable session persist by design.
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
