/**
 * Rock task console plugin: polls the Seagull task queue and serves the
 * projected rows as a read-only Remote service (`ctx.rockTasks`). The overview
 * and task-management panels render this list.
 *
 * ```yaml
 * - id: rock-tasks
 *   name: '@rock/rock-tasks'
 *   config:
 *     tasksUrl: http://127.0.0.1:3000/v1/connectors/gateway/tasks
 *     employeeId: employee-a
 * ```
 *
 * @module @rock/rock-tasks
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { projectsFrom, taskFrom, tasksFrom } from './tasks.ts'
import { presetForToolType } from '@rock/rock-bot-manager'
import { TaskArchiveStore } from './work-records.ts'
import type { ArchivedTaskSummary, RockOverview, TaskBot, TaskSummary, TaskWorkRecord } from './types.ts'
import { foldOverview, type OverviewAdapterLog } from './overview.ts'

export type * from './types.ts'

/** Skill body fetched from the cloud for prompt/runtime injection. */
interface TaskSkillBody {
  id: string
  name: string
  slug: string
  description: string
  content?: string
}

/** Interval between project-list syncs (mirrors gateway projects into the workspace). */
const PROJECT_SYNC_INTERVAL_MS = 60_000

/** Deployment-owned gateway facts; patchable from cordis.yml. */
export interface Config {
  /** Full tasks endpoint URL (no query). */
  tasksUrl: string
  /** Employee id the tasks endpoint filters by. */
  employeeId: string
  /** Durable archive index file path. */
  indexPath: string
}

/** Remote service carrying the projected task queue. */
export default class RockTasksController extends TypertRemoteService {
  static inject = ['sessions']
  static Config: z<Config> = z.object({
    tasksUrl: z.string().min(1).default(''),
    employeeId: z.string().min(1).default(''),
    indexPath: z.string().min(1).default('../.rock/archive-index.json'),
  })

  private readonly config: Config
  private readonly records: TaskArchiveStore
  private projects: Array<{ id: string; name: string; slug?: string }> = []

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockTasks')
    this.config = config
    const workspace = ctx.get('rockWorkspace') as {
      resolveTaskPath(taskId: string, projectId?: string | null): string
      rootPath(): string | null
    } | undefined
    this.records = new TaskArchiveStore({
      resolvePath: (taskId, projectId) => {
        if (workspace === undefined) throw new Error('rockWorkspace service unavailable')
        return workspace.resolveTaskPath(taskId, projectId)
      },
      rootPath: () => workspace?.rootPath() ?? null,
      indexPath: config.indexPath,
    })
    this.records.replay()
    // Mirror the employee-visible projects into the workspace (slug → directory)
    // so project tasks resolve their directory name before any session launches.
    void this.syncProjects()
    ctx.effect(() => {
      const timer = setInterval(() => { void this.syncProjects() }, PROJECT_SYNC_INTERVAL_MS)
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'rock-tasks: syncProjects interval')
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.records.record(String(session.id), event)
    })
  }

  /** All projected tasks for the configured employee, in queue order. */
  @Remote
  async listTasks(): Promise<TaskSummary[]> {
    return this.fetchTasks()
  }

  /** Employee-visible projects (mirrored by `syncProjects`) for resolving project names. */
  @Remote
  listProjects(): Array<{ id: string; name: string; slug?: string }> {
    return this.projects
  }

  /**
   * Aggregate the console overview: counts, per-period totals, and a per-bot leaderboard.
   * Task counts come from the cloud queue (pollTasks, includes terminal tasks); token totals
   * come from the local adapter request log. Periods use Asia/Shanghai day/week/month bounds.
   * @returns counts plus today/week/month task-token totals and the per-bot leaderboard.
   */
  @Remote
  async overview(): Promise<RockOverview> {
    const [tasks, bots] = await Promise.all([this.fetchTasks(), this.listBots()])
    const projects = this.listProjects()
    const adapter = this.ctx.get('rockLlmAdapter') as AdapterLogSource | undefined
    const logs = adapter === undefined ? [] : await adapter.all()
    return foldOverview(tasks, bots, projects, logs, new Date())
  }

  /** All employee-visible bots (claimed ∪ assistant ∪ local) for the execute dialog. */
  @Remote
  async listBots(): Promise<TaskBot[]> {
    const bots = this.ctx.get('rockBots') as {
      listBotsUnified(): Promise<Array<{ id: string; name: string; source: string; tool?: { toolType: string } }>>
    } | undefined
    if (bots === undefined) return []
    try {
      const rows = await bots.listBotsUnified()
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        ...row.tool === undefined ? {} : { toolType: row.tool.toolType },
        source: row.source,
      }))
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: listBots failed: ${messageOf(error)}`)
      return []
    }
  }

  /** Durable agent-tool work records for one task (tool.call / tool.result). */
  @Remote
  listWorkRecords(taskId: string): TaskWorkRecord[] {
    return this.records.list(taskId)
  }

  /** Archived task index for the history tab (read from the local workspace). */
  @Remote
  listArchivedTasks(): ArchivedTaskSummary[] {
    return this.records.listArchived()
  }

  /** Full archive for one task: summary plus all recorded lines. */
  @Remote
  getArchivedTask(taskId: string): { summary: ArchivedTaskSummary | null; records: TaskWorkRecord[] } {
    return this.records.getArchived(taskId)
  }

  /** Assign the task to a bot, launch its thin-relay session, and return the updated task. */
  @Remote
  async runTask(taskId: string, botId: string): Promise<TaskSummary> {
    // Validate the binding before the gateway assigns the task: an unbound bot
    // would receive work it cannot launch.
    if (this.resolveToolType(botId) === undefined) {
      throw new RemoteError('rockTasks/launchFailed', `bot "${botId}" has no execution backend; bind one in Bot management`, {})
    }
    const task = await this.postTaskAction(taskId, botId, 'run')
    try {
      await this.launchSession(botId, task)
    } catch (error) {
      throw new RemoteError(
        'rockTasks/launchFailed',
        `task assigned but session launch failed: ${messageOf(error)}`,
        {},
        { cause: error },
      )
    }
    return task
  }

  /** Submit the task for review (bot-completed → awaiting-review). */
  @Remote
  async submitTask(taskId: string, botId: string): Promise<TaskSummary> {
    const task = await this.postTaskAction(taskId, botId, 'submit')
    try {
      this.records.ensureReceipt(taskId, {
        outcome: 'partial',
        summary: `任务已提交验收（bot: ${botId}）`,
        reportedBy: botId,
        completedAt: new Date().toISOString(),
      })
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: fallback receipt failed for ${taskId}: ${messageOf(error)}`)
    }
    return task
  }

  /** Continue the task (awaiting-review → in-progress). */
  @Remote
  continueTask(taskId: string, botId: string): Promise<TaskSummary> {
    return this.postTaskAction(taskId, botId, 'continue')
  }

  /** Accept or reject a task under review (assignee permission enforced by the gateway). */
  @Remote
  reviewTask(taskId: string, resolution: 'accepted' | 'rejected', reason: string): Promise<TaskSummary> {
    return this.postReview(taskId, resolution, reason)
  }

  /** POST one task action to the gateway and return the updated task. */
  private async postTaskAction(
    taskId: string,
    botId: string,
    action: 'run' | 'submit' | 'continue',
  ): Promise<TaskSummary> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) {
      throw new RemoteError('rockTasks/unconfigured', 'tasksUrl or employeeId unconfigured', {})
    }
    const requestUrl = `${url}/${encodeURIComponent(taskId)}/${action}`
    this.ctx.logger.info(`rock-tasks: ${action} task=${taskId} bot=${botId} employee=${employeeId}`)
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeId, agentBotId: botId }),
      })
      if (!response.ok) {
        throw new RemoteError('rockTasks/runFailed', `${action} task failed HTTP ${response.status}`, {})
      }
      const task = taskFrom(await response.json())
      if (task === null) throw new RemoteError('rockTasks/runFailed', `${action} task returned a malformed task`, {})
      return task
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('rockTasks/runFailed', messageOf(error), {}, { cause: error })
    }
  }

  /** POST an accept/reject review to the gateway and return the updated task. */
  private async postReview(taskId: string, resolution: 'accepted' | 'rejected', reason: string): Promise<TaskSummary> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) {
      throw new RemoteError('rockTasks/unconfigured', 'tasksUrl or employeeId unconfigured', {})
    }
    const requestUrl = `${url}/${encodeURIComponent(taskId)}/review`
    this.ctx.logger.info(`rock-tasks: review task=${taskId} resolution=${resolution} employee=${employeeId}`)
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeId, resolution, reason }),
      })
      if (!response.ok) {
        throw new RemoteError('rockTasks/runFailed', `review task failed HTTP ${response.status}`, {})
      }
      const task = taskFrom(await response.json())
      if (task === null) throw new RemoteError('rockTasks/runFailed', 'review task returned a malformed task', {})
      return task
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('rockTasks/runFailed', messageOf(error), {}, { cause: error })
    }
  }

  /** Resolve the bot's bound toolType from the identity service; `undefined` when unbound. */
  private resolveToolType(botId: string): string | undefined {
    const identity = this.ctx.get('seagullIdentity') as { toolBindingOf(id: string): string | undefined } | undefined
    return identity?.toolBindingOf(botId)
  }

  /**
   * Resolve the bot's bound upstream model id (the model the deploy flow wrote
   * into the relay provider), or the `seagull-relay` placeholder. This is the
   * model the child backend must select so its LLM routes through rock-llm-relay.
   * @param botId - the claimed bot id.
   * @returns the bound model id, or `seagull-relay` when the identity has none.
   */
  private resolveBotModel(botId: string): string {
    const identity = this.ctx.get('seagullIdentity') as { modelOf(id: string): string } | undefined
    return identity?.modelOf(botId) ?? 'seagull-relay'
  }

  /** Launch the bot's thin-relay session and submit the task as its first message. */
  private async launchSession(botId: string, task: TaskSummary): Promise<void> {
    const toolType = this.resolveToolType(botId)
    if (toolType === undefined) throw new Error(`bot "${botId}" has no execution backend`)
    const presetId = presetForToolType(toolType)

    // Services the thin-relay session depends on; read through ctx.get so the
    // lookup is not topology-sensitive (the property proxy is reserved for
    // declared injections, which this plugin does not list).
    const agentPresets = this.ctx.get('agentPresets') as {
      resolve(id: string): Promise<{ id: string }>
      acquireScope(id: string): Promise<{ key: unknown } & AsyncDisposable>
      mount(ctx: Context, id: string): Promise<unknown>
    } | undefined
    const agents = this.ctx.get('agents') as {
      create(options: {
        sessionId: SessionId
        meta?: { agentPreset?: string }
        agentOptions?: AgentOptions
        setup?: (agentCtx: Context) => Promise<void>
      }): Promise<{ agent: { followup(message: unknown): void } }>
    } | undefined

    if (agentPresets === undefined) throw new Error('agentPresets service unavailable')
    if (agents === undefined) throw new Error('agents service unavailable')

    // Fetch skill bodies from the cloud. The thin-relay delegates to an
    // external subagent (codex/opencode/dsh) as a separate process, so the
    // skill content is injected into the task prompt it forwards.
    const skillBodies = await this.fetchTaskSkills(task.id)

    this.ctx.logger.info(`rock-tasks: launchSession resolving preset ${presetId}`)
    const preset = await agentPresets.resolve(presetId)
    this.ctx.logger.info(`rock-tasks: launchSession preset ${presetId} resolved`)
    await using scope = await agentPresets.acquireScope(preset.id)
    void scope

    const sessionId = brandString<SessionId>(`${botId}-${randomUUID()}`)
    const agentOptions: AgentOptions = { provider: 'seagull-cloud', model: this.resolveBotModel(botId), agentId: botId }
    const workspace = this.ctx.get('rockWorkspace') as {
      rootPath(): string | null
      resolveProjectDir(projectId: string): string
    } | undefined
    // Refresh the project slug map so a project task resolves its directory name
    // (slug) rather than falling back to the raw projectId.
    if (task.projectId) {
      await this.syncProjects()
    }
    // Project tasks run inside their project directory; global tasks run at the workspace root.
    const cwd = task.projectId
      ? workspace?.resolveProjectDir(task.projectId) ?? null
      : workspace?.rootPath() ?? null
    this.ctx.logger.info(`rock-tasks: launchSession creating agent ${sessionId} (cwd=${cwd ?? '(default)'})`)
    const handle = await agents.create({
      sessionId,
      meta: { agentPreset: preset.id, ...(cwd === null ? {} : { cwd }) },
      agentOptions,
      setup: async (agentCtx) => {
        await agentPresets.mount(agentCtx, preset.id)
      },
    })
    this.ctx.logger.info(`rock-tasks: launchSession agent ${sessionId} created`)

    // Attach the launched session to the DSH workspace owning its cwd so it groups correctly.
    if (cwd !== null) {
      await this.attachToWorkspace(String(sessionId), cwd)
    }

    // Create the per-task archive and bind the session so work records are attributed.
    this.records.openTask(task, botId, String(sessionId), cwd)

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: this.taskPrompt(task, botId, skillBodies) }],
      source: { kind: 'user' },
    }))
    this.ctx.logger.info(`rock-tasks: launchSession followup submitted for ${sessionId}`)

    await this.registerSession(botId, String(sessionId), task.id).catch((error: unknown) => {
      this.ctx.logger.warn(`rock-tasks: session registration failed for ${sessionId}: ${messageOf(error)}`)
    })
  }

  /**
   * Build the task prompt with the task context + receipt contract,
   * prepending skill content for codex/opencode tools.
   */
  private taskPrompt(task: TaskSummary, botId: string, skillBodies?: TaskSkillBody[] | null): string {
    const prompt = [task.title, task.description].filter(text => text.length > 0).join('\n\n')
    const workspace = this.ctx.get('rockWorkspace') as {
      resolveTaskPath(taskId: string, projectId?: string | null): string
    } | undefined
    const receiptPath = workspace?.resolveTaskPath(task.id, task.projectId || null) ?? ''

    let skillPrefix = ''
    if (skillBodies && skillBodies.length > 0) {
      const blocks = skillBodies.map((s) => {
        const body = s.content ?? ''
        return `<skill_content name="${escapeAttr(s.slug)}">\n<skill_instructions>\n${body}\n</skill_instructions>\n</skill_content>`
      })
      skillPrefix = `\n\n以下技能指令在执行任务时应遵循：\n\n${blocks.join('\n\n')}\n\n---\n\n`
    }

    return `${skillPrefix}${prompt}\n\n---\n任务上下文：\n- taskId: ${task.id}\n- projectId: ${task.projectId ?? '(无)'}\n- botId: ${botId}\n- 任务归档文件（追加回执到此文件）: ${receiptPath}`
  }

  /** Register the launched DSH session (sessionId → bot + taskId) so the gateway can validate reported events and link them to the task. */
  private async registerSession(botId: string, sessionId: string, taskId: string): Promise<void> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) return
    const sessionsUrl = `${url.replace(/\/tasks$/, '')}/sessions`
    const onboarding = this.ctx.get('rockOnboarding') as { getRecord(): { key: string } | null } | undefined
    const key = onboarding?.getRecord()?.key ?? ''
    const response = await fetch(sessionsUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ employeeId, agentBotId: botId, sessionId, taskId }),
    })
    if (!response.ok) throw new Error(`register session failed HTTP ${response.status}`)
  }

  /** Fetch the cloud task queue; an empty list when unconfigured or unreachable. */
  private async fetchTasks(): Promise<TaskSummary[]> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) {
      this.ctx.logger.warn('rock-tasks: tasksUrl or employeeId unconfigured; returning an empty task list')
      return []
    }
    const requestUrl = `${url}?employeeId=${encodeURIComponent(employeeId)}`
    try {
      const response = await fetch(requestUrl)
      if (!response.ok) {
        this.ctx.logger.warn(`rock-tasks: tasks fetch failed HTTP ${response.status} for ${requestUrl}`)
        return []
      }
      const tasks = tasksFrom(await response.json())
      this.ctx.logger.info(`rock-tasks: fetched ${tasks.length} task(s) for employee ${employeeId}`)
      return tasks
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: tasks fetch failed for ${requestUrl}: ${messageOf(error)}`)
      return []
    }
  }

  /** Attach the launched session to the DSH workspace owning its cwd (best-effort). */
  private async attachToWorkspace(sessionId: string, cwd: string): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry') as {
      create(path: string): Promise<{ attachSession(id: string): Promise<void> }>
    } | undefined
    if (registry === undefined) return
    try {
      const workspace = await registry.create(cwd)
      await workspace.attachSession(sessionId)
      this.ctx.logger.info(`rock-tasks: attached session ${sessionId} to workspace ${cwd}`)
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: attach session ${sessionId} to workspace failed: ${messageOf(error)}`)
    }
  }

  /** Fetch employee-visible projects and mirror them into the workspace (slug → directory). */
  private async syncProjects(): Promise<void> {
    const url = this.config.tasksUrl.replace(/\/tasks$/, '/projects')
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) return
    try {
      const response = await fetch(`${url}?employeeId=${encodeURIComponent(employeeId)}`)
      if (!response.ok) {
        this.ctx.logger.warn(`rock-tasks: projects sync failed HTTP ${response.status} for ${url}`)
        return
      }
      const projects = projectsFrom(await response.json())
      this.projects = projects
      const workspace = this.ctx.get('rockWorkspace') as {
        syncProjects(projects: Array<{ id: string; name: string; slug?: string }>): void
      } | undefined
      workspace?.syncProjects(projects)
      this.ctx.logger.info(`rock-tasks: synced ${projects.length} project(s)`)
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: projects sync failed for ${url}: ${messageOf(error)}`)
    }
  }

  /** Fetch skill bodies from the cloud work-queue skills endpoint. Returns null when unconfigured. */
  private async fetchTaskSkills(taskId: string): Promise<TaskSkillBody[] | null> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) return null
    try {
      const requestUrl = `${url}/${encodeURIComponent(taskId)}/skills`
      const response = await fetch(requestUrl)
      if (!response.ok) {
        this.ctx.logger.warn(`rock-tasks: fetch skills failed HTTP ${response.status}`)
        return null
      }
      const body = (await response.json()) as unknown
      if (Array.isArray(body)) return body as TaskSkillBody[]
      const envelope = (body as { data?: unknown }).data
      if (Array.isArray(envelope)) return envelope as TaskSkillBody[]
      return null
    } catch (error) {
      this.ctx.logger.warn(`rock-tasks: fetch skills failed for task ${taskId}: ${messageOf(error)}`)
      return null
    }
  }

  /** Resolve the employee id from the onboarding record, falling back to static config. */
  private resolveEmployeeId(): string {
    const onboarding = this.ctx.get('rockOnboarding') as { getRecord(): { employeeId: string } | null } | undefined
    const record = onboarding?.getRecord()
    if (record?.employeeId) return record.employeeId
    return this.config.employeeId
  }
}

/** The local adapter-log read surface the overview folds (an optional service). */
interface AdapterLogSource {
  all(): Promise<OverviewAdapterLog[]>
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** Escape a skill slug for safe embedding in XML attribute context. */
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only task queue Remote. */
    rockTasks: RockTasksController
  }
}
