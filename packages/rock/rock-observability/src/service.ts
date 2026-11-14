/**
 * Local observability fold: turns/steps/output-tokens per session, driven by
 * the harness `session/event` feed. The fold mirrors the `sessionStats`
 * projection's step accounting (one `step/end` per closed step, `assistant/
 * message` usage for output tokens) so the dashboard figures agree with the
 * whole-log view the Client already renders.
 *
 * @module @rock/rock-observability/service
 */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ObservabilityRow, ObservabilityState } from './types.ts'

/** A whole-log fold that consumes committed session events. */
export class RockObservabilityService {
  private readonly state = new Map<string, ObservabilityState>()

  /** Fold one committed session event into the owning session's aggregate. */
  observe(session: Session, event: SessionEvent): void {
    const id = String(session.id)
    const current = this.state.get(id) ?? { turns: 0, steps: 0, outputTokens: 0, lastTurn: null }
    this.state.set(id, fold(current, event))
  }

  /** Aggregated rows in insertion order (first observed session first). */
  rows(): ObservabilityRow[] {
    return [...this.state.entries()].map(([sessionId, s]) => ({
      sessionId,
      turns: s.turns,
      steps: s.steps,
      outputTokens: s.outputTokens,
    }))
  }

  /** One row by session id, or `undefined`. */
  rowOf(sessionId: string): ObservabilityRow | undefined {
    const s = this.state.get(sessionId)
    return s === undefined
      ? undefined
      : { sessionId, turns: s.turns, steps: s.steps, outputTokens: s.outputTokens }
  }
}

/** Fold one event into the session state, returning the same reference when unchanged. */
function fold(state: ObservabilityState, event: SessionEvent): ObservabilityState {
  switch (event.type) {
    case 'step/end': {
      const { turn } = event.data as { turn: number }
      const firstOfTurn = state.lastTurn !== turn
      return {
        ...state,
        turns: state.turns + (firstOfTurn ? 1 : 0),
        steps: state.steps + 1,
        lastTurn: turn,
      }
    }
    case 'assistant/message': {
      const usage = (event.data as { usage?: { outputTokens?: number } }).usage
      const outputTokens = typeof usage?.outputTokens === 'number' && usage.outputTokens >= 0
        ? usage.outputTokens
        : 0
      return outputTokens === 0 ? state : { ...state, outputTokens: state.outputTokens + outputTokens }
    }
    default:
      return state
  }
}
