/**
 * Rock ConnectorClient LLM relay plugin (D-034). It mounts a loopback
 * OpenAI-compatible endpoint so external tools route their LLM calls through
 * Rock, which stamps each forwarded request with provenance and forwards it to
 * the Seagull cloud LLM Proxy.
 *
 * ```yaml
 * - id: llm-relay
 *   name: '@rock/rock-llm-relay'
 *   config:
 *     host: 127.0.0.1
 *     port: 4090
 *     cloudBaseUrl: http://127.0.0.1:3000
 *     agentApiKey: sk-agent-xxxx
 *     connectorClientId: rock-employee-a
 * ```
 *
 * @module @rock/rock-llm-relay
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RockLlmRelay } from './relay.ts'

export const name = 'rock-llm-relay'
export const inject = []

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4090

/** Minimal structural view of the `seagull-identity` service (optional dep). */
interface IdentityLike {
  getClaims(): readonly { agentBotId: string; employeeId: string }[]
}

/** Deployment-owned relay connection facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Loopback bind host. */
  host?: string
  /** Loopback bind port. */
  port?: number
  /** Seagull cloud LLM Proxy origin; the relay appends `/v1/bots/{agentBotId}<path-suffix>`. */
  cloudBaseUrl: string
  /** Rock instance identity stamped as `x-seagull-connector-client-id`. */
  connectorClientId: string
}

export const Config: z<Config> = z.object({
  host: z.string().min(1).default(DEFAULT_HOST),
  port: z.number().step(1).min(1).max(65535).default(DEFAULT_PORT),
  cloudBaseUrl: z.string().min(1),
  connectorClientId: z.string().min(1),
})

/** Mount the relay and dispose the server with the fiber. */
export function apply(ctx: Context, config: Config): void {
  const relay = new RockLlmRelay({
    host: config.host ?? DEFAULT_HOST,
    port: config.port ?? DEFAULT_PORT,
    cloudBaseUrl: config.cloudBaseUrl,
    resolveConnectorKey: () => {
      const onboarding = ctx.get('rockOnboarding') as { getRecord(): { key: string } | null } | undefined
      return onboarding?.getRecord()?.key
    },
    connectorClientId: config.connectorClientId,
    resolveEmployeeId: (agentBotId) => {
      const identity = ctx.get('seagullIdentity') as IdentityLike | undefined
      return identity?.getClaims().find(claim => claim.agentBotId === agentBotId)?.employeeId
    },
  })

  void relay.start().then((port) => {
    ctx.logger.info(`rock-llm-relay listening on http://${config.host ?? DEFAULT_HOST}:${port}`)
  })
  ctx.effect(() => () => { void relay.stop() }, 'rock-llm-relay.stop()')
}
