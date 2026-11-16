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
  /** Done-state sub-result (`accepted` / `rejected`), when the task is done. */
  resolution?: string
  /** Owning agent bot / planning seat id. */
  executorId: string
  /** Responsible human employee, when recorded. */
  assignee?: string
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

/** Record kind captured from the DSH session for one task. */
export type TaskWorkRecordType =
  | 'tool.call'
  | 'tool.result'
  | 'step.start'
  | 'step.end'
  | 'turn.start'
  | 'turn.end'

/** One durable agent work record for a task. */
export interface TaskWorkRecord {
  /** Owning task id. */
  taskId: string
  /** DSH session that produced the record. */
  sessionId: string
  /** Record kind. */
  type: TaskWorkRecordType
  /** ISO-8601 timestamp. */
  timestamp: string
  /** Invoked tool id (tool.call / tool.result only). */
  toolId?: string
  /** Raw tool-call arguments (tool.call only). */
  args?: string
  /** Whether the tool result succeeded (tool.result only). */
  ok?: boolean
  /** Tool failure reason (tool.result only). */
  error?: string
  /** Owning step index (step.* only). */
  stepId?: number
  /** Owning turn index (step.* / turn.* only). */
  turn?: number
  /** Turn end reason (turn.end only). */
  reason?: string
}
