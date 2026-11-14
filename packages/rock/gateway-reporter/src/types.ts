/**
 * One outbound report envelope the gateway accepts. It reuses the M3 event
 * vocabulary (eventId/sessionId/type/timestamp/payload) and adds the Rock
 * provenance fields the cloud validates against the claim relation (REQ-003).
 */
export interface RockReportEvent {
  /** Idempotency key derived from the source session event (sessionId:seq). */
  eventId: string
  sessionId: string
  /** Source session event type, mapped to the M3 vocabulary where known. */
  type: string
  /** ISO-8601 timestamp of the source event. */
  timestamp: string
  /** Source session event data, verbatim. */
  payload: Record<string, unknown>
  /** Claiming employee (from configuration). */
  employeeId?: string
  /** Rock instance identity (from configuration). */
  connectorClientId: string
  /** Always true: this event reached the gateway through Rock. */
  relayed: true
}

/** Resolved configuration for the reporter. */
export interface GatewayReporterOptions {
  /** Gateway events endpoint (POST batch). */
  gatewayUrl: string
  /** Rock instance identity stamped on every event. */
  connectorClientId: string
  /** Claiming employee identity stamped on every event. */
  employeeId?: string
  /** JSONL buffer file for offline buffering and replay. */
  bufferPath?: string
  /** Maximum events per POST batch. */
  maxBatchSize: number
  /** Flush interval in milliseconds. */
  flushIntervalMs: number
  /** Fetch-like transport, injectable for tests. */
  post: (url: string, events: readonly RockReportEvent[]) => Promise<void>
}
