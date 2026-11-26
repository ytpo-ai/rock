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
import type { AdapterRequestLog, BotOption, ObservabilityRow, RelayForwardLog } from './types.ts'

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

  /**
   * Aggregated rows in first-observed-session order.
   * @returns one row per observed session.
   */
  @Remote
  rows(): ObservabilityRow[] {
    return this.fold.rows()
  }

  /**
   * One row by session id.
   * @param sessionId - the observed session id.
   * @returns that session's row, or `null` when unobserved.
   */
  @Remote
  rowOf(sessionId: string): ObservabilityRow | null {
    return this.fold.rowOf(sessionId) ?? null
  }

  /**
   * One newest-first page of relay forward logs.
   * @param offset - 0-based number of in-scope entries to skip.
   * @param limit - maximum entries to return.
   * @param botId - filter to forwards from this bot; omitted pages every forward.
   * @returns the requested page, empty when the relay plugin is absent.
   */
  @Remote
  async relayLogs(offset: number, limit: number, botId?: string): Promise<RelayForwardLog[]> {
    const relay = this.ctx.get('rockLlmRelay') as RelayLogSource | undefined
    const identity = this.ctx.get('seagullIdentity') as IdentityLike | undefined
    const logs = await relay?.logPage(offset, limit, botId) ?? []
    return logs.map(log => fillForwardLog(log, identity))
  }

  /**
   * Total relay forward-log entries.
   * @param botId - filter to forwards from this bot; omitted counts every forward.
   * @returns the number of entries in scope, zero when the relay plugin is absent.
   */
  @Remote
  async relayLogCount(botId?: string): Promise<number> {
    const relay = this.ctx.get('rockLlmRelay') as RelayLogSource | undefined
    return relay?.logCount(botId) ?? 0
  }

  /**
   * One newest-first page of adapter request logs.
   * @param offset - 0-based number of in-scope entries to skip.
   * @param limit - maximum entries to return.
   * @param botId - filter to requests from this bot; omitted pages every request.
   * @returns the requested page, empty when the adapter plugin is absent.
   */
  @Remote
  async adapterLogs(offset: number, limit: number, botId?: string): Promise<AdapterRequestLog[]> {
    const adapter = this.ctx.get('rockLlmAdapter') as AdapterLogSource | undefined
    return adapter?.logPage(offset, limit, botId) ?? []
  }

  /**
   * Total adapter request-log entries.
   * @param botId - filter to requests from this bot; omitted counts every request.
   * @returns the number of entries in scope, zero when the adapter plugin is absent.
   */
  @Remote
  async adapterLogCount(botId?: string): Promise<number> {
    const adapter = this.ctx.get('rockLlmAdapter') as AdapterLogSource | undefined
    return adapter?.logCount(botId) ?? 0
  }

  /**
   * Bot choices for the console's bot filter: seat claims, assistants, then local bots.
   * @returns the distinct bots the identity and the local registry know, claims first.
   */
  @Remote
  bots(): BotOption[] {
    const identity = this.ctx.get('seagullIdentity') as BotDirectoryLike | undefined
    const local = this.ctx.get('rockBots') as { listBots(): readonly { id: string; name: string }[] } | undefined
    const options = new Map<string, BotOption>()
    for (const bot of [...identity?.getClaims() ?? [], ...identity?.getAssistants() ?? []]) {
      options.set(bot.agentBotId, { id: bot.agentBotId, name: bot.name ?? bot.agentBotId })
    }
    for (const bot of local?.listBots() ?? []) {
      if (!options.has(bot.id)) options.set(bot.id, { id: bot.id, name: bot.name })
    }
    return [...options.values()]
  }
}

/** Paged read surface both log-producing plugins expose. */
interface LogSource<Entry> {
  logPage(offset: number, limit: number, botId?: string): Promise<Entry[]>
  logCount(botId?: string): Promise<number>
}

/** The relay's paged forward-log read surface. */
type RelayLogSource = LogSource<RelayForwardLog>

/** The adapter's paged request-log read surface. */
type AdapterLogSource = LogSource<AdapterRequestLog>

/** The identity surface the bot filter reads names from. */
interface BotDirectoryLike {
  getClaims(): readonly { agentBotId: string; name?: string }[]
  getAssistants(): readonly { agentBotId: string; name?: string }[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local observability Remote (per-session turns/steps/outputTokens). */
    rockObservability: RockObservabilityController
  }
}
