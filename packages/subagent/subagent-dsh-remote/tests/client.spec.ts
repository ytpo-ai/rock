/**
 * Unit tests for the Typert unary client: token→cookie connection, envelope
 * validation, and assistant-output extraction.
 */

import { describe, expect, it } from 'vitest'
import { connectRemote, DshRemoteClient, extractAssistantOutput } from '../src/client.ts'
import type { SessionWaitValue } from '../src/types.ts'

function cookieResponse(): Response {
  return new Response('', {
    status: 302,
    headers: { 'set-cookie': 'dsh-auth-abc=v2.payload.sig; HttpOnly; SameSite=Strict' },
  })
}

interface EnvelopeRequest {
  readonly rpcId: string
  readonly args: unknown
}

function parseEnvelopeRequest(value: unknown): EnvelopeRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('invalid request body')
  const obj = value as Record<string, unknown>
  const rpcId = typeof obj.rpcId === 'string' ? obj.rpcId : ''
  const payload = typeof obj.payload === 'object' && obj.payload !== null
    ? obj.payload as Record<string, unknown>
    : {}
  return { rpcId, args: payload.args }
}

function envelopeFetch(handler: (endpoint: string, args: unknown) => unknown): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const endpoint = url.slice(url.indexOf('/api/') + 5)
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    const request = parseEnvelopeRequest(JSON.parse(bodyText) as unknown)
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: request.rpcId,
      result: { ok: true, value: handler(endpoint, request.args) },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

describe('connectRemote', () => {
  it('returns the cookie value from the connect response', async () => {
    const fetchFn: typeof fetch = async () => cookieResponse()
    await expect(connectRemote('http://127.0.0.1:3080', 'token', fetchFn))
      .resolves.toBe('dsh-auth-abc=v2.payload.sig')
  })

  it('classifies a non-302 connect as an auth failure', async () => {
    const fetchFn: typeof fetch = async () => new Response('', { status: 401 })
    await expect(connectRemote('http://127.0.0.1:3080', 'token', fetchFn))
      .rejects.toMatchObject({ name: 'DshRemoteRunFailure', facts: { stage: 'connect', category: 'auth', httpStatus: 401 } })
  })
})

describe('DshRemoteClient', () => {
  const signal = new AbortController().signal

  it('createSession returns the created id', async () => {
    const fetchFn = envelopeFetch(() => ({ sessionId: 'ses_x' }))
    const client = new DshRemoteClient('http://127.0.0.1:3080', 'cookie', fetchFn)
    await expect(client.createSession({ cwd: '/tmp' }, signal)).resolves.toEqual({ sessionId: 'ses_x' })
  })

  it('wraps method args in the request field the Host descriptor expects', async () => {
    let seen: unknown
    const fetchFn = envelopeFetch((_endpoint, args) => {
      seen = args
      return { sessionId: 'ses_x' }
    })
    const client = new DshRemoteClient('http://127.0.0.1:3080', 'cookie', fetchFn)
    await client.createSession({ cwd: '/tmp' }, signal)
    expect(seen).toEqual({ request: { cwd: '/tmp' } })
  })

  it('wait returns the parsed stopping state', async () => {
    const fetchFn = envelopeFetch(() => ({ reason: 'idle', output: { records: [], truncated: false } }))
    const client = new DshRemoteClient('http://127.0.0.1:3080', 'cookie', fetchFn)
    await expect(client.wait({ sessionId: 'ses_x', timeoutMs: 100 }, signal))
      .resolves.toEqual({ reason: 'idle', output: { records: [], truncated: false } })
  })
})

describe('extractAssistantOutput', () => {
  it('extracts text from the newest non-empty assistant message', () => {
    const wait: SessionWaitValue = {
      reason: 'idle',
      output: {
        truncated: false,
        records: [
          { type: 'event', event: { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: 'done' }] } } } },
          { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: {} } },
        ],
      },
    }
    expect(extractAssistantOutput(wait)).toEqual([{ type: 'text', text: 'done' }])
  })

  it('returns [] when no assistant text exists', () => {
    const wait: SessionWaitValue = {
      reason: 'idle',
      output: { truncated: false, records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: {} } }] },
    }
    expect(extractAssistantOutput(wait)).toEqual([])
  })
})
