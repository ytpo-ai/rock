/**
 * Cloud task queue parsing: project the gateway `pollTasks` response body into
 * typed `TaskSummary` rows, dropping malformed entries. The gateway wraps its
 * body in the `{ code, message, data }` envelope, so the rows live under
 * `body.data.tasks`.
 *
 * @module @rock/rock-tasks/tasks
 */
import type { TaskSummary } from './types.ts'

/** Project a parsed gateway body (`{ data: { tasks: [...] } }`) into typed summaries. */
export function tasksFrom(body: unknown): TaskSummary[] {
  if (typeof body !== 'object' || body === null) return []
  const envelope = (body as { data?: { tasks?: unknown } }).data
  const tasks = envelope?.tasks
  if (!Array.isArray(tasks)) return []
  const rows: TaskSummary[] = []
  for (const raw of tasks) {
    const row = summaryFrom(raw)
    if (row !== null) rows.push(row)
  }
  return rows
}

/** Project one gateway body (`{ data: { ...task } }`) into a summary, or null when malformed. */
export function taskFrom(body: unknown): TaskSummary | null {
  if (typeof body !== 'object' || body === null) return null
  const envelope = (body as { data?: unknown }).data
  return summaryFrom(envelope ?? body)
}

/** Project one task entry, or null when it lacks a string id. */
export function summaryFrom(raw: unknown): TaskSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  const id = typeof t.id === 'string' ? t.id : ''
  if (id.length === 0) return null
  return {
    id,
    type: typeof t.type === 'string' ? t.type : '',
    title: typeof t.title === 'string' ? t.title : '',
    description: typeof t.description === 'string' ? t.description : '',
    status: typeof t.status === 'string' ? t.status : '',
    executorId: typeof t.executorId === 'string' ? t.executorId : '',
    ...(typeof t.resolution === 'string' ? { resolution: t.resolution } : {}),
    ...(typeof t.assignee === 'string' ? { assignee: t.assignee } : {}),
    ...(typeof t.projectId === 'string' ? { projectId: t.projectId } : {}),
    ...(typeof t.parentId === 'string' ? { parentId: t.parentId } : {}),
  }
}
