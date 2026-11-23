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
import { fillForwardLog, type IdentityLike } from './relay-log.ts'
import { RockObservabilityService } from './service.ts'
import type { ObservabilityRow, RelayForwardLog } from './types.ts'

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

  /** One newest-first page of relay forward logs; empty when the relay is absent. */
  @Remote
  async relayLogs(offset: number, limit: number): Promise<RelayForwardLog[]> {
    const relay = this.ctx.get('rockLlmRelay') as { logPage(offset: number, limit: number): Promise<RelayForwardLog[]> } | undefined
    const identity = this.ctx.get('seagullIdentity') as IdentityLike | undefined
    const logs = await relay?.logPage(offset, limit) ?? []
    return logs.map(log => fillForwardLog(log, identity))
  }

  /** Total relay forward-log entries; zero when the relay is absent. */
  @Remote
  async relayLogCount(): Promise<number> {
    const relay = this.ctx.get('rockLlmRelay') as { logCount(): Promise<number> } | undefined
    return relay?.logCount() ?? 0
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local observability Remote (per-session turns/steps/outputTokens). */
    rockObservability: RockObservabilityController
  }
}
