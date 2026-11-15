/**
 * Rock task vocabulary: one cloud task assigned to a claimed agent bot,
 * projected for the overview and task-management console panels.
 *
 * @module @rock/rock-tasks/types
 */

/** One task from the cloud `work_items` queue, projected for the console. */
export interface TaskSummary {
  /** Task id. */
  id: string
  /** Task kind: `requirement` or `task`. */
  type: string
  /** Display title. */
  title: string
  /** Long description. */
  description: string
  /** Work-queue status. */
  status: string
  /** Owning agent bot id. */
  owner: string
  /** Accepting reviewer, when recorded. */
  acceptedBy?: string
  /** Project id, when recorded. */
  projectId?: string
  /** Parent requirement id, when recorded. */
  parentId?: string
}

/** One employee-visible bot the execute dialog can select. */
export interface TaskBot {
  /** Stable bot id (agent bot id for cloud bots, local id for local bots). */
  id: string
  /** Human-readable display name. */
  name: string
  /** Execution backend the bot delegates to. */
  toolType: string
  /** Bot source: `claimed` / `assistant` / `local`. */
  source: string
}
