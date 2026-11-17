/**
 * Durable Rock workspace store: owns the local employee workspace root and the
 * task archive skeleton (`tasks/` + `projects/<projectId>/tasks/`). State and
 * the mirrored project list persist as small JSON files beside the connector
 * key.
 *
 * @module @rock/rock-workspace/service
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { WorkspaceProject, WorkspaceState } from './types.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface WorkspaceServiceOptions {
  /** Local JSON file persisting the workspace state. */
  workspacePath: string
  /** Default workspace root used on first run (may contain a leading `~`). */
  defaultRoot: string
}

/** Durable workspace state plus the archive path and project-mirror helpers. */
export class WorkspaceService {
  private state: WorkspaceState | null
  private projects: WorkspaceProject[]

  constructor(private readonly options: WorkspaceServiceOptions) {
    this.state = readState(options.workspacePath)
    this.projects = readProjects(options.workspacePath)
  }

  /** The persisted workspace state, or null when not yet initialized. */
  getState(): WorkspaceState | null {
    return this.state
  }

  /** The absolute workspace root, or null when not yet initialized. */
  rootPath(): string | null {
    return this.state?.rootPath ?? null
  }

  /** The default workspace root, expanded to an absolute path (for onboarding prefill). */
  defaultRoot(): string {
    return resolve(expandHome(this.options.defaultRoot))
  }

  /** Initialize (or re-point) the workspace root, creating the archive skeleton. */
  initialize(rootPath: string): WorkspaceState {
    const absolute = resolve(expandHome(rootPath))
    if (absolute.length === 0) throw new Error('workspace root must be non-empty')
    mkdirSync(join(absolute, 'tasks'), { recursive: true })
    mkdirSync(join(absolute, 'projects'), { recursive: true })
    const next: WorkspaceState = { rootPath: absolute, initializedAt: new Date().toISOString() }
    this.state = next
    persistState(this.options.workspacePath, next)
    return next
  }

  /** First-run default: initialize to the default root when not yet set. */
  ensureInitialized(): WorkspaceState {
    if (this.state !== null) return this.state
    return this.initialize(this.options.defaultRoot)
  }

  /** Absolute archive file path for one task (project tasks nest under the project). */
  resolveTaskPath(taskId: string, projectId?: string | null): string {
    const root = this.requireRoot()
    assertSegment(taskId, 'taskId')
    if (projectId) {
      assertSegment(projectId, 'projectId')
      return join(root, 'projects', projectId, 'tasks', `${taskId}.jsonl`)
    }
    return join(root, 'tasks', `${taskId}.jsonl`)
  }

  /** Mirror the cloud project list as `projects/<id>/tasks/` directories. */
  syncProjects(projects: WorkspaceProject[]): WorkspaceProject[] {
    const root = this.requireRoot()
    for (const project of projects) {
      assertSegment(project.id, 'projectId')
      mkdirSync(join(root, 'projects', project.id, 'tasks'), { recursive: true })
    }
    this.projects = projects
    persistProjects(this.options.workspacePath, projects)
    return projects
  }

  /** The mirrored project list (id → name), for UI display. */
  listProjects(): WorkspaceProject[] {
    return this.projects
  }

  private requireRoot(): string {
    if (this.state === null) {
      throw new Error('rock workspace is not initialized; complete onboarding first')
    }
    return this.state.rootPath
  }
}

/** Read a persisted workspace state, returning null for an absent or malformed file. */
function readState(workspacePath: string): WorkspaceState | null {
  let raw: string
  try {
    raw = readFileSync(workspacePath, 'utf8')
  } catch {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isState(parsed)) return null
  return parsed
}

/** Persist one workspace state atomically. */
function persistState(workspacePath: string, state: WorkspaceState): void {
  mkdirSync(dirname(workspacePath), { recursive: true })
  writeFileSync(workspacePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** Read the mirrored project list, defaulting to empty. */
function readProjects(workspacePath: string): WorkspaceProject[] {
  const projectsPath = projectsPathOf(workspacePath)
  let raw: string
  try {
    raw = readFileSync(projectsPath, 'utf8')
  } catch {
    return []
  }
  const parsed: unknown = JSON.parse(raw)
  if (!isProjects(parsed)) return []
  return parsed
}

/** Persist the mirrored project list atomically. */
function persistProjects(workspacePath: string, projects: WorkspaceProject[]): void {
  const projectsPath = projectsPathOf(workspacePath)
  mkdirSync(dirname(projectsPath), { recursive: true })
  writeFileSync(projectsPath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
}

/** The `projects.json` beside the workspace state file. */
function projectsPathOf(workspacePath: string): string {
  return join(dirname(workspacePath), 'projects.json')
}

/** Expand a leading `~` to the user's home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/** Reject a path segment that could escape the archive tree. */
function assertSegment(value: string, label: string): void {
  const segment = value.trim()
  if (segment.length === 0 || segment === '.' || segment === '..') {
    throw new Error(`${label} must be a non-empty path segment`)
  }
  if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
    throw new Error(`${label} must not contain path separators`)
  }
}

/** Whether an unknown value is a well-formed workspace state. */
function isState(value: unknown): value is WorkspaceState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.rootPath === 'string' && record.rootPath.length > 0
    && typeof record.initializedAt === 'string' && record.initializedAt.length > 0
}

/** Whether an unknown value is a well-formed project list. */
function isProjects(value: unknown): value is WorkspaceProject[] {
  if (!Array.isArray(value)) return false
  return value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Record<string, unknown>
    return typeof record.id === 'string' && record.id.length > 0
      && typeof record.name === 'string'
  })
}
