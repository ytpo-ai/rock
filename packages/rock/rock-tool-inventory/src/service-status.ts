/**
 * Periodic service-status poller. It probes every tool's resident service at
 * the transport level on a fixed interval and reports the freshest
 * `running`/`lastCheckedAt` rows to a callback, mirroring the best-effort
 * interval pattern of `rock-heartbeat` (unref + dispose cleanup + never throw).
 *
 * @module @rock/rock-tool-inventory/service-status
 */
import type { ToolConnectionConfig, ToolDescriptor, ToolServiceStatus } from './types.ts'
import { probeServiceLiveness } from './service-probe.ts'

/** Constructor options owned by the controller's `apply`/constructor. */
export interface ServiceStatusPollerOptions {
  /** Interval between probe rounds in milliseconds. */
  intervalMs: number
  /** Per-probe timeout in milliseconds. */
  timeoutMs: number
  /** Probe targets. */
  tools: readonly ToolDescriptor[]
  /** Resolves the persisted service connections at each round. */
  connections: () => Record<string, ToolConnectionConfig>
  /** Received after every round with the freshest statuses (in declaration order). */
  onResult: (statuses: readonly ToolServiceStatus[]) => void
  /** Transport-level probe; injectable for tests. */
  probe?: (toolId: string, connection: ToolConnectionConfig | undefined, timeoutMs: number) => Promise<boolean>
}

/** Probes the resident services periodically and reports each round's result. */
export class ServiceStatusPoller {
  private timer: ReturnType<typeof setInterval> | undefined
  private polling = false

  constructor(private readonly options: ServiceStatusPollerOptions) {}

  /** Begin periodic probing; runs one round immediately. */
  start(): void {
    if (this.timer !== undefined) return
    void this.poll()
    this.timer = setInterval(() => { void this.poll() }, this.options.intervalMs)
    this.timer.unref()
  }

  /** Stop periodic probing. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Probe every tool once and report the freshest statuses; best-effort, never throws. */
  async poll(): Promise<ToolServiceStatus[]> {
    if (this.polling) return []
    this.polling = true
    try {
      const connections = this.options.connections()
      const probe = this.options.probe ?? probeServiceLiveness
      const lastCheckedAt = new Date().toISOString()
      const statuses: ToolServiceStatus[] = []
      for (const tool of this.options.tools) {
        let running = false
        try {
          running = await probe(tool.id, connections[tool.id], this.options.timeoutMs)
        } catch {
          running = false
        }
        statuses.push({ id: tool.id, running, lastCheckedAt })
      }
      try {
        this.options.onResult(statuses)
      } catch {
        // A throwing consumer must not stop the poll loop.
      }
      return statuses
    } finally {
      this.polling = false
    }
  }
}
