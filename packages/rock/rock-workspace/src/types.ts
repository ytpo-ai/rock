/**
 * Rock workspace vocabulary: the local employee workspace root that owns the
 * task archive directory tree.
 *
 * @module @rock/rock-workspace/types
 */

/** Persisted workspace state. */
export interface WorkspaceState {
  /** Absolute workspace root directory. */
  rootPath: string
  /** ISO-8601 timestamp of first initialization. */
  initializedAt: string
}

/** One Seagull project mirrored under `<root>/projects/<dir>`. */
export interface WorkspaceProject {
  /** Project id (Mongo ObjectId hex). */
  id: string
  /** Display name for UI. */
  name: string
  /** URL-safe directory name; falls back to `id` when absent. */
  slug?: string
}

/**
 * Per-workbench working-directory overrides, keyed by project id. Absent or
 * empty entries fall back to the default `<root>/projects/<slug|id>` directory.
 */
export type ProjectDirOverrides = Record<string, string>
