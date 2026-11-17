/**
 * Rock ConnectorClient heartbeat plugin. It resolves the connector identity
 * from `rock-onboarding` and POSTs a periodic liveness beat to the Seagull
 * ConnectorGateway so the cloud can derive online/offline state per Rock.
 *
 * ```yaml
 * - id: rock-heartbeat
 *   name: '@rock/rock-heartbeat'
 *   config:
 *     heartbeatIntervalMs: 30000
 * ```
 *
 * @module @rock/rock-heartbeat
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Heartbeat } from './heartbeat.ts'

export const name = 'rock-heartbeat'
export const inject = ['rockOnboarding']

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000

/** Deployment-owned heartbeat cadence. */
export interface Config {
  /** Interval between heartbeats in milliseconds. */
  heartbeatIntervalMs?: number
}

export const Config: z<Config> = z.object({
  heartbeatIntervalMs: z.number().step(1).min(1000).default(DEFAULT_HEARTBEAT_INTERVAL_MS),
})

/** Minimal structural view of the `rock-onboarding` service (declared injection). */
interface OnboardingLike {
  getRecord(): { baseUrl: string; key: string } | null
}

/** Mount the heartbeat: re-resolve identity each beat so a later key entry is picked up. */
export function apply(ctx: Context, config: Config): void {
  const heartbeat = new Heartbeat({
    intervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    resolve: () => {
      const onboarding = ctx.get('rockOnboarding') as OnboardingLike | undefined
      const record = onboarding?.getRecord()
      if (record === null || record === undefined) return null
      return { baseUrl: record.baseUrl, key: record.key }
    },
  })
  heartbeat.start()
  ctx.effect(() => () => { heartbeat.stop() }, 'rock-heartbeat.stop()')
}
