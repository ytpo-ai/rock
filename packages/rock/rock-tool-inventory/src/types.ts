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
  /**
   * How Rock delegates tasks to this tool's resident service/daemon (the debug
   * smoke-test target), as opposed to a one-shot CLI subprocess. Absent when the
   * tool has no resident service transport.
   */
  serviceHint?: string
  /** Whether the panel offers a "configure" action to set the service connection (url + token). */
  configurable?: boolean
  /** Whether the connection token is required (dsh) rather than optional (opencode auto-discovers it). */
  requiresToken?: boolean
}

/** The tool's client form, used to guide detection and install guidance. */
export type ToolClientType = 'gui' | 'tui'

/** A user-supplied service connection for one tool, plus the detection/debug hints Rock persists. */
export interface ToolConnectionConfig {
  /** Service base URL; empty means "detect it" (the assistant or provider discovery fills it). */
  url?: string
  /** Secret token/password; required for `dsh`, optional for `opencode`. */
  token?: string
  /** Client form the tool currently runs as (GUI app vs terminal UI). */
  clientType?: ToolClientType
  /** The tool's own root directory (install/working directory), reused by detection and debug. */
  rootDir?: string
  /** The tool's config home directory (for example `~/.dsh`), reused by detection and debug. */
  configRootDir?: string
  /** Command that starts the tool's resident service/daemon. */
  startupCommand?: string
}

/** A detection-derived connection patch for one tool: fields to backfill when the persisted value is empty. */
export interface ToolConnectionPatch {
  /** Tool type id the patch applies to. */
  id: string
  /** Detected client form, when the assistant reported one. */
  clientType?: ToolClientType
  /** Detected tool root directory, when the assistant reported one. */
  rootDir?: string
  /** Detected tool config home directory, when the assistant reported one. */
  configRootDir?: string
  /** Detected resident-service startup command, when the assistant reported one. */
  startupCommand?: string
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

/** Live service-status row produced by the periodic transport-level liveness probe. */
export interface ToolServiceStatus {
  /** Tool type id. */
  id: string
  /** Whether the tool's resident service/daemon was reachable at the last probe. */
  running: boolean
  /** ISO timestamp of the last probe that produced this row. */
  lastCheckedAt: string
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
    /**
     * A periodic service-status probe finished: the freshest transport-level
     * `running` state for every probed tool. Consumers re-read
     * `ctx.rockToolInventory` for the merged statuses.
     * @param statuses - the probe results, in declaration order.
     * @mode emit
     */
    'rock-tool-inventory/service-status'(statuses: readonly ToolServiceStatus[]): void
  }
}
