/**
 * Rock local bot manager plugin: persists and serves the locally-defined
 * agent bots (`BotDefinition`) on the employee workbench, exposed as a Remote
 * service (`ctx.rockBots`). The bot management UI and `seagull-identity` both
 * read `ctx.rockBots`; changes persist to a JSON file so a restart keeps the
 * local bots.
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
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { RockBotService } from './service.ts'
import { JsonFileBindingStore, JsonFileBotStore } from './store.ts'
import { activeBotIdsFrom } from './tasks.ts'
import { buildUnifiedBots } from './unify.ts'
import type { BotDefinition, BotInput, BotRow } from './types.ts'

export type * from './types.ts'

const DEFAULT_STORE_PATH = '.rock/bots.json'
const DEFAULT_BINDINGS_PATH = '.rock/bindings.json'

/** Tool types the binding selector offers before deployment overrides them. */
const DEFAULT_TOOL_TYPES = ['codex', 'pi', 'opencode', 'dsh', 'acp', 'claude-code']

/** Deployment-owned persistence facts; patchable from cordis.yml. */
export interface Config {
  /** JSON file persisting the local bot list. */
  storePath?: string
  /** Full tasks endpoint URL (no query); absent → the binding lock never engages (offline). */
  tasksUrl?: string
  /** Employee id the tasks endpoint filters by; absent → the binding lock never engages. */
  employeeId?: string
  /** Tool types offered by the binding selector. */
  toolTypes?: string[]
  /** JSON file persisting cloud-sourced bot bindings. */
  bindingsPath?: string
}

/** Remote service carrying the local bot registry. */
export default class RockBotController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    storePath: z.string().min(1).default(DEFAULT_STORE_PATH),
    tasksUrl: z.string().default(''),
    employeeId: z.string().default(''),
    toolTypes: z.array(z.string().min(1)).default(DEFAULT_TOOL_TYPES),
    bindingsPath: z.string().min(1).default(DEFAULT_BINDINGS_PATH),
  })

  private readonly service: RockBotService
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockBots')
    this.config = config
    this.service = new RockBotService({
      store: new JsonFileBotStore(config.storePath ?? DEFAULT_STORE_PATH),
      bindingsStore: new JsonFileBindingStore(config.bindingsPath ?? DEFAULT_BINDINGS_PATH),
    })
    void this.service.load().then(() => {
      ctx.logger.info(`rock-bot-manager: loaded ${this.service.list().length} local bot(s)`)
    }, (error: unknown) => {
      ctx.logger.warn(`rock-bot-manager: failed to load bots: ${messageOf(error)}`)
    })
  }

  /** Host-side read of the live bot list (no Remote serialization). */
  list(): readonly BotDefinition[] {
    return this.service.list()
  }

  /** Host-side read of a claimed bot's persisted binding (no Remote serialization). */
  getBinding(id: string): string | undefined {
    return this.service.getBinding(id)
  }

  /** All local bots in insertion order. */
  @Remote
  listBots(): BotDefinition[] {
    return [...this.service.list()]
  }

  /** One bot by id, or `null`. */
  @Remote
  getBot(id: string): BotDefinition | null {
    return this.service.get(id) ?? null
  }

  /** Add one bot; a duplicate id fails with `rockBots/duplicate`. */
  @Remote
  async createBot(input: BotInput): Promise<BotDefinition> {
    try {
      return await this.service.create(input)
    } catch (error) {
      throw botRemoteError(error)
    }
  }

  /** Replace one bot's fields; an unknown id fails with `rockBots/unknown`. */
  @Remote
  async updateBot(id: string, patch: Partial<Omit<BotDefinition, 'id'>>): Promise<BotDefinition> {
    try {
      return await this.service.update(id, patch)
    } catch (error) {
      throw botRemoteError(error)
    }
  }

  /** Remove one bot; an unknown id fails with `rockBots/unknown`. */
  @Remote
  async removeBot(id: string): Promise<void> {
    try {
      await this.service.remove(id)
    } catch (error) {
      throw botRemoteError(error)
    }
  }

  /** Bot ids with at least one active (non-terminal) cloud task; empty when offline. */
  @Remote
  async activeBotIds(): Promise<string[]> {
    return activeBotIdsFrom(await this.fetchTasks())
  }

  /** Tool types the binding selector offers. */
  @Remote
  toolTypes(): string[] {
    return [...(this.config.toolTypes ?? DEFAULT_TOOL_TYPES)]
  }

  /** Unified bot rows across local, claimed, and assistant sources (D-036). */
  @Remote
  async listBotsUnified(): Promise<BotRow[]> {
    const activeIds = new Set(activeBotIdsFrom(await this.fetchTasks()))
    const identity = this.optionalIdentity()
    return buildUnifiedBots({
      localBots: this.service.list(),
      claimed: identity === undefined ? [] : identity.getClaims().map(claim => ({ agentBotId: claim.agentBotId })),
      assistants: [],
      activeIds,
      bindingOf: id => this.service.getBinding(id) ?? identity?.toolBindingOf(id) ?? 'codex',
    })
  }

  /** Tool type ids detected as installed on this machine. */
  @Remote
  async installedTools(): Promise<string[]> {
    const inventory = this.optionalInventory()
    if (inventory === undefined) return []
    const statuses = await inventory.listTools()
    return statuses.filter(status => status.installed).map(status => status.id)
  }

  /** Rebind a bot — local definition or cloud-sourced binding — and persist. */
  @Remote
  async rebindBot(id: string, toolType: string): Promise<void> {
    try {
      if (this.service.get(id) !== undefined) {
        await this.service.update(id, { tool: { toolType } })
      } else {
        await this.service.setBinding(id, toolType)
      }
    } catch (error) {
      throw botRemoteError(error)
    }
  }

  /** Fetch the cloud task queue; an empty list when unconfigured or unreachable. */
  private async fetchTasks(): Promise<Array<Record<string, unknown>>> {
    const url = this.config.tasksUrl
    const employeeId = this.config.employeeId
    if (url === undefined || employeeId === undefined || url.length === 0 || employeeId.length === 0) return []
    try {
      const response = await fetch(`${url}?employeeId=${encodeURIComponent(employeeId)}`)
      if (!response.ok) return []
      const body = (await response.json()) as { tasks?: unknown }
      return Array.isArray(body.tasks) ? body.tasks as Array<Record<string, unknown>> : []
    } catch {
      return []
    }
  }

  /** The optional identity service, structurally typed to avoid a package cycle. */
  private optionalIdentity(): { getClaims(): readonly { agentBotId: string }[]; toolBindingOf(id: string): string } | undefined {
    return this.ctx.get('seagullIdentity') as { getClaims(): readonly { agentBotId: string }[]; toolBindingOf(id: string): string } | undefined
  }

  /** The optional tool-inventory service, structurally typed to avoid a package cycle. */
  private optionalInventory(): { listTools(): Promise<{ id: string; installed: boolean }[]> } | undefined {
    return this.ctx.get('rockToolInventory') as { listTools(): Promise<{ id: string; installed: boolean }[]> } | undefined
  }
}

/** Map a domain-service failure to a Remote error the Client can branch on. */
function botRemoteError(error: unknown): RemoteError {
  const code = (error as { code?: string } | null)?.code
  const message = messageOf(error)
  switch (code) {
    case 'DUPLICATE_BOT': return new RemoteError('rockBots/duplicate', message, {})
    case 'UNKNOWN_BOT': return new RemoteError('rockBots/unknown', message, {})
    default: return new RemoteError('rockBots/invalid', message, {}, { cause: error })
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local bot registry Remote (create/update/remove/list persisted bots). */
    rockBots: RockBotController
  }
}
