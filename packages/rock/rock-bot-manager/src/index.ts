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
 *     storePath: ../.rock/bots.json
 * ```
 *
 * @module @rock/rock-bot-manager
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: brings the `rock-tool-inventory/detected` event declaration into scope.
import type {} from '@rock/rock-tool-inventory'
import { installedToolIds, type InstalledStatus } from './installed.ts'
import { buildLlmProxyChecklist, RELAY_MODEL } from './proxy.ts'
import { RockBotService } from './service.ts'
import { JsonFileBindingStore, JsonFileBotStore } from './store.ts'
import { activeBotIdsFrom } from './tasks.ts'
import { presetForToolType } from './tool-preset.ts'
import { buildUnifiedBots } from './unify.ts'
import type { BotDefinition, BotInput, BotModelInfo, BotRow, BotTestResult, LlmProxyChecklist } from './types.ts'

export { presetForToolType } from './tool-preset.ts'
export type * from './types.ts'

const DEFAULT_STORE_PATH = '../.rock/bots.json'
const DEFAULT_BINDINGS_PATH = '../.rock/bindings.json'

/** Tool types the binding selector offers before deployment overrides them. */
const DEFAULT_TOOL_TYPES = ['codex', 'pi', 'opencode', 'dsh', 'acp', 'claude-code']

/** The dedicated-assistant-style cloud route used to drive the thin-relay test session. */
const TEST_PROVIDER = 'seagull-cloud'
const TEST_MODEL = 'seagull-relay'

/** The fixed smoke-test prompt the card's "test" action sends through the bound backend. */
const TEST_PROMPT = '请查询并回答当前北京的天气'

/** Default wall-clock timeout for one thin-relay test run. */
const DEFAULT_TEST_TIMEOUT_MS = 120_000

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
  /** Wall-clock timeout for one thin-relay test run; defaults to {@link DEFAULT_TEST_TIMEOUT_MS}. */
  testTimeoutMs?: number
}

/** The seagull-identity service surface the unified list reads, structurally typed to avoid a package cycle. */
interface IdentityLike {
  getClaims(): readonly { agentBotId: string; name?: string; role?: string; model?: BotModelInfo; projectId?: string }[]
  getAssistants(): readonly { agentBotId: string; name?: string; role?: string; model?: BotModelInfo; projectId?: string }[]
  toolBindingOf(id: string): string
  sync(): Promise<void>
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
    testTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TEST_TIMEOUT_MS),
  })

  private readonly service: RockBotService
  private readonly config: Config
  private readonly detectedListeners = new Set<() => void>()
  private detectedRevision = 0
  private readonly pendingTests = new Map<SessionId, PendingTest>()

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
    ctx.effect(() => () => {
      for (const listener of this.detectedListeners) listener()
      this.detectedListeners.clear()
      for (const [sessionId, pending] of this.pendingTests) {
        pending.resolve({ ok: false, toolType: pending.toolType, error: 'service disposed' })
        this.pendingTests.delete(sessionId)
      }
    }, 'rock-bot-manager: close detection followers and settle pending tests')
    ctx.on('rock-tool-inventory/detected', () => { this.publishDetected() })
    ctx.on('session/event', (session: Session, event: SessionEvent) => { this.recordTestEvent(session, event) })
  }

  /** Advance the detection revision and wake every `watchDetected` follower. */
  private publishDetected(): void {
    this.detectedRevision += 1
    for (const listener of this.detectedListeners) listener()
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

  /** Registered LLM provider routes for the add/edit form's provider selector. */
  @Remote
  providers(): Array<{ id: string; name: string }> {
    return this.optionalLlm()?.listProviders() ?? []
  }

  /** DSH custom-model-API checklist for one cloud bot (D-034); null for local bots. */
  @Remote
  getLlmProxy(id: string): LlmProxyChecklist | null {
    if (this.service.get(id) !== undefined) return null
    const relay = this.optionalRelay()
    if (relay === undefined) throw new RemoteError('rockBots/invalid', 'llm relay unavailable', {})
    const ref = this.cloudBotRef(id)
    const name = ref?.name ?? id
    const modelId = ref?.model?.model ?? RELAY_MODEL
    return buildLlmProxyChecklist(id, name, modelId, relay.getFacts())
  }

  /** Unified bot rows across local, claimed, and assistant sources (D-036). */
  @Remote
  async listBotsUnified(): Promise<BotRow[]> {
    const identity = this.optionalIdentity()
    if (identity !== undefined) {
      try {
        await identity.sync()
      } catch (error) {
        // Keep the last-known claims/assistants when the gateway is unreachable.
        this.ctx.logger.warn(`rock-bot-manager: identity re-sync failed: ${messageOf(error)}`)
      }
    }
    const activeIds = new Set(activeBotIdsFrom(await this.fetchTasks()))
    const projectNameById = new Map((this.optionalWorkspace()?.listProjects() ?? []).map(project => [project.id, project.name]))
    return buildUnifiedBots({
      localBots: this.service.list(),
      claimed: identity === undefined ? [] : identity.getClaims().map(claim => ({
        agentBotId: claim.agentBotId,
        ...claim.name === undefined ? {} : { name: claim.name },
        ...claim.role === undefined ? {} : { role: claim.role },
        ...claim.model === undefined ? {} : { model: claim.model },
        ...claim.projectId === undefined ? {} : { projectId: claim.projectId },
        canRebind: true,
      })),
      assistants: identity === undefined ? [] : identity.getAssistants().map(assistant => ({
        agentBotId: assistant.agentBotId,
        ...assistant.name === undefined ? {} : { name: assistant.name },
        ...assistant.role === undefined ? {} : { role: assistant.role },
        ...assistant.model === undefined ? {} : { model: assistant.model },
        ...assistant.projectId === undefined ? {} : { projectId: assistant.projectId },
        canRebind: false,
      })),
      activeIds,
      bindingOf: id => this.service.getBinding(id) ?? identity?.toolBindingOf(id) ?? 'codex',
      projectNameOf: projectId => projectNameById.get(projectId),
    })
  }

  /** Tool type ids detected as installed on this machine. */
  @Remote
  async installedTools(): Promise<string[]> {
    const inventory = this.optionalInventory()
    if (inventory === undefined) return []
    return installedToolIds(await inventory.listTools(), inventory.detectState().statuses)
  }

  /**
   * Stream the detection revision, waking on each completed detection run so
   * the client can re-read {@link installedTools} without polling.
   * @param signal - subscriber lifetime.
   * @returns the current revision after each completed detection run.
   */
  @Remote({ mode: 'stream' })
  async *watchDetected(signal: AbortSignal): AsyncIterable<number> {
    let update = Promise.withResolvers<void>()
    const changed = (): void => { update.resolve() }
    this.detectedListeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted) {
        yield this.detectedRevision
        await update.promise
        update = Promise.withResolvers<void>()
      }
    } finally {
      this.detectedListeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
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

  /**
   * Run one bound tool's smoke-test through its thin-relay preset: the bot's
   * delegator agent forwards the fixed prompt to the bound `subagent-*` provider
   * (the service channel), and the assistant output is returned. Falls back to a
   * structured failure when the agent runtime is unavailable or the launch fails.
   */
  @Remote
  async testBot(id: string): Promise<BotTestResult> {
    const bot = this.service.get(id)
    if (bot === undefined) throw new RemoteError('rockBots/unknown', `no bot with id "${id}"`, {})
    const toolType = bot.tool.toolType
    const presetId = presetForToolType(toolType)
    const agentPresets = this.optionalAgentPresets()
    const agents = this.optionalAgents()
    if (agentPresets === undefined || agents === undefined) {
      return { ok: false, toolType, error: 'agent runtime unavailable' }
    }
    let result: Promise<BotTestResult>
    try {
      const preset = await agentPresets.resolve(presetId)
      await using scope = await agentPresets.acquireScope(preset.id)
      void scope
      const sessionId = brandString<SessionId>(`bot-test-${randomUUID()}`)
      const agentOptions: AgentOptions = { provider: TEST_PROVIDER, model: TEST_MODEL, agentId: id }
      const handle = await agents.create({
        sessionId,
        meta: { agentPreset: preset.id },
        agentOptions,
        setup: async (agentCtx) => { await agentPresets.mount(agentCtx, preset.id) },
      })
      result = this.awaitTestResult(sessionId, toolType)
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: TEST_PROMPT }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      return { ok: false, toolType, error: messageOf(error) }
    }
    return await result
  }

  /** Fetch the cloud task queue; an empty list when unconfigured or unreachable. */
  private async fetchTasks(): Promise<Array<Record<string, unknown>>> {
    const url = this.config.tasksUrl
    const employeeId = this.optionalOnboarding()?.getRecord()?.employeeId ?? this.config.employeeId
    if (url === undefined || employeeId === undefined || url.length === 0 || employeeId.length === 0) {
      this.ctx.logger.warn('rock-bot-manager: tasksUrl or employeeId unconfigured; returning an empty task list')
      return []
    }
    const requestUrl = `${url}?employeeId=${encodeURIComponent(employeeId)}`
    try {
      const response = await fetch(requestUrl)
      if (!response.ok) {
        this.ctx.logger.warn(`rock-bot-manager: tasks fetch failed HTTP ${response.status} for ${requestUrl}`)
        return []
      }
      const body = (await response.json()) as { data?: { tasks?: unknown } }
      const tasks = Array.isArray(body.data?.tasks) ? body.data.tasks as Array<Record<string, unknown>> : []
      this.ctx.logger.info(`rock-bot-manager: fetched ${tasks.length} task(s) for employee ${employeeId}`)
      return tasks
    } catch (error) {
      this.ctx.logger.warn(`rock-bot-manager: tasks fetch failed for ${requestUrl}: ${messageOf(error)}`)
      return []
    }
  }

  /** The optional onboarding service, structurally typed to avoid a package cycle. */
  private optionalOnboarding(): { getRecord(): { employeeId: string } | null } | undefined {
    return this.ctx.get('rockOnboarding') as { getRecord(): { employeeId: string } | null } | undefined
  }

  /** The optional identity service, structurally typed to avoid a package cycle. */
  private optionalIdentity(): IdentityLike | undefined {
    return this.ctx.get('seagullIdentity') as IdentityLike | undefined
  }

  /** The optional tool-inventory service, structurally typed to avoid a package cycle. */
  private optionalInventory(): {
    listTools(): Promise<InstalledStatus[]>
    detectState(): { statuses: readonly InstalledStatus[] }
  } | undefined {
    return this.ctx.get('rockToolInventory')
  }

  /** The optional workspace service, structurally typed to avoid a package cycle. */
  private optionalWorkspace(): { listProjects(): Array<{ id: string; name: string }> } | undefined {
    return this.ctx.get('rockWorkspace') as { listProjects(): Array<{ id: string; name: string }> } | undefined
  }

  /** The optional LLM relay facts service, structurally typed to avoid a package cycle. */
  private optionalRelay(): { getFacts(): { baseUrl: string; apiKey: string } } | undefined {
    return this.ctx.get('rockLlmRelay') as { getFacts(): { baseUrl: string; apiKey: string } } | undefined
  }

  /** Resolve a cloud bot's name + model summary from the identity service, or undefined. */
  private cloudBotRef(id: string): { name?: string; model?: BotModelInfo } | undefined {
    const identity = this.optionalIdentity()
    if (identity === undefined) return undefined
    return [...identity.getClaims(), ...identity.getAssistants()].find(item => item.agentBotId === id)
  }

  /** The optional LLM runtime, structurally typed to avoid a package cycle. */
  private optionalLlm(): { listProviders(): Array<{ id: string; name: string }> } | undefined {
    return this.ctx.get('llm')
  }

  /** The optional agent-preset registry, structurally typed to avoid a package cycle. */
  private optionalAgentPresets(): {
    resolve(id: string): Promise<{ id: string }>
    acquireScope(id: string): Promise<{ key: unknown } & AsyncDisposable>
    mount(ctx: Context, id: string): Promise<unknown>
  } | undefined {
    return this.ctx.get('agentPresets')
  }

  /** The optional agent runtime, structurally typed to avoid a package cycle. */
  private optionalAgents(): {
    create(options: {
      sessionId: SessionId
      meta?: { agentPreset?: string }
      agentOptions?: AgentOptions
      setup?: (agentCtx: Context) => Promise<void>
    }): Promise<{ agent: { followup(message: unknown): void } }>
  } | undefined {
    return this.ctx.get('agents')
  }

  /** Fold session events for an in-flight test run and settle it on turn end. */
  private recordTestEvent(session: Session, event: SessionEvent): void {
    const pending = this.pendingTests.get(session.id)
    if (pending === undefined) return
    if (event.type === 'assistant/message') {
      const content = event.data.message.content
      if (content.length > 0) pending.message = content
    } else if (event.type === 'turn/end') {
      const text = blocksToText(pending.message ?? [])
      pending.resolve({
        ok: text.length > 0,
        toolType: pending.toolType,
        ...(text.length > 0 ? { answer: text } : { error: 'tool produced no output' }),
      })
    }
  }

  /** Register an in-flight test session and settle on turn end or timeout. */
  private awaitTestResult(sessionId: SessionId, toolType: string): Promise<BotTestResult> {
    return new Promise<BotTestResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTests.delete(sessionId)
        resolve({ ok: false, toolType, error: 'test timed out' })
      }, this.config.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS)
      this.pendingTests.set(sessionId, {
        toolType,
        resolve: (result) => {
          clearTimeout(timer)
          this.pendingTests.delete(sessionId)
          resolve(result)
        },
      })
    })
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

/** One in-flight thin-relay test run awaiting its turn end. */
interface PendingTest {
  /** The bound tool type, echoed into the result. */
  toolType: string
  /** The last non-empty assistant message content, or undefined. */
  message?: readonly ContentBlock[]
  /** Settle the run; clears its timeout and removes the pending entry. */
  resolve: (result: BotTestResult) => void
}

/** Join the text blocks of assistant content into one trimmed string. */
function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local bot registry Remote (create/update/remove/list persisted bots). */
    rockBots: RockBotController
  }
}
