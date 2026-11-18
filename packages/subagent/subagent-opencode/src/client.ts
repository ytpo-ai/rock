/**
 * OpenCode v2 REST client: discovery-file reading, Basic authorization, and
 * the minimal session/prompt/message/interrupt calls the provider drives.
 * Every response is parsed and validated here — the HTTP JSON wire is where a
 * malformed or unexpected payload is rejected instead of trusted.
 *
 * @module @deepseek-ai/dsh-subagent-opencode/client
 */

import { readFileSync } from 'node:fs'
import { abortError, OpencodeRunFailure } from './failure.ts'
import type {
  OpencodeContentPart,
  OpencodeFinish,
  OpencodeMessage,
  OpencodeMessageError,
  OpencodeOutcome,
  OpencodeServiceInfo,
  OpencodeSession,
  OpencodeSessionCreate,
} from './types.ts'

type JsonObject = Record<string, unknown>

/** The `GET /api/session/{id}/message` response envelope. */
interface MessageListResponse {
  readonly data: readonly OpencodeMessage[]
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`subagent-opencode: server returned an invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`subagent-opencode: server returned an invalid ${label}`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`subagent-opencode: server returned an invalid ${label}`)
  }
  return value
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`subagent-opencode: server returned an invalid ${label}`)
  }
  return value
}

function parseFinish(value: unknown): OpencodeFinish {
  if (
    value === 'stop'
    || value === 'length'
    || value === 'tool-calls'
    || value === 'content-filter'
    || value === 'error'
  ) {
    return value
  }
  return 'unknown'
}

function parseOutcome(value: unknown): OpencodeOutcome {
  if (value === 'succeeded' || value === 'failed' || value === 'interrupted') {
    return value
  }
  throw new TypeError('subagent-opencode: server returned an invalid idle outcome')
}

function parseError(value: unknown): OpencodeMessageError {
  const obj = object(value, 'message error')
  const type = obj.type === undefined ? undefined : (typeof obj.type === 'string' ? obj.type : undefined)
  const status = obj.status === undefined
    ? undefined
    : (typeof obj.status === 'number' && Number.isInteger(obj.status) && obj.status >= 100 && obj.status <= 599
      ? obj.status
      : undefined)
  return { ...(type === undefined ? {} : { type }), ...(status === undefined ? {} : { status }) }
}

function parseContentPart(value: unknown): OpencodeContentPart {
  const obj = object(value, 'assistant content part')
  const type = string(obj.type, 'content part type')
  if (type !== 'text' && type !== 'reasoning' && type !== 'tool') {
    throw new TypeError(`subagent-opencode: server returned an unknown content part type ${JSON.stringify(type)}`)
  }
  const text = typeof obj.text === 'string' ? obj.text : undefined
  return { type, ...(text === undefined ? {} : { text }) }
}

function parseMessage(value: unknown): OpencodeMessage {
  const obj = object(value, 'message')
  const type = string(obj.type, 'message type')
  const id = string(obj.id, 'message id')
  const created = finiteNumber(object(obj.time, 'message time').created, 'message time created')
  if (type === 'assistant') {
    const content = array(obj.content, 'assistant content').map(part => parseContentPart(part))
    const finish = obj.finish === undefined || obj.finish === null ? undefined : parseFinish(obj.finish)
    return { type: 'assistant', id, time: { created }, content, ...(finish === undefined ? {} : { finish }) }
  }
  if (type === 'idle') {
    const outcome = parseOutcome(obj.outcome)
    const error = obj.error === undefined || obj.error === null ? undefined : parseError(obj.error)
    return { type: 'idle', id, time: { created }, outcome, ...(error === undefined ? {} : { error }) }
  }
  return { type: 'other', id, time: { created } }
}

function parseMessageList(value: unknown): MessageListResponse {
  const envelope = object(value, 'message list response')
  return { data: array(envelope.data, 'message list data').map(entry => parseMessage(entry)) }
}

function parseSession(value: unknown): OpencodeSession {
  const envelope = object(value, 'session response')
  const data = object(envelope.data, 'session data')
  return { id: string(data.id, 'session id') }
}

/** Client options for {@link OpencodeClient}. */
export interface OpencodeClientOptions {
  /** Injectable `fetch` for tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch
}

/** Read and validate the OpenCode discovery file into a service record. */
export function readServiceFile(servicePath: string): OpencodeServiceInfo {
  let raw: string
  try {
    raw = readFileSync(servicePath, 'utf8')
  } catch (error) {
    throw new TypeError(`subagent-opencode: cannot read the OpenCode service file at ${servicePath}`, { cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new TypeError(`subagent-opencode: the OpenCode service file at ${servicePath} is not valid JSON`, { cause: error })
  }
  const obj = object(parsed, 'service file')
  const url = typeof obj.url === 'string' && obj.url.length > 0 ? obj.url : undefined
  const password = typeof obj.password === 'string' && obj.password.length > 0 ? obj.password : undefined
  if (url === undefined || password === undefined) {
    throw new TypeError(`subagent-opencode: the OpenCode service file at ${servicePath} is missing url or password`)
  }
  return { url, password }
}

/** Build the Basic authorization header value for the OpenCode server. */
export function basicAuthorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`
}

/**
 * One connection to a local OpenCode server. Each provider run creates its own
 * client; the underlying server is never spawned or stopped by this package.
 */
export class OpencodeClient {
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly baseUrl: string,
    private readonly authorization: string,
    options: OpencodeClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch
  }

  /**
   * Create one session and return its id.
   * @param body - the session create request.
   * @param signal - unpublished-start cancellation.
   * @returns the created session identity.
   */
  async createSession(body: OpencodeSessionCreate, signal: AbortSignal): Promise<OpencodeSession> {
    const response = await this.request('POST', '/api/session', body, 'session-create', signal)
    return parseSession(response)
  }

  /**
   * Dispatch one text-only prompt into the session.
   * @param sessionId - the created session id.
   * @param text - the task text.
   * @param signal - unpublished-start cancellation.
   */
  async prompt(sessionId: string, text: string, signal: AbortSignal): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/prompt`, { text }, 'prompt', signal)
  }

  /**
   * Read the session's durable messages.
   * @param sessionId - the created session id.
   * @param signal - run cancellation.
   * @returns the parsed, validated message records.
   */
  async listMessages(sessionId: string, signal: AbortSignal): Promise<readonly OpencodeMessage[]> {
    const response = await this.request('GET', `/api/session/${sessionId}/message`, undefined, 'poll', signal)
    return parseMessageList(response).data
  }

  /**
   * Best-effort interrupt the active execution. No signal is forwarded so an
   * already-aborted run can still request cancellation.
   * @param sessionId - the created session id.
   */
  async interrupt(sessionId: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/interrupt`, undefined, 'poll')
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    stage: 'session-create' | 'prompt' | 'poll',
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authorization,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw abortError(signal)
      throw new OpencodeRunFailure({ stage, category: 'transport' }, error)
    }
    if (response.status === 401 || response.status === 403) {
      throw new OpencodeRunFailure({ stage, category: 'auth', httpStatus: response.status })
    }
    if (!response.ok) {
      throw new OpencodeRunFailure({ stage, category: 'product', httpStatus: response.status })
    }
    try {
      return await response.json()
    } catch (error) {
      throw new OpencodeRunFailure({ stage, category: 'invalid-result' }, error)
    }
  }
}
