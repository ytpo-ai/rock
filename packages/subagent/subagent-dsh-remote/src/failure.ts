/**
 * Failure model for the `dsh web` Remote API provider: fixed safe diagnostics
 * derived only from structured facts, plus startup-wrapping helpers. The
 * client and run lifecycle share this module.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-remote/failure
 */

import type { DshRemoteFailureFacts } from './types.ts'

/**
 * Build a safe provider-authored diagnostic line from fixed facts. The text
 * never copies Remote error messages, paths, task content, or credentials.
 * @param facts - structured stage, category, and optional HTTP status or Remote code.
 * @returns the single-line diagnostic.
 */
export function failureDiagnostic(facts: DshRemoteFailureFacts): string {
  const fields = [
    'product: DSH Remote',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.httpStatus !== undefined) {
    fields.push(`HTTP status: ${facts.httpStatus}`)
  }
  if (facts.remoteCode !== undefined) {
    fields.push(`remote code: ${facts.remoteCode}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

/** A structured DSH Remote run failure carrying fixed safe facts. */
export class DshRemoteRunFailure extends Error {
  constructor(readonly facts: DshRemoteFailureFacts, cause?: unknown) {
    super(
      `subagent-dsh-remote: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'DshRemoteRunFailure'
  }
}

/**
 * Wrap a pre-publication working-directory or configuration failure behind
 * fixed startup facts.
 * @param cause - the original Host failure retained on the cause chain.
 * @returns a startup failure with a `configuration` category.
 */
export function dshRemoteConfigurationFailure(cause: unknown): Error {
  return new DshRemoteRunFailure({
    stage: 'connect',
    category: 'configuration',
  }, cause)
}

/**
 * Wrap a pre-publication connect/auth failure behind fixed startup facts.
 * @param cause - the original Host failure retained on the cause chain.
 * @returns a startup failure with an `auth` category.
 */
export function dshRemoteConnectFailure(cause: unknown): Error {
  return new DshRemoteRunFailure({
    stage: 'connect',
    category: 'auth',
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
    : new Error(`subagent-dsh-remote: request aborted: ${String(signal.reason)}`)
}
