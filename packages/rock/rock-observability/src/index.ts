/**
 * Rock local observability plugin: folds the harness `session/event` feed into
 * a per-session turns/steps/output-tokens aggregate and exposes it as a Remote
 * service (`ctx.rockObservability`). The dashboard Client reads `rows()` /
 * `rowOf()` over Typert to show which session ran how many rounds/steps and how
 * many output tokens it produced.
 *
 * @module @rock/rock-observability
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { RockObservabilityService } from './service.ts'
import type { ObservabilityRow } from './types.ts'

export type * from './types.ts'

/** Remote service carrying the local observability fold. */
export default class RockObservabilityController extends TypertRemoteService {
  static inject = ['sessions']

  private readonly fold = new RockObservabilityService()

  constructor(ctx: Context) {
    super(ctx, 'rockObservability')
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.fold.observe(session, event)
    })
  }

  /** Aggregated rows in first-observed-session order. */
  @Remote
  rows(): ObservabilityRow[] {
    return this.fold.rows()
  }

  /** One row by session id, or `null` when unobserved. */
  @Remote
  rowOf(sessionId: string): ObservabilityRow | null {
    return this.fold.rowOf(sessionId) ?? null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local observability Remote (per-session turns/steps/outputTokens). */
    rockObservability: RockObservabilityController
  }
}
