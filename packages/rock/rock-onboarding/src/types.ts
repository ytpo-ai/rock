/**
 * Rock onboarding vocabulary: the resolved connector-client identity and the
 * locally persisted key record (including the Seagull base URL).
 *
 * @module @rock/rock-onboarding/types
 */

/** Employee-level identity resolved from a connector key. */
export interface ConnectorIdentity {
  /** Connector client id (Rock instance id). */
  clientId: string
  /** Claiming employee id. */
  employeeId: string
}

/** One persisted connector-key record, including the Seagull base URL and raw key. */
export interface ConnectorKeyRecord extends ConnectorIdentity {
  /** Seagull backend base URL (e.g. `http://localhost:3000`). */
  baseUrl: string
  /** Raw `sk-connector-*` key, stored locally on the workbench. */
  key: string
}
