/** Client helpers for the project card list: search filter and directory label. */
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

/**
 * Render a project's working-directory label: the absolute override path when
 * set, else the default directory as a path relative to the workspace root.
 * @param project - the project row.
 * @returns the display path for the card chip.
 */
export function projectDirLabel(project: ProjectRow): string {
  if (project.hasOverride) return project.dir
  return `projects/${project.slug?.trim() || project.id}`
}
