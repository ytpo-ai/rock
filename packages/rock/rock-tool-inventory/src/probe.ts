/**
 * Tool probing: turn a `--version` run's outcome into a status row. A missing
 * command (`ENOENT`) means "not installed"; any other error means the command
 * resolved but did not report a version.
 *
 * @module @rock/rock-tool-inventory/probe
 */
import type { ToolStatus } from './types.ts'

/** Map a probe outcome to a status row. */
export function toolStatusFrom(id: string, stdout: string | undefined, error: unknown): ToolStatus {
  if (error === undefined) {
    const version = firstLine(stdout ?? '')
    return version.length > 0 ? { id, installed: true, version } : { id, installed: true }
  }
  if (isEnoent(error)) return { id, installed: false }
  return { id, installed: true }
}

/** Whether an error is the "no such file or directory" from an unknown command. */
function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** First trimmed line of a command's output, or an empty string. */
function firstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? ''
}
