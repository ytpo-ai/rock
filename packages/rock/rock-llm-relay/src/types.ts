/**
 * Rock LLM relay vocabulary: the provenance header names (D-034) and the
 * resolved connection facts shared between the relay server and the plugin.
 */

/** HTTP header names the relay stamps onto every forwarded request. */
export const PROVENANCE_HEADERS = {
  agentBotId: 'x-seagull-agent-bot-id',
  employeeId: 'x-seagull-employee-id',
  connectorClientId: 'x-seagull-connector-client-id',
  relayed: 'x-seagull-relayed',
} as const

/** Resolved configuration for the relay server. */
export interface RockLlmRelayOptions {
  /** Loopback bind host (default `127.0.0.1`). */
  host: string
  /** Loopback bind port. */
  port: number
  /** Seagull cloud LLM Proxy origin; the relay appends `/v1<path-suffix>`. */
  cloudBaseUrl: string
  /** Bearer agent API key presented to the cloud Proxy. */
  agentApiKey?: string
  /** Rock instance identity stamped as `x-seagull-connector-client-id`. */
  connectorClientId: string
  /** Resolve the claiming employee for one agent bot, or `undefined`. */
  resolveEmployeeId: (agentBotId: string) => string | undefined
  /** Forward transport, injectable for tests. */
  forward?: (url: string, init: RequestInit) => Promise<Response>
}

/** One parsed relay route: `/v1/bots/{agentBotId}{pathSuffix}`. */
export interface RelayRoute {
  agentBotId: string
  pathSuffix: string
}
