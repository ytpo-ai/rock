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
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { RockBotService } from './service.ts'
import { JsonFileBindingStore, JsonFileBotStore } from './store.ts'
import { activeBotIdsFrom } from './tasks.ts'
import { buildUnifiedBots } from './unify.ts'
import { DEFAULT_TOOL_RUN_TIMEOUT_MS, runTool, TEST_PROMPT } from './run.ts'
import type { ToolRunSpec } from './run.ts'
import type { BotDefinition, BotInput, BotModelInfo, BotRow, BotTestResult } from './types.ts'

export type * from './types.ts'

const DEFAULT_STORE_PATH = '../.rock/bots.json'
const DEFAULT_BINDINGS_PATH = '../.rock/bindings.json'

/** Tool types the binding selector offers before deployment overrides them. */
const DEFAULT_TOOL_TYPES = ['codex', 'pi', 'opencode', 'dsh', 'acp', 'claude-code']

/** Best-effort non-interactive run commands for the card's "test" action, keyed by tool type. */
const DEFAULT_TOOL_RUN: Record<string, ToolRunSpec> = {
  codex: { command: 'codex', args: ['exec', '--', '{prompt}'] },
  pi: { command: 'pi', args: ['exec', '{prompt}'] },
  opencode: { command: 'opencode', args: ['run', '{prompt}'] },
  dsh: { command: 'dsh', args: ['--profile', 'headless', '{prompt}'] },
  'claude-code': { command: 'claude', args: ['-p', '{prompt}'] },
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
  /** Non-interactive run commands keyed by tool type; `{prompt}` is replaced with the smoke-test prompt. */
  toolRun?: Record<string, ToolRunSpec>
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
    toolRun: z.dict(z.object({
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
      timeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_RUN_TIMEOUT_MS),
    })).default({ ...DEFAULT_TOOL_RUN }),
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

  /** Registered LLM provider routes for the add/edit form's provider selector. */
  @Remote
  providers(): Array<{ id: string; name: string }> {
    return this.optionalLlm()?.listProviders() ?? []
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

  /** Run one bound tool's non-interactive smoke-test with the fixed weather prompt. */
  @Remote
  async testBot(id: string): Promise<BotTestResult> {
    const bot = this.service.get(id)
    if (bot === undefined) throw new RemoteError('rockBots/unknown', `no bot with id "${id}"`, {})
    const toolType = bot.tool.toolType
    const spec = (this.config.toolRun ?? DEFAULT_TOOL_RUN)[toolType]
    if (spec === undefined) {
      return { ok: false, toolType, error: `no run command configured for tool "${toolType}"` }
    }
    const result = await runTool(spec, TEST_PROMPT)
    return {
      ok: result.ok,
      toolType,
      ...result.answer === undefined ? {} : { answer: result.answer },
      ...result.error === undefined ? {} : { error: result.error },
    }
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
  private optionalInventory(): { listTools(): Promise<{ id: string; installed: boolean }[]> } | undefined {
    return this.ctx.get('rockToolInventory') as { listTools(): Promise<{ id: string; installed: boolean }[]> } | undefined
  }

  /** The optional workspace service, structurally typed to avoid a package cycle. */
  private optionalWorkspace(): { listProjects(): Array<{ id: string; name: string }> } | undefined {
    return this.ctx.get('rockWorkspace') as { listProjects(): Array<{ id: string; name: string }> } | undefined
  }

  /** The optional LLM runtime, structurally typed to avoid a package cycle. */
  private optionalLlm(): { listProviders(): Array<{ id: string; name: string }> } | undefined {
    return this.ctx.get('llm') as { listProviders(): Array<{ id: string; name: string }> } | undefined
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
