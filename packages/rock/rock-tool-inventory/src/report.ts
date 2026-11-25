/**
 * Outbound tool-service-status report: POST one liveness snapshot to the
 * Seagull ConnectorGateway with the connector key bearer, best-effort (the
 * caller catches). Mirrors the `rock-heartbeat` transport shape.
 *
 * @module @rock/rock-tool-inventory/report
 */
import type { ToolServiceStatus } from './types.ts'

/**
 * POST one tool-service-status snapshot to the gateway endpoint.
 * @param url - the gateway endpoint (full URL).
 * @param key - the connector key used as the bearer token.
 * @param tools - the freshest service-status rows.
 * @param fetchFn - injectable fetch for tests.
 */
export async function postToolStatus(
  url: string,
  key: string,
  tools: readonly ToolServiceStatus[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tools }),
  })
  if (!response.ok) throw new Error(`tool-status report failed: ${response.status}`)
}
