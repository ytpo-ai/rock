/**
 * Local bot registry service: CRUD over the persisted `BotDefinition` list.
 * Identity rules (unique non-empty id) and field validation live here; the
 * store below persists whatever this service commits.
 *
 * @module @rock/rock-bot-manager/service
 */
import type { ApiProtocol, BotDefinition, BotInputType, BotLlm, BotReasoning, BotTool, DeploymentRecord } from './types.ts'
import type { BindingStore, BotStore, DeploymentStore } from './store.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface RockBotServiceOptions {
  /** Persistence backend for the bot list. */
  store: BotStore
  /** Persistence backend for claimed-bot bindings; absent → in-memory only. */
  bindingsStore?: BindingStore
  /** Persistence backend for bot deployment records; absent → in-memory only. */
  deploymentsStore?: DeploymentStore
}

/** A full-bot create/update payload (id is assigned/validated by the service). */
export type BotInput = Omit<BotDefinition, 'id'> & { id?: string }

/** Registry of locally-defined agent bots, persisted through a store. */
export class RockBotService {
  private bots: BotDefinition[] = []
  private bindings: Record<string, string> = {}
  private deployments: Record<string, DeploymentRecord> = {}

  constructor(private readonly options: RockBotServiceOptions) {}

  /** Load the persisted lists (empty before {@link load} completes). */
  async load(): Promise<void> {
    this.bots = (await this.options.store.load()).map(normalizeBot)
    if (this.options.bindingsStore !== undefined) {
      this.bindings = await this.options.bindingsStore.load()
    }
    if (this.options.deploymentsStore !== undefined) {
      this.deployments = await this.options.deploymentsStore.load()
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

  /** One bot's persisted deployment record, or `undefined`. */
  getDeployment(agentBotId: string): DeploymentRecord | undefined {
    return this.deployments[agentBotId]
  }

  /** All persisted deployment records keyed by bot id. */
  listDeployments(): Record<string, DeploymentRecord> {
    return { ...this.deployments }
  }

  /** Persist one bot's deployment record. */
  async setDeployment(record: DeploymentRecord): Promise<void> {
    this.deployments = { ...this.deployments, [record.agentBotId]: record }
    if (this.options.deploymentsStore !== undefined) await this.options.deploymentsStore.save(this.deployments)
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

/** API protocol identifiers accepted by a custom bot. */
const API_PROTOCOLS: ReadonlySet<string> = new Set<ApiProtocol>(['openai-chat', 'openai-responses', 'anthropic', 'gemini'])

/** Model input modality identifiers accepted by a custom bot. */
const INPUT_TYPES: ReadonlySet<string> = new Set<BotInputType>(['text', 'image'])

/** A bot id is a non-empty string. */
function validId(id: string): boolean {
  return typeof id === 'string' && id.length > 0
}

/** A tool binding carries a non-empty tool type. */
function normalizeTool(botId: string, tool: BotTool | undefined): BotTool | undefined {
  if (tool === undefined) return undefined
  if (typeof tool.toolType !== 'string' || tool.toolType.length === 0) {
    throw new Error(`bot "${botId}" tool needs a non-empty toolType`)
  }
  return { toolType: tool.toolType }
}

/** A positive integer token limit. */
function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Validate and clone one bot's reasoning-effort mapping. */
function normalizeReasoning(botId: string, reasoning: BotReasoning): BotReasoning {
  if (typeof reasoning.enabled !== 'boolean') throw new Error(`bot "${botId}" llm reasoning.enabled must be a boolean`)
  if (!Array.isArray(reasoning.levels)) throw new Error(`bot "${botId}" llm reasoning.levels must be an array`)
  const levels = reasoning.levels.map((row, index) => {
    if (typeof row.level !== 'string' || row.level.length === 0) {
      throw new Error(`bot "${botId}" llm reasoning.levels[${index}] needs a non-empty level`)
    }
    if (typeof row.value !== 'string' && typeof row.value !== 'number') {
      throw new Error(`bot "${botId}" llm reasoning.levels[${index}] value must be a string or number`)
    }
    return { level: row.level, value: row.value }
  })
  return { enabled: reasoning.enabled, levels }
}

/** Validate and clone one bot's upstream LLM route, dropping unknown or empty optional fields. */
function normalizeLlm(botId: string, llm: BotLlm): BotLlm {
  if (typeof llm.provider !== 'string' || llm.provider.length === 0) throw new Error(`bot "${botId}" llm needs a non-empty provider`)
  if (typeof llm.model !== 'string' || llm.model.length === 0) throw new Error(`bot "${botId}" llm needs a non-empty model`)
  if (llm.protocol !== undefined && !API_PROTOCOLS.has(llm.protocol)) {
    throw new Error(`bot "${botId}" llm protocol "${llm.protocol}" is not supported`)
  }
  if (llm.contextWindow !== undefined && !isPositiveInt(llm.contextWindow)) {
    throw new Error(`bot "${botId}" llm contextWindow must be a positive integer`)
  }
  if (llm.maxOutputTokens !== undefined && !isPositiveInt(llm.maxOutputTokens)) {
    throw new Error(`bot "${botId}" llm maxOutputTokens must be a positive integer`)
  }
  if (llm.inputTypes !== undefined) {
    if (!Array.isArray(llm.inputTypes)) throw new Error(`bot "${botId}" llm inputTypes must be an array`)
    if (llm.inputTypes.some(type => !INPUT_TYPES.has(type))) {
      throw new Error(`bot "${botId}" llm inputTypes contains an unsupported value`)
    }
  }
  const reasoning = llm.reasoning === undefined ? undefined : normalizeReasoning(botId, llm.reasoning)
  return {
    provider: llm.provider,
    ...llm.name === undefined ? {} : { name: llm.name },
    ...llm.baseUrl === undefined ? {} : { baseUrl: llm.baseUrl },
    ...llm.protocol === undefined ? {} : { protocol: llm.protocol },
    ...llm.apiKeyRef === undefined ? {} : { apiKeyRef: llm.apiKeyRef },
    ...llm.apiKey === undefined ? {} : { apiKey: llm.apiKey },
    model: llm.model,
    ...llm.modelName === undefined ? {} : { modelName: llm.modelName },
    ...llm.contextWindow === undefined ? {} : { contextWindow: llm.contextWindow },
    ...llm.maxOutputTokens === undefined ? {} : { maxOutputTokens: llm.maxOutputTokens },
    ...llm.inputTypes === undefined ? {} : { inputTypes: [...llm.inputTypes] },
    ...reasoning === undefined ? {} : { reasoning },
  }
}

/** Validate and clone one bot definition, dropping unknown top-level fields. */
function normalizeBot(bot: BotDefinition): BotDefinition {
  if (!validId(bot.id)) throw new Error('bot id must be a non-empty string')
  if (typeof bot.name !== 'string' || bot.name.length === 0) throw new Error(`bot "${bot.id}" name must be a non-empty string`)
  const tool = normalizeTool(bot.id, bot.tool)
  return {
    id: bot.id,
    name: bot.name,
    ...bot.role === undefined ? {} : { role: bot.role },
    llm: normalizeLlm(bot.id, bot.llm),
    ...tool === undefined ? {} : { tool },
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
