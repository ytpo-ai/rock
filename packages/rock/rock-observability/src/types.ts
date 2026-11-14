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
