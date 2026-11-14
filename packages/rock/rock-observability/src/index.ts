/**
 * Rock local observability plugin: folds the harness `session/event` feed into
 * a per-session turns/steps/output-tokens aggregate and exposes it on the
 * context. The dashboard Client reads `ctx.rockObservability` (or a later
 * Remote projection of it) to show which session ran how many rounds/steps and
 * how many output tokens it produced.
 *
 * ```yaml
 * - id: rock-observability
 *   name: '@rock/rock-observability'
 * ```
 *
 * @module @rock/rock-observability
 */
import type { Context } from '@deepseek-ai/cordis'
import { RockObservabilityService } from './service.ts'

export const name = 'rock-observability'
export const inject = ['sessions']

/** Mount the observability fold and subscribe to committed session events. */
export function apply(ctx: Context): void {
  const service = new RockObservabilityService()
  ctx.on('session/event', (session, event) => {
    service.observe(session, event)
  })
  ctx.provide('rockObservability', service)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local observability fold (per-session turns/steps/outputTokens). */
    rockObservability: RockObservabilityService
  }
}
