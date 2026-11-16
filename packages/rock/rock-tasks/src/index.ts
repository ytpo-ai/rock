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
import { taskFrom, tasksFrom } from './tasks.ts'
import { TaskWorkRecordStore } from './work-records.ts'
import type { TaskBot, TaskSummary, TaskWorkRecord } from './types.ts'

export type * from './types.ts'

/** Deployment-owned gateway facts; patchable from cordis.yml. */
export interface Config {
  /** Full tasks endpoint URL (no query). */
  tasksUrl: string
  /** Employee id the tasks endpoint filters by. */
  employeeId: string
  /** JSONL file for durable per-task agent-tool work records. */
  workRecordsPath: string
}

/** Remote service carrying the projected task queue. */
export default class RockTasksController extends TypertRemoteService {
  static inject = ['sessions']
  static Config: z<Config> = z.object({
    tasksUrl: z.string().min(1).default(''),
    employeeId: z.string().min(1).default(''),
    workRecordsPath: z.string().min(1).default(''),
  })

  private readonly config: Config
  private readonly records: TaskWorkRecordStore

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockTasks')
    this.config = config
    this.records = new TaskWorkRecordStore(config.workRecordsPath.length > 0 ? config.workRecordsPath : undefined)
    this.records.replay()
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.records.record(String(session.id), event)
    })
  }

  /** All projected tasks for the configured employee, in queue order. */
  @Remote
  async listTasks(): Promise<TaskSummary[]> {
    return this.fetchTasks()
  }

  /** All employee-visible bots (claimed ∪ assistant ∪ local) for the execute dialog. */
  @Remote
  async listBots(): Promise<TaskBot[]> {
    const bots = this.ctx.get('rockBots') as {
      listBotsUnified(): Promise<Array<{ id: string; name: string; source: string; tool: { toolType: string } }>>
    } | undefined
    if (bots === undefined) return []
    try {
      const rows = await bots.listBotsUnified()
      return rows.map(row => ({ id: row.id, name: row.name, toolType: row.tool.toolType, source: row.source }))
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

  /** Assign the task to a bot, launch its thin-relay session, and return the updated task. */
  @Remote
  async runTask(taskId: string, botId: string): Promise<TaskSummary> {
    const task = await this.assignTask(taskId, botId)
    await this.launchSession(botId, task).catch((error: unknown) => {
      this.ctx.logger.warn(`rock-tasks: session launch failed for task ${taskId}: ${messageOf(error)}`)
    })
    return task
  }

  /** Assign the task to a bot (backend run endpoint); returns the updated task. */
  private async assignTask(taskId: string, botId: string): Promise<TaskSummary> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) {
      throw new RemoteError('rockTasks/unconfigured', 'tasksUrl or employeeId unconfigured', {})
    }
    const requestUrl = `${url}/${encodeURIComponent(taskId)}/run`
    this.ctx.logger.info(`rock-tasks: runTask task=${taskId} bot=${botId} employee=${employeeId}`)
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeId, agentBotId: botId }),
      })
      if (!response.ok) {
        throw new RemoteError('rockTasks/runFailed', `run task failed HTTP ${response.status}`, {})
      }
      const task = taskFrom(await response.json())
      if (task === null) throw new RemoteError('rockTasks/runFailed', 'run task returned a malformed task', {})
      return task
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('rockTasks/runFailed', messageOf(error), {}, { cause: error })
    }
  }

  /** Launch the bot's thin-relay session and submit the task as its first message. */
  private async launchSession(botId: string, task: TaskSummary): Promise<void> {
    const presetId = 'rock'
    const prompt = [task.title, task.description].filter(text => text.length > 0).join('\n\n')

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

    this.ctx.logger.info(`rock-tasks: launchSession resolving preset ${presetId}`)
    const preset = await agentPresets.resolve(presetId)
    this.ctx.logger.info(`rock-tasks: launchSession preset ${presetId} resolved`)
    await using scope = await agentPresets.acquireScope(preset.id)
    void scope

    const sessionId = brandString<SessionId>(`${botId}-${randomUUID()}`)
    const agentOptions: AgentOptions = { provider: 'seagull-cloud', model: 'seagull-relay', agentId: botId }
    this.ctx.logger.info(`rock-tasks: launchSession creating agent ${sessionId}`)
    const handle = await agents.create({
      sessionId,
      meta: { agentPreset: preset.id },
      agentOptions,
      setup: async (agentCtx) => {
        await agentPresets.mount(agentCtx, preset.id)
      },
    })
    this.ctx.logger.info(`rock-tasks: launchSession agent ${sessionId} created`)

    // Bind the launched session to the task so tool work records can be attributed.
    this.records.linkSession(String(sessionId), task.id)

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    this.ctx.logger.info(`rock-tasks: launchSession followup submitted for ${sessionId}`)

    await this.registerSession(botId, String(sessionId), task.id).catch((error: unknown) => {
      this.ctx.logger.warn(`rock-tasks: session registration failed for ${sessionId}: ${messageOf(error)}`)
    })
  }

  /** Register the launched DSH session (sessionId → bot + taskId) so the gateway can validate reported events and link them to the task. */
  private async registerSession(botId: string, sessionId: string, taskId: string): Promise<void> {
    const url = this.config.tasksUrl
    const employeeId = this.resolveEmployeeId()
    if (url.length === 0 || employeeId.length === 0) return
    const sessionsUrl = `${url.replace(/\/tasks$/, '')}/sessions`
    const response = await fetch(sessionsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

  /** Resolve the employee id from the onboarding record, falling back to static config. */
  private resolveEmployeeId(): string {
    const onboarding = this.ctx.get('rockOnboarding') as { getRecord(): { employeeId: string } | null } | undefined
    const record = onboarding?.getRecord()
    if (record?.employeeId) return record.employeeId
    return this.config.employeeId
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'rockTasks/unconfigured': Record<string, never>
    'rockTasks/runFailed': Record<string, never>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only task queue Remote. */
    rockTasks: RockTasksController
  }
}
