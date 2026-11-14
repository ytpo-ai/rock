/**
 * Rock ConnectorClient outbound reporter plugin. It subscribes to the harness
 * `session/event` feed, stamps each event with Rock provenance, and forwards
 * batches to the Seagull ConnectorGateway with offline JSONL buffering.
 *
 * ```yaml
 * - id: gateway-reporter
 *   name: '@rock/gateway-reporter'
 *   config:
 *     gatewayUrl: http://127.0.0.1:3000/v1/connectors/report
 *     connectorClientId: rock-employee-a
 *     employeeId: employee-a
 *     bufferPath: .rock/events.jsonl
 * ```
 *
 * @module @rock/gateway-reporter
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { mapToM3 } from './m3.ts'
import { GatewayReporter } from './reporter.ts'
import type { RockReportEvent } from './types.ts'

export const name = 'rock-gateway-reporter'
export const inject = ['sessions']

const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const DEFAULT_MAX_BATCH_SIZE = 100

/** Deployment-owned gateway connection and provenance facts. */
export interface Config {
  /** Gateway report endpoint (POST batch). */
  gatewayUrl: string
  /** Rock instance identity stamped on every event. */
  connectorClientId: string
  /** Claiming employee identity stamped on every event. */
  employeeId?: string
  /** JSONL buffer file for offline buffering and replay. */
  bufferPath?: string
  /** Flush interval in milliseconds. */
  flushIntervalMs?: number
  /** Maximum events per POST batch. */
  maxBatchSize?: number
}

export const Config: z<Config> = z.object({
  gatewayUrl: z.string().min(1),
  connectorClientId: z.string().min(1),
  employeeId: z.string().min(1),
  bufferPath: z.string().min(1),
  flushIntervalMs: z.number().step(1).min(100).default(DEFAULT_FLUSH_INTERVAL_MS),
  maxBatchSize: z.number().step(1).min(1).default(DEFAULT_MAX_BATCH_SIZE),
})

/** Map one harness session event into an outbound Rock report envelope. */
function toReportEvent(session: Session, event: SessionEvent, config: Config): RockReportEvent {
  const mapped = mapToM3(event)
  return {
    eventId: `${String(session.id)}:${String(event.seq)}`,
    sessionId: String(session.id),
    type: mapped.type,
    timestamp: new Date(event.time).toISOString(),
    payload: mapped.payload,
    ...config.employeeId === undefined ? {} : { employeeId: config.employeeId },
    connectorClientId: config.connectorClientId,
    relayed: true,
  }
}

/** Default transport: POST the batch as `{ events: [...] }` to the gateway. */
async function postBatch(url: string, events: readonly RockReportEvent[]): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  })
  if (!response.ok) throw new Error(`gateway POST failed: ${response.status}`)
}

/** Mount the reporter: replay the buffer, subscribe to session events, and flush on an interval. */
export function apply(ctx: Context, config: Config): void {
  const reporter = new GatewayReporter({
    gatewayUrl: config.gatewayUrl,
    connectorClientId: config.connectorClientId,
    ...config.employeeId === undefined ? {} : { employeeId: config.employeeId },
    ...config.bufferPath === undefined ? {} : { bufferPath: config.bufferPath },
    flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxBatchSize: config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
    post: postBatch,
  })

  void reporter.replay().then(() => reporter.start())
  ctx.on('session/event', (session, event) => {
    reporter.enqueue(toReportEvent(session, event, config))
  })
  ctx.effect(() => () => reporter.stop(), 'gateway-reporter.stop()')
}
