/**
 * One-shot invocation of a bot's bound tool for the card's "test" action. Runs
 * the tool's non-interactive CLI command with the fixed smoke-test prompt and
 * returns a structured outcome so the panel can show a real answer or a safe
 * failure diagnostic.
 *
 * @module @rock/rock-bot-manager/run
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** The fixed smoke-test prompt the "test" action sends to the bound tool. */
export const TEST_PROMPT = '请查询并回答当前北京的天气'

/** Default wall-clock timeout for one one-shot tool run. */
export const DEFAULT_TOOL_RUN_TIMEOUT_MS = 120_000

/** One tool's non-interactive run command; `{prompt}` in an arg is replaced by the test prompt. */
export interface ToolRunSpec {
  /** CLI command that starts the tool. */
  command: string
  /** Arguments passed to the command; `{prompt}` is replaced by the smoke-test prompt. */
  args: string[]
  /** Per-run timeout override; defaults to {@link DEFAULT_TOOL_RUN_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** Structured outcome of one tool smoke-test. */
export interface ToolRunResult {
  /** Whether the tool answered with non-empty stdout. */
  ok: boolean
  /** The tool's trimmed stdout answer, on success. */
  answer?: string
  /** A safe failure diagnostic, on failure. */
  error?: string
}

/** Run one tool one-shot with the fixed prompt. */
export async function runTool(spec: ToolRunSpec, prompt: string): Promise<ToolRunResult> {
  const args = spec.args.map(arg => arg.replaceAll('{prompt}', prompt))
  try {
    const { stdout, stderr } = await execFileAsync(spec.command, args, {
      timeout: spec.timeoutMs ?? DEFAULT_TOOL_RUN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    })
    const answer = stdout.trim()
    if (answer.length === 0) return { ok: false, error: stderr.trim() || 'tool produced no output' }
    return { ok: true, answer }
  } catch (error) {
    return { ok: false, error: toolRunError(error) }
  }
}

/** A safe, secret-free diagnostic for a failed tool run. */
function toolRunError(error: unknown): string {
  if (error instanceof Error) {
    const exec = error as Error & { code?: string; stderr?: string; killed?: boolean }
    const stderr = typeof exec.stderr === 'string' ? exec.stderr.trim() : ''
    const prefix = exec.killed === true ? 'timed out' : error.message
    return stderr.length > 0 ? `${prefix}: ${stderr}` : prefix
  }
  if (typeof error === 'string') return error
  return 'unknown error'
}
