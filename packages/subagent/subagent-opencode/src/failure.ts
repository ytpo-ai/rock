/**
 * Failure model for the OpenCode v2 provider: fixed safe diagnostics derived
 * only from structured facts, plus startup-wrapping helpers. The client and
 * run lifecycle share this module so HTTP errors and startup failures carry
 * one consistent vocabulary.
 *
 * @module @deepseek-ai/dsh-subagent-opencode/failure
 */

import type { OpencodeFailureFacts } from './types.ts'

/**
 * Build a safe provider-authored diagnostic line from fixed facts. The text
 * never copies response bodies, paths, task content, or credentials.
 * @param facts - structured stage, category, and optional HTTP status.
 * @returns the single-line diagnostic.
 */
export function failureDiagnostic(facts: OpencodeFailureFacts): string {
  const fields = [
    'product: OpenCode',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.httpStatus !== undefined) {
    fields.push(`HTTP status: ${facts.httpStatus}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

/** A structured OpenCode run failure carrying fixed safe facts. */
export class OpencodeRunFailure extends Error {
  constructor(readonly facts: OpencodeFailureFacts, cause?: unknown) {
    super(
      `subagent-opencode: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'OpencodeRunFailure'
  }
}

/**
 * Wrap a pre-publication working-directory or configuration failure behind
 * fixed startup facts.
 * @param cause - the original Host failure retained on the cause chain.
 * @returns a startup failure with a `configuration` category.
 */
export function opencodeConfigurationFailure(cause: unknown): Error {
  return new OpencodeRunFailure({
    stage: 'discover',
    category: 'configuration',
  }, cause)
}

/**
 * Wrap a pre-publication service discovery failure (missing or unreadable
 * service file, missing credentials) behind fixed startup facts.
 * @param cause - the original Host failure retained on the cause chain.
 * @returns a startup failure with a `discovery` category.
 */
export function opencodeDiscoveryFailure(cause: unknown): Error {
  return new OpencodeRunFailure({
    stage: 'discover',
    category: 'discovery',
  }, cause)
}

/**
 * Normalize an aborted signal into an Error with a stable message.
 * @param signal - the aborted signal.
 * @returns the signal's reason as an Error, or a synthesized abort Error.
 */
export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-opencode: request aborted: ${String(signal.reason)}`)
}
