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
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { tasksFrom } from './tasks.ts'
import type { TaskSummary } from './types.ts'

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

  /** Fetch the cloud task queue; an empty list when unconfigured or unreachable. */
  private async fetchTasks(): Promise<TaskSummary[]> {
    const url = this.config.tasksUrl
    const employeeId = this.config.employeeId
    if (url.length === 0 || employeeId.length === 0) return []
    try {
      const response = await fetch(`${url}?employeeId=${encodeURIComponent(employeeId)}`)
      if (!response.ok) return []
      return tasksFrom(await response.json())
    } catch {
      return []
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only task queue Remote. */
    rockTasks: RockTasksController
  }
}
