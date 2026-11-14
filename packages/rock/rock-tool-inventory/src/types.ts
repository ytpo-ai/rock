/**
 * Rock tool inventory vocabulary: one probed agent tool on the employee
 * workbench. The tool id is the same string the bot-binding `toolType` uses.
 *
 * @module @rock/rock-tool-inventory/types
 */

/** One probe target: a stable tool id and the CLI command that identifies it. */
export interface ToolDescriptor {
  /** Stable tool type id, shared with the bot-binding `toolType`. */
  id: string
  /** CLI command used to probe the tool. */
  command: string
}

/** Detected state of one agent tool on this machine. */
export interface ToolStatus {
  /** Tool type id. */
  id: string
  /** Whether the CLI command resolved on this machine. */
  installed: boolean
  /** Detected version string, when the tool reported one. */
  version?: string
}
