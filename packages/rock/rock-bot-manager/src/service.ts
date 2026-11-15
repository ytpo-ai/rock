/**
 * Local bot registry service: CRUD over the persisted `BotDefinition` list.
 * Identity rules (unique non-empty id) and field validation live here; the
 * store below persists whatever this service commits.
 *
 * @module @rock/rock-bot-manager/service
 */
import type { BotDefinition, BotLlm, BotTool } from './types.ts'
import type { BindingStore, BotStore } from './store.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface RockBotServiceOptions {
  /** Persistence backend for the bot list. */
  store: BotStore
  /** Persistence backend for claimed-bot bindings; absent → in-memory only. */
  bindingsStore?: BindingStore
}

/** A full-bot create/update payload (id is assigned/validated by the service). */
export type BotInput = Omit<BotDefinition, 'id'> & { id?: string }

/** Registry of locally-defined agent bots, persisted through a store. */
export class RockBotService {
  private bots: BotDefinition[] = []
  private bindings: Record<string, string> = {}

  constructor(private readonly options: RockBotServiceOptions) {}

  /** Load the persisted lists (empty before {@link load} completes). */
  async load(): Promise<void> {
    this.bots = (await this.options.store.load()).map(normalizeBot)
    if (this.options.bindingsStore !== undefined) {
      this.bindings = await this.options.bindingsStore.load()
    }
  }

  /** Current bots in insertion order. */
  list(): readonly BotDefinition[] {
    return this.bots
  }

  /** Get one bot by id, or `undefined`. */
  get(id: string): BotDefinition | undefined {
    return this.bots.find(bot => bot.id === id)
  }

  /** Resolve a cloud-sourced bot's persisted binding, or `undefined`. */
  getBinding(agentBotId: string): string | undefined {
    return this.bindings[agentBotId]
  }

  /** Persist a cloud-sourced bot's tool binding. */
  async setBinding(agentBotId: string, toolType: string): Promise<void> {
    if (toolType.length === 0) throw new Error(`binding "${agentBotId}" needs a non-empty toolType`)
    this.bindings = { ...this.bindings, [agentBotId]: toolType }
    if (this.options.bindingsStore !== undefined) await this.options.bindingsStore.save(this.bindings)
  }

  /** Add one bot; a duplicate id fails with a typed error. */
  async create(input: BotInput): Promise<BotDefinition> {
    const bot = normalizeBot({ ...input, id: input.id ?? input.name })
    if (this.bots.some(existing => existing.id === bot.id)) {
      throw duplicateIdError(bot.id)
    }
    this.bots = [...this.bots, bot]
    await this.persist()
    return bot
  }

  /** Replace one bot's fields; an unknown id fails with a typed error. */
  async update(id: string, patch: Partial<Omit<BotDefinition, 'id'>>): Promise<BotDefinition> {
    const index = this.bots.findIndex(bot => bot.id === id)
    if (index === -1) throw unknownIdError(id)
    const existing = this.bots[index]
    if (existing === undefined) throw unknownIdError(id)
    const bot = normalizeBot({ ...existing, ...patch, id })
    this.bots = this.bots.map((current, i) => (i === index ? bot : current))
    await this.persist()
    return bot
  }

  /** Remove one bot; an unknown id fails with a typed error. */
  async remove(id: string): Promise<void> {
    if (!this.bots.some(bot => bot.id === id)) throw unknownIdError(id)
    this.bots = this.bots.filter(bot => bot.id !== id)
    await this.persist()
  }

  private async persist(): Promise<void> {
    await this.options.store.save(this.bots)
  }
}

/** A bot id is a non-empty string. */
function validId(id: string): boolean {
  return typeof id === 'string' && id.length > 0
}

/** A provider route and model id are non-empty strings. */
function validLlm(llm: BotLlm): boolean {
  return typeof llm.provider === 'string' && llm.provider.length > 0
    && typeof llm.model === 'string' && llm.model.length > 0
}

/** A tool binding carries a non-empty tool type. */
function validTool(tool: BotTool): boolean {
  return typeof tool.toolType === 'string' && tool.toolType.length > 0
}

/** Validate and clone one bot definition, dropping unknown top-level fields. */
function normalizeBot(bot: BotDefinition): BotDefinition {
  if (!validId(bot.id)) throw new Error('bot id must be a non-empty string')
  if (typeof bot.name !== 'string' || bot.name.length === 0) throw new Error(`bot "${bot.id}" name must be a non-empty string`)
  if (!validLlm(bot.llm)) throw new Error(`bot "${bot.id}" llm needs a non-empty provider and model`)
  if (!validTool(bot.tool)) throw new Error(`bot "${bot.id}" tool needs a non-empty toolType`)
  return {
    id: bot.id,
    name: bot.name,
    ...bot.role === undefined ? {} : { role: bot.role },
    llm: {
      provider: bot.llm.provider,
      ...bot.llm.baseUrl === undefined ? {} : { baseUrl: bot.llm.baseUrl },
      ...bot.llm.apiKeyRef === undefined ? {} : { apiKeyRef: bot.llm.apiKeyRef },
      ...bot.llm.apiKey === undefined ? {} : { apiKey: bot.llm.apiKey },
      model: bot.llm.model,
    },
    tool: { toolType: bot.tool.toolType },
  }
}

/** Typed duplicate-id failure carrying the offending id. */
function duplicateIdError(id: string): Error & { code: 'DUPLICATE_BOT' } {
  return Object.assign(new Error(`a bot with id "${id}" already exists`), { code: 'DUPLICATE_BOT' as const })
}

/** Typed unknown-id failure carrying the missing id. */
function unknownIdError(id: string): Error & { code: 'UNKNOWN_BOT' } {
  return Object.assign(new Error(`no bot with id "${id}"`), { code: 'UNKNOWN_BOT' as const })
}
