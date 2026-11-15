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
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { taskFrom, tasksFrom } from './tasks.ts'
import type { TaskBot, TaskSummary } from './types.ts'

export type * from './types.ts'

/** Deployment-owned gateway facts; patchable from cordis.yml. */
export interface Config {
  /** Full tasks endpoint URL (no query). */
  tasksUrl: string
  /** Employee id the tasks endpoint filters by. */
  employeeId: string
}

/** Remote service carrying the projected task queue. */
export default class RockTasksController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    tasksUrl: z.string().min(1).default(''),
    employeeId: z.string().min(1).default(''),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockTasks')
    this.config = config
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

  /** Assign the task to a bot and enter in-progress; returns the updated task. */
  @Remote
  async runTask(taskId: string, botId: string): Promise<TaskSummary> {
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
