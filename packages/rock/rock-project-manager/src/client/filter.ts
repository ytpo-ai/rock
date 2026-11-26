/** Search filter for the project card list; matching covers name, id, and slug. */
import type { ProjectRow } from '@rock/rock-project-manager/types'

/**
 * Filter project rows by a case-insensitive contiguous substring over name,
 * id, and slug. An empty or whitespace query returns the full list.
 * @param projects - the synced project rows.
 * @param query - the user search text.
 * @returns the matching rows, in the input order.
 */
export function filterProjects(projects: readonly ProjectRow[], query: string): ProjectRow[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...projects]
  return projects.filter(project =>
    project.name.toLowerCase().includes(q)
    || project.id.toLowerCase().includes(q)
    || (project.slug ?? '').toLowerCase().includes(q),
  )
}
