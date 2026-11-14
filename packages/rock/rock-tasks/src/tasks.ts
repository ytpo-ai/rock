/**
 * Cloud task queue parsing: project the gateway `pollTasks` response body into
 * typed `TaskSummary` rows, dropping malformed entries.
 *
 * @module @rock/rock-tasks/tasks
 */
import type { TaskSummary } from './types.ts'

/** Project a parsed `{ tasks: [...] }` body into typed summaries. */
export function tasksFrom(body: unknown): TaskSummary[] {
  if (typeof body !== 'object' || body === null) return []
  const tasks = (body as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return []
  const rows: TaskSummary[] = []
  for (const raw of tasks) {
    const row = summaryFrom(raw)
    if (row !== null) rows.push(row)
  }
  return rows
}

/** Project one task entry, or null when it lacks a string id. */
function summaryFrom(raw: unknown): TaskSummary | null {
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
    owner: typeof t.owner === 'string' ? t.owner : '',
    ...(typeof t.acceptedBy === 'string' ? { acceptedBy: t.acceptedBy } : {}),
    ...(typeof t.projectId === 'string' ? { projectId: t.projectId } : {}),
    ...(typeof t.parentId === 'string' ? { parentId: t.parentId } : {}),
  }
}
