/**
 * Rock project management vocabulary: employee-visible Seagull projects and
 * their per-workbench working-directory overrides.
 *
 * @module @rock/rock-project-manager/types
 */

/** One employee-visible project row for the management panel. */
export interface ProjectRow {
  /** Project id (Mongo ObjectId hex). */
  id: string
  /** Display name from Seagull. */
  name: string
  /** URL-safe directory name; falls back to `id` when absent. */
  slug?: string
  /** Effective local working directory (override wins, else the default). */
  dir: string
  /** Default directory `<workspaceRoot>/projects/<slug|id>`. */
  defaultDir: string
  /** Whether the project carries a per-workbench directory override. */
  hasOverride: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No project with the requested id exists. */
    'rockProjects/unknown': Record<string, never>
    /** The operation cannot proceed (rock workspace unavailable). */
    'rockProjects/invalid': Record<string, never>
  }
}
