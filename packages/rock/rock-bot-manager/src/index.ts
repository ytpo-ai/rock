/**
 * Rock local bot manager plugin: persists and serves the locally-defined
 * agent bots (`BotDefinition`) on the employee workbench. The bot management
 * UI and `seagull-identity` both read `ctx.rockBots`; changes are persisted to
 * a JSON file so a restart keeps the local bots.
 *
 * ```yaml
 * - id: rock-bot-manager
 *   name: '@rock/rock-bot-manager'
 *   config:
 *     storePath: .rock/bots.json
 * ```
 *
 * @module @rock/rock-bot-manager
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RockBotService } from './service.ts'
import { JsonFileBotStore } from './store.ts'

export type * from './types.ts'

export const name = 'rock-bot-manager'
export const inject = []

const DEFAULT_STORE_PATH = '.rock/bots.json'

/** Deployment-owned persistence facts; patchable from cordis.yml. */
export interface Config {
  /** JSON file persisting the local bot list. */
  storePath?: string
}

export const Config: z<Config> = z.object({
  storePath: z.string().min(1).default(DEFAULT_STORE_PATH),
})

/** Mount the bot registry: load the persisted list and expose it on the context. */
export function apply(ctx: Context, config: Config): void {
  const service = new RockBotService({
    store: new JsonFileBotStore(config.storePath ?? DEFAULT_STORE_PATH),
  })
  void service.load().then(() => {
    ctx.logger.info(`rock-bot-manager: loaded ${service.list().length} local bot(s)`)
  }, (error: unknown) => {
    ctx.logger.warn(`rock-bot-manager: failed to load bots: ${messageOf(error)}`)
  })
  ctx.provide('rockBots', service)
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local bot registry (create/update/remove/list persisted bots). */
    rockBots: RockBotService
  }
}
