/**
 * OpenAI-compatible loopback relay for Rock ConnectorClient. External tools
 * (Codex/Pi) point their base_url at `/v1/bots/{agentBotId}`, so the relay can
 * resolve the agent bot from the path, stamp the forwarded request with Rock
 * provenance (D-034), and stream the cloud LLM Proxy response back.
 *
 * @module @rock/rock-llm-relay/relay
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { PROVENANCE_HEADERS, type RelayRoute, type RockLlmRelayOptions } from './types.ts'

/** Parses `/v1/bots/{agentBotId}{pathSuffix}` into its route parts. */
export function parseRelayRoute(pathname: string): RelayRoute | undefined {
  const match = /^\/v1\/bots\/([^/]+)(\/.*)?$/.exec(pathname)
  if (match === null || match[1] === undefined) return undefined
  return { agentBotId: decodeURIComponent(match[1]), pathSuffix: match[2] ?? '/chat/completions' }
}

/** Wire protocol inferred from a relay path suffix. */
const WIRE_PROTOCOL_BY_PATH_SUFFIX: Readonly<Record<string, string>> = {
  '/messages': 'anthropic-messages',
  '/responses': 'openai-responses',
  '/chat/completions': 'chat-completions',
}

/** Resolve the wire protocol from a path suffix, or `undefined` when unknown. */
function wireProtocolOf(pathSuffix: string): string | undefined {
  return WIRE_PROTOCOL_BY_PATH_SUFFIX[pathSuffix]
}

/** Loopback LLM relay: forwards external-tool calls to the cloud Proxy. */
export class RockLlmRelay {
  private server: Server | undefined

  constructor(private readonly options: RockLlmRelayOptions) {}

  /** Start listening and resolve with the bound port. */
  async start(): Promise<number> {
    const server = createServer((req, res) => { void this.handle(req, res) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject)
      server.listen(this.options.port, this.options.host, () => { resolve() })
    })
    const address = server.address()
    return typeof address === 'object' && address !== null ? address.port : this.options.port
  }

  /** Stop listening and wait for the server to close. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server
      if (server === undefined) {
        resolve()
        return
      }
      this.server = undefined
      server.close(() => { resolve() })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.writeJson(res, 405, { error: { message: 'method not allowed' } })
      return
    }
    if (!this.authorized(req)) {
      this.writeJson(res, 401, { error: { message: 'invalid api key', type: 'invalid_request_error', code: 'invalid_api_key' } })
      return
    }
    const route = parseRelayRoute(req.url ?? '')
    if (route === undefined) {
      this.writeJson(res, 404, { error: { message: 'not found' } })
      return
    }
    const startedAt = new Date().toISOString()
    try {
      const info = relayModelInfo(await this.readBody(req))
      const sessionIds = this.sessionIds(req, info.sessionId)
      let upstream: Response
      try {
        upstream = await this.forward(route, info.mappedBody)
      } catch (error) {
        this.record(route, info, sessionIds, startedAt, undefined, diagnosticOf(error))
        this.writeJson(res, 502, { error: { message: diagnosticOf(error) } })
        return
      }
      this.record(route, info, sessionIds, startedAt, upstream.status)
      await this.pipeResponse(res, upstream)
    } catch (error) {
      this.writeJson(res, 502, { error: { message: diagnosticOf(error) } })
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { raw += chunk })
      req.on('end', () => { resolve(raw) })
      req.on('error', reject)
    })
  }

  /** Whether the inbound request presents the loopback bearer key. */
  private authorized(req: IncomingMessage): boolean {
    return req.headers.authorization === `Bearer ${this.options.localKey}`
  }

  private async forward(route: RelayRoute, mappedBody: string): Promise<Response> {
    const url = `${this.options.cloudBaseUrl.replace(/\/$/, '')}/v1/bots/${route.agentBotId}${route.pathSuffix}`
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    headers.set(PROVENANCE_HEADERS.agentBotId, route.agentBotId)
    headers.set(PROVENANCE_HEADERS.connectorClientId, this.options.connectorClientId)
    headers.set(PROVENANCE_HEADERS.relayed, 'true')
    const employeeId = this.options.resolveEmployeeId(route.agentBotId)
    if (employeeId !== undefined) headers.set(PROVENANCE_HEADERS.employeeId, employeeId)
    const connectorKey = this.options.resolveConnectorKey?.()
    if (connectorKey !== undefined && connectorKey !== '') headers.set('authorization', `Bearer ${connectorKey}`)

    const doForward = this.options.forward ?? ((target: string, init: RequestInit) => fetch(target, init))
    return doForward(url, { method: 'POST', headers, body: mappedBody })
  }

  /** Extract the two session ids the inbound request may carry, opportunistically. */
  private sessionIds(req: IncomingMessage, bodySessionId?: string): SessionIds {
    const header = (name: string): string | undefined => {
      const value = req.headers[name]
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    }
    const rockSessionId = header('x-dsh-session-id') ?? bodySessionId
    const toolSessionId = header('x-session-id') ?? header('x-conversation-id')
    return {
      ...(rockSessionId === undefined ? {} : { rockSessionId }),
      ...(toolSessionId === undefined ? {} : { toolSessionId }),
    }
  }

  /** Emit one forwarding attempt through the plugin's `onForward` hook, if present. */
  private record(
    route: RelayRoute,
    info: RelayModelInfo,
    sessionIds: SessionIds,
    startedAt: string,
    status?: number,
    error?: string,
  ): void {
    const wireProtocol = wireProtocolOf(route.pathSuffix)
    this.options.onForward?.({
      timestamp: new Date().toISOString(),
      startedAt,
      durationMs: Date.now() - Date.parse(startedAt),
      agentBotId: route.agentBotId,
      pathSuffix: route.pathSuffix,
      ...(wireProtocol === undefined ? {} : { wireProtocol }),
      ...(sessionIds.rockSessionId === undefined ? {} : { rockSessionId: sessionIds.rockSessionId }),
      ...(sessionIds.toolSessionId === undefined ? {} : { toolSessionId: sessionIds.toolSessionId }),
      ...(info.requestModel === undefined ? {} : { requestModel: info.requestModel }),
      mappedModel: RELAY_MODEL,
      ...(status === undefined ? {} : { status }),
      ...(error === undefined ? {} : { error }),
    })
  }

  private async pipeResponse(res: ServerResponse, upstream: Response): Promise<void> {
    res.statusCode = upstream.status
    const contentType = upstream.headers.get('content-type')
    if (contentType !== null) res.setHeader('content-type', contentType)
    res.flushHeaders()
    if (upstream.body === null) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    } finally {
      reader.releaseLock()
    }
  }

  private writeJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.end()
      return
    }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function diagnosticOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** The placeholder model id the relay stamps so Seagull routes by bot binding, not the caller's model. */
const RELAY_MODEL = 'seagull-relay'

/** Parsed inbound body: the original fields the relay logs plus the body it forwards. */
interface RelayModelInfo {
  requestModel?: string
  sessionId?: string
  mappedBody: string
}

/** Opportunistically extracted session ids from an inbound request. */
interface SessionIds {
  rockSessionId?: string
  toolSessionId?: string
}

/** Parse the body, capture the original `model`/`sessionId`, and stamp `model` with {@link RELAY_MODEL}. */
function relayModelInfo(body: string): RelayModelInfo {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { mappedBody: body }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { mappedBody: body }
  const record = parsed as Record<string, unknown>
  const requestModel = typeof record.model === 'string' ? record.model : undefined
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
  record.model = RELAY_MODEL
  return {
    ...(requestModel === undefined ? {} : { requestModel }),
    ...(sessionId === undefined ? {} : { sessionId }),
    mappedBody: JSON.stringify(parsed),
  }
}
