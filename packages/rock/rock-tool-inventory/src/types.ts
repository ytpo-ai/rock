/**
 * Rock tool inventory vocabulary: one probed agent tool on the employee
 * workbench, its detected install/run state, and the assistant-LLM detection
 * progress exposed to the panel.
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

/** Live progress of one assistant-LLM detection run. */
export interface DetectProgress {
  /** Total probe targets. */
  total: number
  /** Number of distinct targets the assistant has touched so far. */
  detected: number
  /** The last shell command the assistant ran, when any. */
  current?: string
  /** Number of shell commands run so far. */
  steps: number
}

/** Current detection run state exposed to the panel. */
export interface DetectState {
  /** Whether a detection run is in flight. */
  running: boolean
  /** The assistant session id for the current (or last) run. */
  sessionId?: string
  /** ISO timestamp of the last completed detection. */
  lastDetectedAt?: string
  /** Latest statuses: fast-probe prefill merged with assistant results. */
  statuses: ToolStatus[]
  /** Live progress; the process itself renders in the assistant session. */
  progress: DetectProgress
  /** Safe failure diagnostic when the run could not start or failed. */
  error?: string
}

/** Outcome of one per-tool assistant debug run. */
export interface DebugResult {
  /** Tool type id that was debugged. */
  id: string
  /** Whether the tool's invocation smoke-test passed (or was fixed to pass). */
  ok: boolean
  /** The assistant's plain-text conclusion, when it produced one. */
  summary?: string
  /** A safe diagnostic or the next fix step, when the run did not pass. */
  diagnostic?: string
  /** ISO timestamp when the debug run finished. */
  finishedAt?: string
}

/** Current per-tool debug run state exposed to the panel. */
export interface DebugState {
  /** Whether a debug run is in flight. */
  running: boolean
  /** The tool id being debugged (or last debugged). */
  toolId?: string
  /** The assistant session id for the current (or last) run. */
  sessionId?: string
  /** The completed result of the last debug run, when any. */
  result?: DebugResult
  /** Live progress; the full process renders in the assistant session. */
  progress: DetectProgress
  /** Safe failure diagnostic when the run could not start or failed. */
  error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A detection run finished: the assistant result was merged over the fast
     * probe and persisted. Payload-free; consumers re-read
     * `ctx.rockToolInventory` for the fresh statuses.
     * @mode emit
     */
    'rock-tool-inventory/detected'(): void
  }
}
