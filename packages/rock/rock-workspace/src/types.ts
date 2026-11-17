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

/** One Seagull project mirrored under `<root>/projects/<id>`. */
export interface WorkspaceProject {
  /** Project id (Mongo ObjectId hex), used as the directory name. */
  id: string
  /** Display name for UI. */
  name: string
}
