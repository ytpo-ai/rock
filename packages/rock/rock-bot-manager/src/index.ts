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
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
// Type-only: brings the `rock-tool-inventory/detected` event declaration into scope.
import type {} from '@rock/rock-tool-inventory'
import { installedToolIds, type InstalledStatus } from './installed.ts'
import { buildLlmProxyChecklist, RELAY_MODEL } from './proxy.ts'
import { RockBotService } from './service.ts'
import { JsonFileBindingStore, JsonFileBotStore, JsonFileDeploymentStore } from './store.ts'
import { activeBotIdsFrom } from './tasks.ts'
import { presetForToolType } from './tool-preset.ts'
import { buildUnifiedBots, resolveBotToolType } from './unify.ts'
import type { BotDebugState, BotDeployState, BotDeploymentRow, BotDefinition, BotInput, BotModelInfo, BotRow, BotTestResult, LlmProxyChecklist } from './types.ts'

export { presetForToolType } from './tool-preset.ts'
export type * from './types.ts'

const DEFAULT_STORE_PATH = '../.rock/bots.json'
const DEFAULT_BINDINGS_PATH = '../.rock/bindings.json'
const DEFAULT_DEPLOYMENTS_PATH = '../.rock/deployments.json'

/** Thin-relay assistant preset id used to drive a skill-based deployment. */
const ASSISTANT_PRESET = 'assistant'

/** Execution backend → config skill slug. */
const DEPLOY_SKILLS: Readonly<Record<string, string>> = {
  codex: 'rock-config-codex',
  dsh: 'rock-config-dsh',
  opencode: 'rock-config-opencode',
}

/** Tool types the binding selector offers before deployment overrides them. */
const DEFAULT_TOOL_TYPES = ['codex', 'pi', 'opencode', 'dsh', 'acp', 'claude-code']

/** The dedicated-assistant-style cloud route used to drive the thin-relay test session. */
const TEST_PROVIDER = 'seagull-cloud'
const TEST_MODEL = 'seagull-relay'

/** The fixed smoke-test prompt the card's "debug" action sends through the bound backend. */
const DEBUG_TASK = '请查询并回答当前北京的天气'

/** Build the debug prompt, prefixed with the bot name so the session title stays clear. */
function debugPrompt(botName: string): string {
  return `调试Bot【${botName}】\n${DEBUG_TASK}`
}

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
  /** JSON file persisting Rock-recorded deployment state. */
  deploymentsPath?: string
}

/** The seagull-identity service surface the unified list reads, structurally typed to avoid a package cycle. */
interface IdentityLike {
  getClaims(): readonly { agentBotId: string; name?: string; role?: string; model?: BotModelInfo; projectId?: string }[]
  getAssistants(): readonly { agentBotId: string; name?: string; role?: string; model?: BotModelInfo; projectId?: string }[]
  toolBindingOf(id: string): string | undefined
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
    deploymentsPath: z.string().min(1).default(DEFAULT_DEPLOYMENTS_PATH),
  })

  private readonly service: RockBotService
  private readonly config: Config
  private readonly detectedListeners = new Set<() => void>()
  private detectedRevision = 0
  private debug: BotDebugState = { running: false, progress: { total: 1, detected: 0, steps: 0 } }
  private debugSessionId: SessionId | undefined
  private debugToolType: string | undefined
  private debugAssistantText = ''
  private debugDelegated = false
  private deployState: BotDeployState = { running: false, total: 0, done: 0 }
  private deployQueue: ResolvedDeployBot[] = []
  private deployCurrent: ResolvedDeployBot | undefined
  private deploySessionId: SessionId | undefined
  private deployAssistantText = ''

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockBots')
    this.config = config
    this.service = new RockBotService({
      store: new JsonFileBotStore(config.storePath ?? DEFAULT_STORE_PATH),
      bindingsStore: new JsonFileBindingStore(config.bindingsPath ?? DEFAULT_BINDINGS_PATH),
      deploymentsStore: new JsonFileDeploymentStore(config.deploymentsPath ?? DEFAULT_DEPLOYMENTS_PATH),
    })
    void this.service.load().then(() => {
      this.resetStaleDeployments()
      ctx.logger.info(`rock-bot-manager: loaded ${this.service.list().length} local bot(s)`)
    }, (error: unknown) => {
      ctx.logger.warn(`rock-bot-manager: failed to load bots: ${messageOf(error)}`)
    })
    ctx.effect(() => () => {
      for (const listener of this.detectedListeners) listener()
      this.detectedListeners.clear()
      if (this.debug.running) {
        this.debug = { ...this.debug, running: false, error: 'service disposed' }
      }
    }, 'rock-bot-manager: close detection followers and settle pending debug runs')
    ctx.on('rock-tool-inventory/detected', () => { this.publishDetected() })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.recordTestEvent(session, event)
      this.recordDeployEvent(session, event)
    })
    ctx.on('subagent/start', (info: SubagentRunInfo) => {
      if (this.debugSessionId === undefined || info.parentSessionId !== this.debugSessionId) return
      this.ctx.logger.info(`rock-bot-manager: debug delegated (${info.provider})`)
      this.debugDelegated = true
    })
    ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
      if (this.debugSessionId === undefined || info.parentSessionId !== this.debugSessionId) return
      this.finalizeTestFromChild(info)
    })
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
      bindingOf: id => this.resolveBinding(id),
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
   * Resolve a bot's execution-backend binding across the persisted binding
   * store and the identity service; `undefined` when the bot is unbound.
   */
  private resolveBinding(id: string): string | undefined {
    const identity = this.optionalIdentity()
    return this.service.getBinding(id) ?? identity?.toolBindingOf(id)
  }

  /**
   * Resolve a bot id to its display name, execution-backend tool binding, and
   * delegator LLM route. Reports an id outside the three bot sources as
   * `unknown`, and a bot without any execution backend as `unbound`. Local bots
   * route through their own `llm`; cloud bots route through the seagull-cloud
   * relay keyed by their agent-bot id, carrying their bound model name (falling
   * back to the `seagull-relay` placeholder when the claim has no model).
   */
  private resolveDebugBot(id: string): DebugResolution {
    const local = this.service.get(id)
    const identity = this.optionalIdentity()
    const cloudRefs = [...(identity?.getClaims() ?? []), ...(identity?.getAssistants() ?? [])]
    const cloud = cloudRefs.find(item => item.agentBotId === id)
    if (local === undefined && cloud === undefined) return { kind: 'unknown' }
    const cloudIds = new Set(cloudRefs.map(item => item.agentBotId))
    const toolType = resolveBotToolType(id, this.service.list(), cloudIds, botId => this.resolveBinding(botId))
    const name = local?.name ?? cloud?.name ?? id
    if (toolType === undefined) return { kind: 'unbound', name }
    if (local !== undefined) {
      return {
        kind: 'ok',
        bot: { id, name: local.name, toolType, agentOptions: { provider: local.llm.provider, model: local.llm.model } },
      }
    }
    return {
      kind: 'ok',
      bot: {
        id,
        name,
        toolType,
        agentOptions: { provider: TEST_PROVIDER, model: cloud?.model?.model ?? TEST_MODEL, agentId: id },
      },
    }
  }

  /** A deployment cannot survive a process restart; settle orphaned `deploying` rows as failed. */
  private resetStaleDeployments(): void {
    for (const [id, record] of Object.entries(this.service.listDeployments())) {
      if (record.status !== 'deploying') continue
      void this.service.setDeployment({
        ...record,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: 'deployment interrupted by restart; redeploy',
      }).catch((error: unknown) => {
        this.ctx.logger.warn(`rock-bot-manager: reset stale deployment "${id}" failed: ${messageOf(error)}`)
      })
    }
  }

  /**
   * All bots with Rock-recorded deployment status (`undeployed` when Rock has
   * no record). The management panel filters `undeployed` for the deploy dialog.
   */
  @Remote
  async listDeployableBots(): Promise<BotDeploymentRow[]> {
    const rows = await this.listBotsUnified()
    const deployments = this.service.listDeployments()
    return rows.map((row) => {
      const record = deployments[row.id]
      return {
        id: row.id,
        name: row.name,
        ...row.tool === undefined ? {} : { toolType: row.tool.toolType },
        status: record?.status ?? 'undeployed',
        deployable: this.resolveDeployBot(row.id) !== undefined,
        ...(record?.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
        ...(record?.error === undefined ? {} : { error: record.error }),
      }
    })
  }

  /** Current deployment batch state (running / total / done / current / last). */
  @Remote
  deploymentState(): BotDeployState {
    return this.deployState
  }

  /** Queue one bot's deployment to its bound execution backend and start the queue. */
  @Remote
  deployBot(id: string): void {
    if (this.deployState.running) {
      throw new RemoteError('rockBots/invalid', 'a deployment batch is already running', {})
    }
    const bot = this.requireDeployBot(id)
    this.deployQueue = [bot]
    this.deployState = { running: true, total: 1, done: 0 }
    void this.runDeployQueue()
  }

  /** Queue every not-yet-deployed bot (serial) and start the batch. */
  @Remote
  async deployAll(): Promise<void> {
    if (this.deployState.running) {
      throw new RemoteError('rockBots/invalid', 'a deployment batch is already running', {})
    }
    const rows = await this.listDeployableBots()
    const pending: ResolvedDeployBot[] = []
    for (const row of rows) {
      if (!row.deployable) continue
      if (row.status === 'deployed' || row.status === 'deploying') continue
      const bot = this.resolveDeployBot(row.id)
      if (bot !== undefined) pending.push(bot)
    }
    this.deployQueue = pending
    this.deployState = { running: pending.length > 0, total: pending.length, done: 0 }
    if (pending.length > 0) void this.runDeployQueue()
  }

  /** Resolve the deployable surface (name/tool/skill/checklist) for one bot, or undefined. */
  private resolveDeployBot(id: string): ResolvedDeployBot | undefined {
    const resolved = this.resolveDebugBot(id)
    if (resolved.kind !== 'ok') return undefined
    const bot = resolved.bot
    const skillSlug = DEPLOY_SKILLS[bot.toolType]
    if (skillSlug === undefined) return undefined
    const checklist = this.getLlmProxy(bot.id)
    if (checklist === null) return undefined
    return { id: bot.id, name: bot.name, toolType: bot.toolType, skillSlug, checklist }
  }

  /**
   * Resolve one bot for deployment, reporting why it cannot deploy:
   * `unknown` for an id outside the three sources, `unbound` before the user
   * binds an execution backend, and `invalid` for a backend without a deploy skill.
   */
  private requireDeployBot(id: string): ResolvedDeployBot {
    const resolved = this.resolveDebugBot(id)
    if (resolved.kind === 'unknown') throw new RemoteError('rockBots/unknown', `no bot with id "${id}"`, {})
    if (resolved.kind === 'unbound') {
      throw new RemoteError('rockBots/unbound', `bot "${resolved.name}" has no execution backend; bind one before deploying`, {})
    }
    const bot = this.resolveDeployBot(id)
    if (bot === undefined) {
      throw new RemoteError('rockBots/invalid', `bot "${id}" cannot be deployed (no relay checklist or deploy skill)`, {})
    }
    return bot
  }

  /** Start the next queued deployment, marking it `deploying` first. */
  private async runDeployQueue(): Promise<void> {
    const next = this.deployQueue.shift()
    if (next === undefined) {
      this.deployState = { ...this.deployState, running: false, current: undefined }
      return
    }
    this.deployCurrent = next
    this.deployState = { ...this.deployState, current: next.id }
    try {
      await this.service.setDeployment({
        agentBotId: next.id,
        toolType: next.toolType,
        status: 'deploying',
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      this.ctx.logger.warn(`rock-bot-manager: persist deploying state failed: ${messageOf(error)}`)
    }
    void this.launchDeploy(next)
  }

  /** Start one deployment through the dedicated assistant (skill-driven). */
  private async launchDeploy(bot: ResolvedDeployBot): Promise<void> {
    const agentPresets = this.optionalAgentPresets()
    const agents = this.optionalAgents()
    if (agentPresets === undefined || agents === undefined) {
      this.settleDeploy(bot.id, 'failed', 'agent runtime unavailable')
      return
    }
    const assistantId = this.optionalIdentity()?.getAssistants()[0]?.agentBotId
    if (assistantId === undefined) {
      this.settleDeploy(bot.id, 'failed', 'assistant identity not synced')
      return
    }
    try {
      const preset = await agentPresets.resolve(ASSISTANT_PRESET)
      await using scope = await agentPresets.acquireScope(preset.id)
      void scope
      const workspace = await this.resolveWorkspace()
      const sessionId = brandString<SessionId>(`bot-deploy-${randomUUID()}`)
      const handle = await agents.create({
        sessionId,
        meta: {
          agentPreset: preset.id,
          ...(workspace === undefined ? {} : { cwd: workspace.path }),
        },
        agentOptions: { provider: TEST_PROVIDER, model: TEST_MODEL, agentId: assistantId },
        setup: async (agentCtx) => { await agentPresets.mount(agentCtx, preset.id) },
      })
      this.deploySessionId = sessionId
      if (workspace !== undefined) {
        await workspace.attachSession(sessionId).catch((error: unknown) => {
          this.ctx.logger.warn(`rock-bot-manager: attach deploy session failed: ${messageOf(error)}`)
        })
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: deployPrompt(bot) }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      this.settleDeploy(bot.id, 'failed', messageOf(error))
    }
  }

  /** Fold deploy-session assistant output and settle the deployment on turn end. */
  private recordDeployEvent(session: Session, event: SessionEvent): void {
    if (this.deploySessionId === undefined || session.id !== this.deploySessionId) return
    if (event.type === 'assistant/message') {
      const text = blocksToText(event.data.message.content)
      if (text.length > 0) this.deployAssistantText = text
    } else if (event.type === 'turn/end') {
      const current = this.deployCurrent
      if (current === undefined) return
      const ok = /"ok"\s*:\s*true/.test(this.deployAssistantText)
      const diagnostic = this.deployAssistantText.length > 0
        ? this.deployAssistantText.slice(0, 500)
        : `assistant turn ended: ${event.data.reason.kind}`
      this.settleDeploy(current.id, ok ? 'deployed' : 'failed', ok ? undefined : diagnostic)
    }
  }

  /** Persist one deployment outcome, advance the batch, and start the next. */
  private settleDeploy(id: string, status: 'deployed' | 'failed', error?: string): void {
    const toolType = this.deployCurrent?.toolType ?? ''
    this.deployCurrent = undefined
    this.deploySessionId = undefined
    this.deployAssistantText = ''
    void this.service.setDeployment({
      agentBotId: id,
      toolType,
      status,
      updatedAt: new Date().toISOString(),
      ...(error === undefined || error.length === 0 ? {} : { error }),
    }).catch((persistError: unknown) => {
      this.ctx.logger.warn(`rock-bot-manager: persist deployment result failed: ${messageOf(persistError)}`)
    })
    this.deployState = {
      ...this.deployState,
      done: this.deployState.done + 1,
      last: { id, status },
    }
    if (this.deployQueue.length > 0) {
      void this.runDeployQueue()
    } else {
      this.deployState = { ...this.deployState, running: false, current: undefined }
    }
  }

  /**
   * Start one smoke-test through the bot's thin-relay preset: the delegator
   * agent forwards the fixed prompt to the bound `subagent-*` provider and the
   * assistant output is returned. Returns immediately with `running: true`; the
   * result and progress stream in via {@link testState}.
   */
  @Remote
  testBot(id: string): Promise<BotDebugState> {
    if (this.debug.running) return Promise.resolve(this.debug)
    const resolved = this.resolveDebugBot(id)
    if (resolved.kind === 'unknown') throw new RemoteError('rockBots/unknown', `no bot with id "${id}"`, {})
    if (resolved.kind === 'unbound') {
      throw new RemoteError('rockBots/unbound', `bot "${resolved.name}" has no execution backend; bind one before debugging`, {})
    }
    const bot = resolved.bot
    this.debug = {
      running: true,
      botId: id,
      botName: bot.name,
      toolType: bot.toolType,
      progress: { total: 1, detected: 0, steps: 0, current: bot.toolType },
    }
    this.debugSessionId = undefined
    this.debugToolType = bot.toolType
    this.debugAssistantText = ''
    this.debugDelegated = false
    void this.launchTest(bot)
    return Promise.resolve(this.debug)
  }

  /** Latest per-bot debug run state (result + progress; the process renders in the DSH session). */
  @Remote
  testState(): BotDebugState {
    return this.debug
  }

  /** Launch the thin-relay debug session in the default workspace and submit the debug prompt. */
  private async launchTest(bot: ResolvedDebugBot): Promise<void> {
    const agentPresets = this.optionalAgentPresets()
    const agents = this.optionalAgents()
    if (agentPresets === undefined || agents === undefined) {
      this.settleDebugError('agent runtime unavailable')
      return
    }
    try {
      const preset = await agentPresets.resolve(presetForToolType(bot.toolType))
      await using scope = await agentPresets.acquireScope(preset.id)
      void scope
      const workspace = await this.resolveWorkspace()
      const sessionId = brandString<SessionId>(`bot-test-${randomUUID()}`)
      const handle = await agents.create({
        sessionId,
        meta: {
          agentPreset: preset.id,
          ...(workspace === undefined ? {} : { cwd: workspace.path }),
        },
        agentOptions: bot.agentOptions,
        setup: async (agentCtx) => { await agentPresets.mount(agentCtx, preset.id) },
      })
      this.debugSessionId = sessionId
      this.debug = { ...this.debug, sessionId: String(sessionId) }
      if (workspace !== undefined) {
        await workspace.attachSession(sessionId).catch((error: unknown) => {
          this.ctx.logger.warn(`rock-bot-manager: attach session ${String(sessionId)} to workspace failed: ${messageOf(error)}`)
        })
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: debugPrompt(bot.name) }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      this.settleDebugError(messageOf(error))
    }
  }

  /** Settle the debug run with a safe failure diagnostic. */
  private settleDebugError(error: string): void {
    this.debug = { ...this.debug, running: false, error }
    this.debugSessionId = undefined
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
      meta?: { agentPreset?: string; cwd?: string }
      agentOptions?: AgentOptions
      setup?: (agentCtx: Context) => Promise<void>
    }): Promise<{ agent: { followup(message: unknown): void } }>
  } | undefined {
    return this.ctx.get('agents')
  }

  /** Resolve the default workspace so the debug session groups there; fall back to the Rock root. */
  private async resolveWorkspace(): Promise<{ path: string; attachSession(id: SessionId): Promise<void> } | undefined> {
    const registry = this.ctx.get('workspaceRegistry') as {
      initializeDefault(resolveDirectory: () => Promise<string>):
      Promise<{ path: string; attachSession(id: SessionId): Promise<void> } | undefined>
      create(path: string): Promise<{ path: string; attachSession(id: SessionId): Promise<void> }>
    } | undefined
    if (registry === undefined) return undefined
    const fallback = this.rockRoot()
    try {
      const workspace = await registry.initializeDefault(() => Promise.resolve(fallback))
      if (workspace !== undefined) return workspace
    } catch (error) {
      this.ctx.logger.warn(`rock-bot-manager: resolve default workspace failed: ${messageOf(error)}`)
    }
    try {
      return await registry.create(fallback)
    } catch (error) {
      this.ctx.logger.warn(`rock-bot-manager: create workspace at "${fallback}" failed: ${messageOf(error)}`)
      return undefined
    }
  }

  /** The Rock workspace root as a fallback cwd; the process cwd when uninitialized. */
  private rockRoot(): string {
    const rock = this.ctx.get('rockWorkspace') as { rootPath(): string | null } | undefined
    return rock?.rootPath() ?? process.cwd()
  }

  /** Fold session events for the in-flight debug run and settle it on turn end. */
  private recordTestEvent(session: Session, event: SessionEvent): void {
    if (session.id !== this.debugSessionId) return
    if (event.type === 'assistant/message') {
      const text = blocksToText(event.data.message.content)
      if (text.length > 0) this.debugAssistantText = text
    } else if (event.type === 'tool/call') {
      if (event.data.name === 'subagent') this.debugDelegated = true
      this.debug.progress = {
        total: 1,
        detected: 1,
        ...(this.debugToolType === undefined ? {} : { current: this.debugToolType }),
        steps: this.debug.progress.steps + 1,
      }
    } else if (event.type === 'turn/end') {
      this.ctx.logger.info(`rock-bot-manager: debug turn ${String(event.data.turn)} end steps=${String(this.debug.progress.steps)} delegated=${String(this.debugDelegated)}`)
      // A delegated child's result arrives as a follow-up turn (turn >= 2); wait for
      // that instead of reporting the delegator's first-turn placeholder.
      if (event.data.turn >= 2 || (!this.debugDelegated && this.debug.progress.steps === 0)) this.finalizeTest()
    }
  }

  /** Settle the debug run from the delegated child's final answer. */
  private finalizeTestFromChild(info: SubagentRunEndInfo): void {
    const toolType = this.debugToolType ?? ''
    const answer = info.lastAssistantMessage === undefined ? '' : blocksToText(info.lastAssistantMessage)
    const result: BotTestResult = answer.length > 0
      ? { ok: true, toolType, answer }
      : { ok: false, toolType, error: `tool stopped: ${info.stopReason}` }
    this.debug = { ...this.debug, running: false, result }
    this.debugSessionId = undefined
    this.debugToolType = undefined
    this.debugAssistantText = ''
    this.debugDelegated = false
  }

  /** Settle the debug run from the assistant output and keep the result for the panel. */
  private finalizeTest(): void {
    const toolType = this.debugToolType ?? ''
    const answer = this.debugAssistantText
    const result: BotTestResult = answer.length > 0
      ? { ok: true, toolType, answer }
      : { ok: false, toolType, error: 'tool produced no output' }
    this.debug = { ...this.debug, running: false, result }
    this.debugSessionId = undefined
    this.debugToolType = undefined
    this.debugAssistantText = ''
    this.debugDelegated = false
  }
}

/** Resolved deployable surface for one bot. */
interface ResolvedDeployBot {
  id: string
  name: string
  toolType: string
  skillSlug: string
  checklist: LlmProxyChecklist
}

/** Build the deployment task prompt from the bot's checklist + config skill. */
function deployPrompt(bot: ResolvedDeployBot): string {
  return [
    `部署 Bot【${bot.name}】到 ${bot.toolType}。`,
    '部署清单（唯一来源，直接使用，不要猜值）：',
    JSON.stringify(bot.checklist, null, 2),
    `请先用 skill_get 加载 skill "${bot.skillSlug}"，严格按其步骤写配置并重启；完成后按 skill 的回报格式输出一行 JSON。`,
  ].join('\n')
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

/** Resolved identity for a bot being debugged: display name, tool binding, and delegator LLM route. */
interface ResolvedDebugBot {
  /** Stable bot id. */
  id: string
  name: string
  toolType: string
  agentOptions: AgentOptions
}

/** Outcome of resolving a bot for debugging or deployment. */
type DebugResolution =
  | { kind: 'ok'; bot: ResolvedDebugBot }
  | { kind: 'unbound'; name: string }
  | { kind: 'unknown' }

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
