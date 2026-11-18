/**
 * Unit and lifecycle tests for the DSH Remote run driver: task validation and
 * the full create/prompt/wait lifecycle driven against a scripted fetch (no
 * live Host or model).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { externalTestParent } from '../../subagent/tests/external-activation-helpers.ts'
import { DshRemoteClient } from '../src/client.ts'
import { startDshRemoteRun, textTask, type DshRemoteRunSpec } from '../src/run.ts'

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

function assistantRecord(text: string): unknown {
  return { type: 'event', event: { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text }] } } } }
}

describe('textTask', () => {
  it('accepts text-only non-empty prompts', () => {
    expect(textTask([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toEqual(['a', 'b'])
  })

  it('rejects an empty prompt', () => {
    expect(() => textTask([])).toThrow(/only text blocks/)
  })

  it('rejects non-text blocks', () => {
    expect(() => textTask([{ type: 'text', text: 'a' }, { type: 'tool-removal', toolName: 'x' }]))
      .toThrow(/only text blocks/)
  })

  it('rejects all-blank text', () => {
    expect(() => textTask([{ type: 'text', text: '  ' }])).toThrow(/must not be empty/)
  })
})

async function startWithFetch(fetchFn: typeof fetch, signal: AbortSignal): Promise<ReturnType<typeof startDshRemoteRun>> {
  const ctx = new Context()
  const parent: Agent = await externalTestParent(ctx, '/tmp/dsh-remote-workspace')
  const request: SubagentStartRequest = {
    parent,
    prompt: [{ type: 'text', text: 'do the thing' }],
    signal,
  }
  const spec: DshRemoteRunSpec = {
    client: new DshRemoteClient('http://127.0.0.1:3080', 'cookie', fetchFn),
    cwd: '/tmp/dsh-remote-workspace',
    waitTimeoutMs: 5,
  }
  return startDshRemoteRun(request, spec)
}

describe('startDshRemoteRun', () => {
  it('resolves completed output from the idle wait', async () => {
    let waits = 0
    const fetchFn = envelopeFetch((endpoint) => {
      if (endpoint === 'session/create') return { sessionId: 'ses_x' }
      if (endpoint === 'session/prompt') return { accepted: true }
      if (endpoint === 'session/wait') {
        waits += 1
        return waits === 1
          ? { reason: 'timeout', output: { records: [], truncated: false } }
          : { reason: 'idle', output: { records: [assistantRecord('OK')], truncated: false } }
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    const run = await startWithFetch(fetchFn, new AbortController().signal)
    await expect(run.result).resolves.toEqual({ output: [{ type: 'text', text: 'OK' }], stopReason: 'completed' })
  })

  it('maps an input-required wait to an error result', async () => {
    const fetchFn = envelopeFetch((endpoint) => {
      if (endpoint === 'session/create') return { sessionId: 'ses_x' }
      if (endpoint === 'session/prompt') return { accepted: true }
      if (endpoint === 'session/wait') {
        return { reason: 'input-required', output: { records: [assistantRecord('partial')], truncated: false } }
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    const run = await startWithFetch(fetchFn, new AbortController().signal)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([{ type: 'text', text: 'partial' }])
    expect(result.diagnostic).toContain('category: gateway')
  })

  it('settles as aborted on cancellation', async () => {
    const controller = new AbortController()
    const fetchFn = envelopeFetch((endpoint) => {
      if (endpoint === 'session/create') return { sessionId: 'ses_x' }
      if (endpoint === 'session/prompt') return { accepted: true }
      if (endpoint === 'session/wait') return { reason: 'timeout', output: { records: [], truncated: false } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    const run = await startWithFetch(fetchFn, controller.signal)
    controller.abort()
    await expect(run.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
  })
})
