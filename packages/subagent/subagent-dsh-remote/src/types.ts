/**
 * Shared wire and configuration types for the `dsh web` Remote API subagent
 * provider. This module carries types only; runtime validation lives in
 * {@link ./client.ts}.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-remote/types
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** `session/create` arguments. */
export interface SessionCreateArgs {
  /** Child working directory. */
  readonly cwd?: string
  /** Optional child preset id. */
  readonly agentPreset?: string
}

/** `session/prompt` arguments. */
export interface SessionPromptArgs {
  /** Caller-minted idempotency key. */
  readonly requestId: string
  readonly sessionId: string
  readonly mode: 'queue'
  readonly content: readonly ContentBlock[]
}

/** `session/wait` arguments. */
export interface SessionWaitArgs {
  readonly sessionId: string
  /** Wait deadline; omission uses the Host's fixed default. */
  readonly timeoutMs?: number
}

/** `session/cancel` arguments. */
export interface SessionCancelArgs {
  readonly sessionId: string
}

/** `session/create` result. */
export interface SessionCreateValue {
  readonly sessionId: string
  readonly agentPreset?: string
}

/** `session/prompt` result. */
export interface SessionPromptValue {
  readonly accepted: true
}

/** `session/cancel` result. */
export interface SessionCancelValue {
  readonly accepted: true
}

/** One raw Session event from the Remote journal (data validated at the wire boundary). */
export interface DshWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** One history record entry. */
export interface DshWireRecord {
  readonly type: 'event'
  readonly event: DshWireEvent
}

/** `session/wait` result — the stopping condition and bounded assistant output. */
export interface SessionWaitValue {
  readonly reason: 'idle' | 'input-required' | 'timeout'
  readonly output: {
    readonly records: readonly DshWireRecord[]
    readonly truncated: boolean
  }
}

/** Where a DSH Remote run failure occurred. */
export type DshRemoteFailureStage =
  | 'connect'
  | 'session-create'
  | 'prompt'
  | 'wait'
  | 'cancel'

/** Fixed DSH Remote failure classification for safe diagnostics. */
export type DshRemoteFailureCategory =
  | 'configuration'
  | 'auth'
  | 'transport'
  | 'gateway'
  | 'invalid-result'
  | 'unknown'

/** Structured facts the provider flattens into a safe failure diagnostic. */
export interface DshRemoteFailureFacts {
  readonly stage: DshRemoteFailureStage
  readonly category: DshRemoteFailureCategory
  readonly httpStatus?: number
  /** Remote error code (e.g. `session/not-found`); never echoed verbatim. */
  readonly remoteCode?: string
}
