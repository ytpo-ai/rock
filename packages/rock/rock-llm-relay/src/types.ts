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
  /** Local inbound bearer key required on every request; distinct from the cloud connector key. */
  localKey: string
  /** Seagull cloud LLM Proxy origin; the relay appends `/v1/bots/{agentBotId}<path-suffix>`. */
  cloudBaseUrl: string
  /** Resolve the connector key presented as the cloud Bearer (D-034/REQ-013). */
  resolveConnectorKey?: () => string | undefined
  /** Rock instance identity stamped as `x-seagull-connector-client-id`. */
  connectorClientId: string
  /** Resolve the claiming employee for one agent bot, or `undefined`. */
  resolveEmployeeId: (agentBotId: string) => string | undefined
  /** Forward transport, injectable for tests. */
  forward?: (url: string, init: RequestInit) => Promise<Response>
  /** Record one forwarding attempt (success or failure); the plugin enriches and persists it. */
  onForward?: (log: RelayForwardLog) => void
}

/** Host-side facts the relay exposes to other plugins (the bot-manager drawer). */
export interface RockLlmRelayFacts {
  /** Loopback bind host. */
  host: string
  /** Actual bound port. */
  port: number
  /** Loopback origin, e.g. `http://127.0.0.1:4090`. */
  baseUrl: string
  /** Local inbound bearer key (distinct from the cloud connector key). */
  apiKey: string
}

/** One parsed relay route: `/v1/bots/{agentBotId}{pathSuffix}[?query]`. */
export interface RelayRoute {
  agentBotId: string
  /** Canonical path suffix without the query string, e.g. `/messages`. */
  pathSuffix: string
  /** Raw query string including the leading `?`, or `undefined` when absent. */
  query?: string
}

/** One recorded LLM-relay forwarding attempt. */
export interface RelayForwardLog {
  /** ISO-8601 timestamp of forward completion. */
  timestamp: string
  /** ISO-8601 timestamp of request arrival, before forwarding. */
  startedAt?: string
  /** Elapsed milliseconds from request arrival to forward completion. */
  durationMs?: number
  /** Resolved agent bot id from `/v1/bots/{agentBotId}`. */
  agentBotId: string
  /** Human-readable bot name resolved from the identity claim, when available. */
  botName?: string
  /** Execution backend the bot binds to (codex/pi/dsh/acp/…), when bound. */
  toolType?: string
  /** Path suffix, e.g. `/chat/completions` or `/responses`. */
  pathSuffix: string
  /** Wire protocol inferred from the path suffix (`anthropic-messages` / `openai-responses` / `chat-completions`). */
  wireProtocol?: string
  /** Rock/DSH delegator session id, from `x-dsh-session-id` header (fallback: body `sessionId`). */
  rockSessionId?: string
  /** The external tool's own session identifier, when it presents one. */
  toolSessionId?: string
  /** The original `model` field from the inbound request body (before mapping). */
  requestModel?: string
  /** The model id the relay stamps onto the forwarded body (`seagull-relay`). */
  mappedModel: string
  /** The bot's bound model resolved from the seat claim, when available. */
  boundModel?: string
  /** Upstream HTTP status when forwarding completed. */
  status?: number
  /** Safe failure diagnostic when the forward failed. */
  error?: string
}
