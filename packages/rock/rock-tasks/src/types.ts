/**
 * Rock task vocabulary: one cloud task assigned to a claimed agent bot,
 * projected for the overview and task-management console panels, plus the
 * per-task archive record kinds written into each task JSONL file.
 *
 * @module @rock/rock-tasks/types
 */

/** One skill associated with a task, as projected from the cloud work-queue API. */
export interface TaskSkill {
  /** Skill id from the agent_skills collection. */
  id: string
  /** Human-readable skill name. */
  name: string
}

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
  /** Blocked flag (方案 A): overlay on `status`, marked red in place. */
  isBlocked?: boolean
  /** Block reason, when blocked. */
  blockReason?: string
  /** Owning agent bot id; empty when unassigned. */
  executorId: string
  /** Responsible human employee, when recorded. */
  assignee?: string
  /** Project id, when recorded. */
  projectId?: string
  /** Parent requirement id, when recorded. */
  parentId?: string
  /** Priority (`low` / `medium` / `high`), when recorded. */
  priority?: string
  /** Due date as ISO-8601, when recorded. */
  dueAt?: string
  /** Creation time as ISO-8601. */
  createdAt?: string
  /** Associated skill information. */
  skills?: TaskSkill[]
}

/** One employee-visible bot the execute dialog can select. */
export interface TaskBot {
  /** Stable bot id (agent bot id for cloud bots, local id for local bots). */
  id: string
  /** Human-readable display name. */
  name: string
  /** Execution backend the bot delegates to; absent when the bot is unbound. */
  toolType?: string
  /** Bot source: `claimed` / `assistant` / `local`. */
  source: string
}

/** Record kind captured into one task archive file. */
export type TaskWorkRecordType =
  | 'task.definition'
  | 'run.start'
  | 'run.end'
  | 'tool.call'
  | 'tool.result'
  | 'step.start'
  | 'step.end'
  | 'turn.start'
  | 'turn.end'
  | 'assistant.message'
  | 'task.receipt'

/** One durable agent work record for a task. */
export interface TaskWorkRecord {
  /** Owning task id. */
  taskId: string
  /** DSH session that produced the record (event records only). */
  sessionId?: string
  /** Record kind. */
  type: TaskWorkRecordType
  /** ISO-8601 timestamp. */
  timestamp: string
  /** Monotonic session sequence number (session-event records only). */
  seq?: number
  /** Invoked tool id (tool.call / tool.result only). */
  toolId?: string
  /** Raw tool-call arguments (tool.call only). */
  args?: string
  /** Whether the tool result succeeded (tool.result only). */
  ok?: boolean
  /** Tool failure reason (tool.result only). */
  error?: string
  /** Owning step index (step.* / tool.* / assistant.message only). */
  stepId?: number
  /** Owning turn index (step.* / turn.* / assistant.message only). */
  turn?: number
  /** Turn end reason (turn.end only). */
  reason?: string
  /** Owning run id (run.* only). */
  runId?: string
  /** Executing bot id (run.start only). */
  botId?: string
  /** Assistant message text (assistant.message only). */
  text?: string
  /** Token usage (assistant.message / task.receipt only). */
  usage?: { inputTokens?: number; outputTokens?: number }
  /** Structured payload (task.definition snapshot / task.receipt). */
  data?: TaskSummary | TaskReceipt
}

/** The first line of a task archive file. */
export interface TaskHeader {
  type: 'task'
  version: 1
  taskId: string
  projectId: string | null
  createdAt: number
  cwd: string
}

/** The terminal receipt an executing bot writes at task completion. */
export interface TaskReceipt {
  outcome: 'success' | 'failed' | 'partial'
  summary: string
  deliverables?: string[]
  artifactPaths?: string[]
  reportedBy?: string
  completedAt?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** Index entry reconstructed from one archived task file, for the history tab. */
export interface ArchivedTaskSummary {
  id: string
  projectId: string | null
  title: string
  status: string
  resolution?: string
  executorId?: string
  /** Archive creation epoch milliseconds (from the file header). */
  createdAt?: number
  receipt?: TaskReceipt
}

/** The durable task archive index file (the flat thumbnail of all tasks). */
export interface ArchiveIndex {
  version: 1
  tasks: ArchivedTaskSummary[]
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'rockTasks/unconfigured': Record<string, never>
    'rockTasks/runFailed': Record<string, never>
    'rockTasks/launchFailed': Record<string, never>
  }
}
