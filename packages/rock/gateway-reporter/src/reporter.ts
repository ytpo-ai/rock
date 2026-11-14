/**
 * Outbound reporter for Rock ConnectorClient. It buffers session events in an
 * in-memory queue mirrored to a JSONL file, flushes them to the ConnectorGateway
 * in batches, and replays the file on startup so offline events are补传 once
 * connectivity returns.
 *
 * Buffer I/O is synchronous so the file always mirrors the queue at every
 * commit point; the buffer is small and written on the local workbench.
 *
 * @module @rock/gateway-reporter/reporter
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GatewayReporterOptions, RockReportEvent } from './types.ts'

/** Batches and forwards Rock session events with offline buffering. */
export class GatewayReporter {
  private readonly queue: RockReportEvent[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private flushing = false

  constructor(private readonly options: GatewayReporterOptions) {}

  /** Number of events currently buffered (not yet delivered). */
  get pending(): number {
    return this.queue.length
  }

  /** Replay the persisted buffer into the in-memory queue (offline补传). */
  async replay(): Promise<void> {
    if (this.options.bufferPath === undefined || !existsSync(this.options.bufferPath)) return
    const raw = readFileSync(this.options.bufferPath, 'utf8')
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      this.queue.push(JSON.parse(line) as RockReportEvent)
    }
  }

  enqueue(event: RockReportEvent): void {
    this.queue.push(event)
    this.persist(event)
    if (this.queue.length >= this.options.maxBatchSize) void this.flush()
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { void this.flush() }, this.options.flushIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    this.flushing = true
    try {
      const batch = this.queue.splice(0, this.options.maxBatchSize)
      try {
        await this.options.post(this.options.gatewayUrl, batch)
        this.rewriteBuffer()
      } catch {
        // Delivery failed: restore the batch for a later retry.
        this.queue.unshift(...batch)
      }
    } finally {
      this.flushing = false
    }
  }

  private persist(event: RockReportEvent): void {
    if (this.options.bufferPath === undefined) return
    mkdirSync(dirname(this.options.bufferPath), { recursive: true })
    appendFileSync(this.options.bufferPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private rewriteBuffer(): void {
    if (this.options.bufferPath === undefined) return
    const content = this.queue.map(event => JSON.stringify(event)).join('\n')
    writeFileSync(this.options.bufferPath, content.length > 0 ? `${content}\n` : '', 'utf8')
  }
}
