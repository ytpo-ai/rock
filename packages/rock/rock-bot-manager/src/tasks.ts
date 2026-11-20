/**
 * Cloud task queue parsing for the bot-binding lock. A bot whose cloud task
 * queue holds at least one active (non-terminal) entry keeps its tool binding
 * locked until those tasks settle.
 *
 * @module @rock/rock-bot-manager/tasks
 */

/** Task statuses that keep a bot's binding locked. */
export const ACTIVE_TASK_STATUSES = new Set(['pending', 'planning', 'planned', 'in-progress', 'bot-completed', 'awaiting-review', 'blocked'])

/** Bot ids owning at least one active task, deduplicated in first-seen order. */
export function activeBotIdsFrom(tasks: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>()
  for (const task of tasks) {
    const owner = typeof task.owner === 'string' ? task.owner : ''
    const status = typeof task.status === 'string' ? task.status : ''
    if (owner.length > 0 && ACTIVE_TASK_STATUSES.has(status)) ids.add(owner)
  }
  return [...ids]
}
