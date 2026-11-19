/**
 * Rock tool inventory vocabulary: one probed agent tool on the employee
 * workbench, its detected install/run state, and the assistant-LLM detection
 * transcript exposed to the panel.
 *
 * @module @rock/rock-tool-inventory/types
 */

/** One probe target: a stable tool id and the CLI command that identifies it. */
export interface ToolDescriptor {
  /** Stable tool type id, shared with the bot-binding `toolType`. */
  id: string
  /** CLI command used to probe the tool. */
  command: string
  /** Official install documentation URL surfaced for missing tools. */
  installDocUrl?: string
}

/** Which detection path produced a status. */
export type DetectSource = 'probe' | 'assistant'

/** Detected state of one agent tool on this machine. */
export interface ToolStatus {
  /** Tool type id. */
  id: string
  /** Whether the CLI command resolved on this machine. */
  installed: boolean
  /** Whether the tool's long-running service/daemon or listening port is up (assistant detection only). */
  running?: boolean
  /** Detected version string, when the tool reported one. */
  version?: string
  /** Official install documentation URL, when the descriptor provides one. */
  installDocUrl?: string
  /** ISO timestamp of the last detection that produced this row. */
  lastCheckedAt?: string
  /** Which path produced this row: `probe` (fast `--version`) or `assistant` (专属助理 LLM). */
  detectedBy?: DetectSource
}

/** One assistant-LLM detection transcript record. */
export interface DetectRecord {
  /** Record kind. */
  type: 'assistant.message' | 'tool.call' | 'tool.result'
  /** ISO timestamp. */
  timestamp: string
  /** Assistant message text (`assistant.message` only). */
  text?: string
  /** Tool id (`tool.call` / `tool.result` only). */
  toolId?: string
  /** The shell command the tool ran (`tool.call` only). */
  command?: string
  /** Whether the tool call succeeded (`tool.result` only). */
  ok?: boolean
}

/** Current detection run state exposed to the panel. */
export interface DetectState {
  /** Whether a detection run is in flight. */
  running: boolean
  /** The assistant session id for the current (or last) run. */
  sessionId?: string
  /** Latest statuses: fast-probe prefill merged with assistant results. */
  statuses: ToolStatus[]
  /** Detection transcript records, in order. */
  records: DetectRecord[]
  /** Safe failure diagnostic when the run could not start or failed. */
  error?: string
}
