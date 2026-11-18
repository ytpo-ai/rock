/**
 * Shared wire and configuration types for the OpenCode v2 subagent provider.
 * This module carries types only; all runtime parsing and validation lives in
 * {@link ./client.ts}.
 *
 * @module @deepseek-ai/dsh-subagent-opencode/types
 */

/** The local OpenCode server record read from the discovery file. */
export interface OpencodeServiceInfo {
  /** Base HTTP(S) URL of the OpenCode server, without a trailing slash. */
  readonly url: string
  /** Server password used to build the Basic authorization header. */
  readonly password: string
}

/** Request body for `POST /api/session`. */
export interface OpencodeSessionCreate {
  /** Optional session title. */
  readonly title?: string
  /** Optional OpenCode agent id. */
  readonly agent?: string
  /** Session working directory. */
  readonly location: { readonly directory: string }
}

/** The created-session identity returned by `POST /api/session`. */
export interface OpencodeSession {
  readonly id: string
}

/** Assistant content part kinds the provider reads for output. */
export type OpencodePartType = 'text' | 'reasoning' | 'tool'

/** One assistant message content part. */
export interface OpencodeContentPart {
  readonly type: OpencodePartType
  readonly text?: string
}

/** Assistant message finish reason. */
export type OpencodeFinish =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'content-filter'
  | 'error'
  | 'unknown'

/** Idle message outcome — the authoritative turn-completion signal. */
export type OpencodeOutcome = 'succeeded' | 'failed' | 'interrupted'

/** The safe subset of an OpenCode message error the provider classifies. */
export interface OpencodeMessageError {
  /** Error type tag (e.g. `provider.quota`). */
  readonly type?: string
  /** Optional HTTP status when the error carries one. */
  readonly status?: number
}

/** An assistant message from `GET /api/session/{id}/message`. */
export interface OpencodeAssistantMessage {
  readonly type: 'assistant'
  readonly id: string
  readonly time: { readonly created: number }
  readonly content: readonly OpencodeContentPart[]
  readonly finish?: OpencodeFinish
}

/** An idle message from `GET /api/session/{id}/message`. */
export interface OpencodeIdleMessage {
  readonly type: 'idle'
  readonly id: string
  readonly time: { readonly created: number }
  readonly outcome: OpencodeOutcome
  readonly error?: OpencodeMessageError
}

/** Any durable message record the provider does not interpret. */
export interface OpencodeOtherMessage {
  readonly type: 'other'
  readonly id: string
  readonly time: { readonly created: number }
}

/** The union of durable OpenCode message records. */
export type OpencodeMessage =
  | OpencodeAssistantMessage
  | OpencodeIdleMessage
  | OpencodeOtherMessage

/** Where an OpenCode run failure occurred. */
export type OpencodeFailureStage =
  | 'discover'
  | 'session-create'
  | 'prompt'
  | 'poll'

/** Fixed OpenCode failure classification for safe diagnostics. */
export type OpencodeFailureCategory =
  | 'configuration'
  | 'discovery'
  | 'auth'
  | 'transport'
  | 'product'
  | 'limit'
  | 'invalid-result'
  | 'unknown'

/** Structured facts the provider flattens into a safe failure diagnostic. */
export interface OpencodeFailureFacts {
  readonly stage: OpencodeFailureStage
  readonly category: OpencodeFailureCategory
  readonly httpStatus?: number
}
