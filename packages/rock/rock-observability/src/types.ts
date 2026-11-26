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

/** One bot choice offered by the console's bot filter. */
export interface BotOption {
  /** Agent bot id the logs are keyed by. */
  id: string
  /** Display name resolved from the identity or the local bot registry. */
  name: string
}

/** Token counters one adapter request reported (structurally matches `@rock/cloud-llm-adapter`). */
export interface AdapterRequestTokens {
  input: number
  output: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

/** One recorded adapter request (structurally matches `@rock/cloud-llm-adapter` `LlmRequestLog`). */
export interface AdapterRequestLog {
  /** ISO-8601 timestamp of request completion. */
  timestamp: string
  /** ISO-8601 timestamp of request start. */
  startedAt: string
  /** Elapsed milliseconds from request start to completion. */
  durationMs: number
  /** Rock agent bot id the harness stamped, when present. */
  agentBotId?: string
  /** Human-readable bot name resolved from the identity, when available. */
  botName?: string
  /** Execution backend the bot binds to (codex/pi/dsh/acp/…), when bound. */
  toolType?: string
  /** Provider route id the request selected. */
  provider: string
  /** Wire protocol the request used, for relay routes. */
  wireProtocol?: string
  /** Harness session id that issued the request, when present. */
  sessionId?: string
  /** Model id the request asked for. */
  requestModel: string
  /** The bot's bound model resolved from the identity, when the relay overrides the request model. */
  boundModel?: string
  /** Conversation messages carried by the request. */
  messageCount: number
  /** Declared tools carried by the request; absent when it sent none. */
  toolCount?: number
  /** Upstream HTTP status once a response arrived. */
  status?: number
  /** Safe failure diagnostic when the request failed. */
  error?: string
  /** Provider-reported token usage, when the stream carried it. */
  tokens?: AdapterRequestTokens
}
