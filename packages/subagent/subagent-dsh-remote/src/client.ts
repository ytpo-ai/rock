/**
 * Minimal Typert unary client for the `dsh web` Remote API: token→cookie
 * connection, the `client-request`/`server-response` envelope, the four
 * session calls the provider drives, and assistant-output extraction from the
 * `session/wait` journal. Every response is parsed and validated here — the
 * HTTP JSON wire is where a malformed or unexpected payload is rejected.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-remote/client
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { abortError, DshRemoteRunFailure } from './failure.ts'
import type {
  DshRemoteFailureStage,
  DshWireRecord,
  SessionCancelArgs,
  SessionCancelValue,
  SessionCreateArgs,
  SessionCreateValue,
  SessionPromptArgs,
  SessionPromptValue,
  SessionWaitArgs,
  SessionWaitValue,
} from './types.ts'

type JsonObject = Record<string, unknown>

/** Fixed interaction posture: this provider never answers interactive input. */
const INTERACTIONS = 'none'

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`subagent-dsh-remote: server returned an invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`subagent-dsh-remote: server returned an invalid ${label}`)
  }
  return value
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`subagent-dsh-remote: server returned an invalid ${label}`)
  }
  return value
}

interface ConnectionRpcOk {
  readonly ok: true
  readonly value: unknown
}

interface ConnectionRpcFailure {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly details: unknown }
}

type ConnectionRpcResult = ConnectionRpcOk | ConnectionRpcFailure

/** Parse and validate one `server-response` envelope against the sent rpcId. */
function parseServerResponse(value: unknown, rpcId: string, stage: DshRemoteFailureStage): ConnectionRpcResult {
  const envelope = object(value, 'server-response envelope')
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
    throw new DshRemoteRunFailure({ stage, category: 'invalid-result' })
  }
  const result = object(envelope.result, 'server-response result')
  if (result.ok === true) return { ok: true, value: result.value }
  if (result.ok === false) {
    const error = object(result.error, 'server-response error')
    const code = typeof error.code === 'string' && error.code.length > 0 ? error.code : undefined
    const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : undefined
    const details = object(error.details, 'server-response error details')
    if (code === undefined || message === undefined) {
      throw new DshRemoteRunFailure({ stage, category: 'invalid-result' })
    }
    return { ok: false, error: { code, message, details } }
  }
  throw new DshRemoteRunFailure({ stage, category: 'invalid-result' })
}

function parseCreateValue(value: unknown): SessionCreateValue {
  const obj = object(value, 'session/create value')
  const sessionId = string(obj.sessionId, 'session/create session id')
  const agentPreset = typeof obj.agentPreset === 'string' ? obj.agentPreset : undefined
  return { sessionId, ...(agentPreset === undefined ? {} : { agentPreset }) }
}

function parseAcceptedValue(value: unknown, stage: DshRemoteFailureStage): { readonly accepted: true } {
  if (object(value, 'accepted value').accepted !== true) {
    throw new DshRemoteRunFailure({ stage, category: 'invalid-result' })
  }
  return { accepted: true }
}

function parseWireRecord(value: unknown): DshWireRecord {
  const record = object(value, 'history record')
  if (record.type !== 'event') {
    throw new TypeError('subagent-dsh-remote: server returned an invalid history record')
  }
  const event = object(record.event, 'history event')
  const type = string(event.type, 'history event type')
  const seq = typeof event.seq === 'number' ? event.seq : NaN
  const time = typeof event.time === 'number' ? event.time : NaN
  return { type: 'event', event: { type, seq, time, data: event.data } }
}

function parseWaitValue(value: unknown, stage: DshRemoteFailureStage): SessionWaitValue {
  const obj = object(value, 'session/wait value')
  const reason = obj.reason
  if (reason !== 'idle' && reason !== 'input-required' && reason !== 'timeout') {
    throw new DshRemoteRunFailure({ stage, category: 'invalid-result' })
  }
  const output = object(obj.output, 'session/wait output')
  const records = array(output.records, 'session/wait records').map(entry => parseWireRecord(entry))
  const truncated = output.truncated === true
  return { reason, output: { records, truncated } }
}

/**
 * Connect to a running `dsh web` Host and return its signed API cookie value.
 * @param baseUrl - Host base URL without a trailing slash.
 * @param token - the Host's launch token (printed in its startup URL).
 * @param fetchFn - injectable fetch for tests.
 * @returns the `name=value` cookie to send on subsequent requests.
 */
export async function connectRemote(
  baseUrl: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchFn(
      `${baseUrl}/connect?token=${encodeURIComponent(token)}&interactions=${INTERACTIONS}`,
      { redirect: 'manual' },
    )
  } catch (error) {
    throw new DshRemoteRunFailure({ stage: 'connect', category: 'transport' }, error)
  }
  if (response.status !== 302) {
    throw new DshRemoteRunFailure({ stage: 'connect', category: 'auth', httpStatus: response.status })
  }
  const cookie = response.headers.getSetCookie()[0]
  if (cookie === undefined || !cookie.includes('=')) {
    throw new DshRemoteRunFailure({ stage: 'connect', category: 'invalid-result' })
  }
  return cookie.split(';', 1)[0] as string
}

/** One connection to a running `dsh web` Host over the Typert unary protocol. */
export class DshRemoteClient {
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly baseUrl: string,
    private readonly cookie: string,
    fetchFn: typeof fetch,
  ) {
    this.fetchFn = fetchFn
  }

  /** Create one session and return its id. */
  async createSession(args: SessionCreateArgs, signal: AbortSignal): Promise<SessionCreateValue> {
    const value = await this.call('session/create', { request: args }, 'session-create', signal)
    return parseCreateValue(value)
  }

  /** Dispatch one prompt into the session. */
  async prompt(args: SessionPromptArgs, signal: AbortSignal): Promise<SessionPromptValue> {
    const value = await this.call('session/prompt', { request: args }, 'prompt', signal)
    return parseAcceptedValue(value, 'prompt')
  }

  /** Block until the session reaches a stopping state or the deadline. */
  async wait(args: SessionWaitArgs, signal: AbortSignal): Promise<SessionWaitValue> {
    const value = await this.call('session/wait', { request: args }, 'wait', signal)
    return parseWaitValue(value, 'wait')
  }

  /** Best-effort cancel the active turn without destroying the session. */
  async cancel(args: SessionCancelArgs, signal?: AbortSignal): Promise<SessionCancelValue> {
    const value = await this.call('session/cancel', { request: args }, 'cancel', signal)
    return parseAcceptedValue(value, 'cancel')
  }

  private async call(
    endpoint: string,
    args: unknown,
    stage: DshRemoteFailureStage,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const rpcId = randomUUID()
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { cookie: this.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw abortError(signal)
      throw new DshRemoteRunFailure({ stage, category: 'transport' }, error)
    }
    if (response.status === 401 || response.status === 403) {
      throw new DshRemoteRunFailure({ stage, category: 'auth', httpStatus: response.status })
    }
    if (!response.ok) {
      throw new DshRemoteRunFailure({ stage, category: 'transport', httpStatus: response.status })
    }
    let envelope: unknown
    try {
      envelope = await response.json()
    } catch (error) {
      throw new DshRemoteRunFailure({ stage, category: 'invalid-result' }, error)
    }
    const result = parseServerResponse(envelope, rpcId, stage)
    if (result.ok) return result.value
    return Promise.reject(new DshRemoteRunFailure({
      stage,
      category: 'gateway',
      remoteCode: result.error.code,
    }))
  }
}

/**
 * Select the child's final answer from a `session/wait` result: the text parts
 * of the newest non-empty committed `assistant/message` event.
 * @param wait - the settled wait value.
 * @returns the selected output, or `[]` when no assistant text exists.
 */
export function extractAssistantOutput(wait: SessionWaitValue): ContentBlock[] {
  for (const record of wait.output.records) {
    if (record.event.type !== 'assistant/message') continue
    const text = assistantText(record.event.data)
    if (text.length > 0) return [{ type: 'text', text }]
  }
  return []
}

/** Extract newline-joined text blocks from one `assistant/message` event data. */
function assistantText(data: unknown): string {
  const obj = object(data, 'assistant event data')
  const message = object(obj.message, 'assistant message')
  const content = array(message.content, 'assistant content')
  const texts: string[] = []
  for (const block of content) {
    const part = object(block, 'assistant content part')
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
      texts.push(part.text)
    }
  }
  return texts.join('\n')
}
