/**
 * Rock local observability vocabulary: one aggregated session row shown on the
 * workbench dashboard. The row folds whole-log figures from the harness
 * `session/event` feed (steps, turns, and provider-reported output tokens).
 *
 * @module @rock/rock-observability/types
 */

/** One aggregated local session row for the dashboard. */
export interface ObservabilityRow {
  /** Session id the figures fold from. */
  sessionId: string
  /** Distinct turns carrying at least one closed step. */
  turns: number
  /** Closed steps (`step/end` events). */
  steps: number
  /** Summed provider output tokens over message-assembling steps. */
  outputTokens: number
}

/** In-memory fold state for one session, keyed by session id. */
export interface ObservabilityState {
  turns: number
  steps: number
  outputTokens: number
  lastTurn: number | null
}

/** One relay forward log row (structurally matches `@rock/rock-llm-relay` `RelayForwardLog`). */
export interface RelayForwardLog {
  /** ISO-8601 timestamp of forward completion. */
  timestamp: string
  /** ISO-8601 timestamp of request arrival, before forwarding. */
  startedAt?: string
  /** Elapsed milliseconds from request arrival to forward completion. */
  durationMs?: number
  /** Resolved agent bot id from `/v1/bots/{agentBotId}`. */
  agentBotId: string
  /** Human-readable bot name resolved from the identity claim, when available. */
  botName?: string
  /** Execution backend the bot binds to (codex/pi/dsh/acp/…), when bound. */
  toolType?: string
  /** Path suffix, e.g. `/chat/completions` or `/responses`. */
  pathSuffix: string
  /** Rock/DSH delegator session id, when the inbound request carried one. */
  rockSessionId?: string
  /** The external tool's own session identifier, when it presented one. */
  toolSessionId?: string
  /** The original `model` field from the inbound request body. */
  requestModel?: string
  /** The model id the relay stamped (`seagull-relay`). */
  mappedModel: string
  /** The bot's bound model resolved from the seat claim, when available. */
  boundModel?: string
  /** Upstream HTTP status when forwarding completed. */
  status?: number
  /** Safe failure diagnostic when the forward failed. */
  error?: string
}
