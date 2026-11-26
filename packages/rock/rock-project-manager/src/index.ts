/**
 * Rock project manager plugin: syncs employee-visible Seagull projects and
 * serves the projected rows plus per-workbench working-directory overrides as a
 * Remote service (`ctx.rockProjects`).
 *
 * ```yaml
 * - id: rock-project-manager
 *   name: '@rock/rock-project-manager'
 *   config:
 *     projectsUrl: http://127.0.0.1:3100/v1/connectors/gateway/projects
 *     employeeId: employee-a
 * ```
 *
 * @module @rock/rock-project-manager
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { buildProjectRow, buildProjectRows, projectsFrom, type ProjectDirResolver } from './projects.ts'
import type { ProjectRow } from './types.ts'

export type * from './types.ts'

/** Interval between project-list syncs. */
const DEFAULT_SYNC_INTERVAL_MS = 60_000

/** Deployment-owned gateway facts; patchable from cordis.yml. */
export interface Config {
  /** Full projects endpoint URL (no query). */
  projectsUrl?: string
  /** Employee id the projects endpoint filters by. */
  employeeId?: string
  /** Interval between project-list syncs. */
  syncIntervalMs?: number
}

/** The rock-workspace service surface the controller reads/writes, structurally typed to avoid a package cycle. */
interface WorkspaceLike extends ProjectDirResolver {
  listProjects(): Array<{ id: string; name: string; slug?: string }>
  syncProjects(projects: Array<{ id: string; name: string; slug?: string }>): Array<{ id: string; name: string; slug?: string }>
  setProjectDir(projectId: string, dir: string | null): string
}

/** Remote service carrying the synced project list and directory overrides. */
export default class RockProjectController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    projectsUrl: z.string().min(1).default(''),
    employeeId: z.string().min(1).default(''),
    syncIntervalMs: z.number().min(1).default(DEFAULT_SYNC_INTERVAL_MS),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockProjects')
    this.config = config
    void this.sync()
    ctx.effect(() => {
      const timer = setInterval(() => { void this.sync() }, this.config.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS)
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'rock-project-manager: sync interval')
  }

  /** Employee-visible projects with their effective and default working directories. */
  @Remote
  async listProjects(): Promise<ProjectRow[]> {
    await this.sync()
    const workspace = this.workspace()
    if (workspace === undefined) return []
    return buildProjectRows(workspace.listProjects(), workspace)
  }

  /** Set (or clear, with `null`) a project's working-directory override; returns the updated row. */
  @Remote
  setProjectDir(projectId: string, dir: string | null): ProjectRow {
    const workspace = this.requireWorkspace()
    const project = workspace.listProjects().find(entry => entry.id === projectId)
    if (project === undefined) {
      throw new RemoteError('rockProjects/unknown', `no project with id "${projectId}"`, {})
    }
    workspace.setProjectDir(projectId, dir)
    return buildProjectRow(project, workspace)
  }

  /** Fetch employee-visible projects and mirror them into the local workspace. */
  private async sync(): Promise<void> {
    const url = this.config.projectsUrl
    const employeeId = this.resolveEmployeeId()
    if (url === undefined || url.length === 0 || employeeId.length === 0) return
    try {
      const response = await fetch(`${url}?employeeId=${encodeURIComponent(employeeId)}`)
      if (!response.ok) {
        this.ctx.logger.warn(`rock-project-manager: projects sync failed HTTP ${response.status} for ${url}`)
        return
      }
      const projects = projectsFrom(await response.json())
      this.workspace()?.syncProjects(projects)
      this.ctx.logger.info(`rock-project-manager: synced ${projects.length} project(s)`)
    } catch (error) {
      this.ctx.logger.warn(`rock-project-manager: projects sync failed for ${url}: ${messageOf(error)}`)
    }
  }

  /** The optional workspace service, structurally typed to avoid a package cycle. */
  private workspace(): WorkspaceLike | undefined {
    return this.ctx.get('rockWorkspace') as WorkspaceLike | undefined
  }

  /** The workspace service, or a typed error before onboarding completes. */
  private requireWorkspace(): WorkspaceLike {
    const workspace = this.workspace()
    if (workspace === undefined) {
      throw new RemoteError('rockProjects/invalid', 'rock workspace unavailable; complete onboarding first', {})
    }
    return workspace
  }

  /** Resolve the employee id from the onboarding record, falling back to static config. */
  private resolveEmployeeId(): string {
    const onboarding = this.ctx.get('rockOnboarding') as { getRecord(): { employeeId: string } | null } | undefined
    const record = onboarding?.getRecord()
    if (record?.employeeId) return record.employeeId
    return this.config.employeeId ?? ''
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The project-management Remote (sync + per-project directory overrides). */
    rockProjects: RockProjectController
  }
}
