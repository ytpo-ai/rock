/**
 * Gateway project-list parsing and panel-row projection: turn the cloud
 * `{ data: { projects: [...] } }` envelope into id/name/slug rows, then fold
 * the workspace directory resolver into display rows.
 *
 * @module @rock/rock-project-manager/projects
 */
import type { ProjectRow } from './types.ts'

/** Project a parsed gateway body (`{ data: { projects: [...] } }`) into project rows. */
export function projectsFrom(body: unknown): Array<{ id: string; name: string; slug?: string }> {
  if (typeof body !== 'object' || body === null) return []
  const envelope = (body as { data?: { projects?: unknown } }).data
  const projects = envelope?.projects
  if (!Array.isArray(projects)) return []
  const rows: Array<{ id: string; name: string; slug?: string }> = []
  for (const raw of projects) {
    if (typeof raw !== 'object' || raw === null) continue
    const p = raw as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : ''
    const name = typeof p.name === 'string' ? p.name : ''
    if (id.length === 0 || name.length === 0) continue
    rows.push({ id, name, ...(typeof p.slug === 'string' ? { slug: p.slug } : {}) })
  }
  return rows
}

/** The workspace-like directory resolver the row builder reads directories from. */
export interface ProjectDirResolver {
  defaultProjectDir(projectId: string): string
  projectDir(projectId: string): string
  projectDirOverride(projectId: string): string | undefined
}

/** Project one synced project into a panel row with its effective and default directories. */
export function buildProjectRow(
  project: { id: string; name: string; slug?: string },
  resolver: ProjectDirResolver,
): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    ...(project.slug === undefined ? {} : { slug: project.slug }),
    dir: resolver.projectDir(project.id),
    defaultDir: resolver.defaultProjectDir(project.id),
    hasOverride: resolver.projectDirOverride(project.id) !== undefined,
  }
}

/** Project the synced project list into panel rows. */
export function buildProjectRows(
  projects: Array<{ id: string; name: string; slug?: string }>,
  resolver: ProjectDirResolver,
): ProjectRow[] {
  return projects.map(project => buildProjectRow(project, resolver))
}
