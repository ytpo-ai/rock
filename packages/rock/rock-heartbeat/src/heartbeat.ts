/**
 * Rock ConnectorClient heartbeat core: periodically resolves the connector
 * identity and POSTs a liveness beat to the Seagull ConnectorGateway.
 *
 * @module @rock/rock-heartbeat/heartbeat
 */

/** Resolved identity used to send one heartbeat. */
export interface HeartbeatTarget {
  baseUrl: string
  key: string
}

/** Constructor options owned by the plugin's `apply`. */
export interface HeartbeatOptions {
  /** Interval between beats in milliseconds. */
  intervalMs: number
  /** Resolves the current connector identity; null disables the beat. */
  resolve: () => HeartbeatTarget | null
  /** Fetch-like transport, injectable for tests. */
  post?: (url: string, key: string) => Promise<void>
}

/** Send one beat; a null identity silently skips. */
export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly options: HeartbeatOptions) {}

  /** POST one heartbeat to the gateway; best-effort (throws are caught by the interval). */
  async beat(): Promise<void> {
    const target = this.options.resolve()
    if (target === null) return
    const post = this.options.post ?? defaultPost
    await post(heartbeatUrl(target.baseUrl), target.key)
  }

  /** Begin periodic beating; sends one beat immediately. */
  start(): void {
    if (this.timer !== undefined) return
    void this.beat()
    this.timer = setInterval(() => { void this.beat() }, this.options.intervalMs)
    this.timer.unref?.()
  }

  /** Stop periodic beating. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }
}

/** The heartbeat endpoint for a Seagull base URL. */
function heartbeatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/connectors/heartbeat`
}

/** Default transport: POST an empty beat with the connector key bearer. */
async function defaultPost(url: string, key: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`heartbeat failed: ${response.status}`)
}
