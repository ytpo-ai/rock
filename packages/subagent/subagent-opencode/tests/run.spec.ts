/**
 * Unit and lifecycle tests for the OpenCode run driver: task validation,
 * output selection, stop-reason mapping, and the full create/prompt/poll
 * lifecycle driven against a scripted fetch (no live server or model).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { externalTestParent } from '../../subagent/tests/external-activation-helpers.ts'
import { OpencodeClient } from '../src/client.ts'
import { collectOutput, startOpencodeRun, textTask, type OpencodeRunSpec } from '../src/run.ts'
import type { OpencodeFinish, OpencodeMessage } from '../src/types.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function scriptedFetch(handler: (url: string) => Response): typeof fetch {
  return async (input: string | URL | Request) => {
    if (typeof input === 'string') return handler(input)
    if (input instanceof URL) return handler(input.href)
    return handler(input.url)
  }
}

function assistantMessage(id: string, created: number, text: string, finish?: OpencodeFinish): OpencodeMessage {
  return { type: 'assistant', id, time: { created }, content: [{ type: 'text', text }], ...(finish === undefined ? {} : { finish }) }
}

function idleMessage(created: number, outcome: 'succeeded' | 'failed' | 'interrupted'): OpencodeMessage {
  return { type: 'idle', id: `msg_idle_${created}`, time: { created }, outcome }
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

describe('collectOutput', () => {
  it('selects the last non-empty assistant text', () => {
    const messages: OpencodeMessage[] = [
      assistantMessage('a', 1, 'first'),
      assistantMessage('b', 2, 'final'),
    ]
    expect(collectOutput(messages)).toEqual([{ type: 'text', text: 'final' }])
  })

  it('skips empty assistant messages', () => {
    const messages: OpencodeMessage[] = [
      assistantMessage('a', 1, ''),
      assistantMessage('b', 2, 'answer'),
    ]
    expect(collectOutput(messages)).toEqual([{ type: 'text', text: 'answer' }])
  })

  it('returns [] when no assistant text exists', () => {
    expect(collectOutput([{ type: 'other', id: 'u', time: { created: 1 } }])).toEqual([])
  })
})

async function startWithFetch(fetchFn: typeof fetch, signal: AbortSignal): Promise<ReturnType<typeof startOpencodeRun>> {
  const ctx = new Context()
  const parent: Agent = await externalTestParent(ctx, '/tmp/opencode-workspace')
  const request: SubagentStartRequest = {
    parent,
    prompt: [{ type: 'text', text: 'do the thing' }],
    signal,
  }
  const spec: OpencodeRunSpec = {
    client: new OpencodeClient('http://127.0.0.1:49374', 'Basic dG9rZW4=', { fetchFn }),
    cwd: '/tmp/opencode-workspace',
    pollIntervalMs: 5,
  }
  return startOpencodeRun(request, spec)
}

describe('startOpencodeRun', () => {
  it('resolves completed output from the idle outcome', async () => {
    let polls = 0
    const fetchFn = scriptedFetch((url) => {
      if (url.endsWith('/api/session')) return jsonResponse(200, { data: { id: 'ses_x' } })
      if (url.includes('/prompt')) return jsonResponse(200, { data: { id: 'msg_u' } })
      if (url.includes('/message')) {
        polls += 1
        return polls === 1
          ? jsonResponse(200, { data: [{ type: 'user', id: 'msg_u', time: { created: 1 } }] })
          : jsonResponse(200, {
            data: [
              { type: 'user', id: 'msg_u', time: { created: 1 } },
              assistantMessage('msg_a', 2, 'OK', 'stop'),
              idleMessage(3, 'succeeded'),
            ],
          })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const run = await startWithFetch(fetchFn, new AbortController().signal)
    await expect(run.result).resolves.toEqual({ output: [{ type: 'text', text: 'OK' }], stopReason: 'completed' })
  })

  it('maps a failed idle outcome to an error result with a safe diagnostic', async () => {
    const fetchFn = scriptedFetch((url) => {
      if (url.endsWith('/api/session')) return jsonResponse(200, { data: { id: 'ses_x' } })
      if (url.includes('/prompt')) return jsonResponse(200, { data: { id: 'msg_u' } })
      if (url.includes('/message')) {
        return jsonResponse(200, {
          data: [
            { type: 'user', id: 'msg_u', time: { created: 1 } },
            assistantMessage('msg_a', 2, 'partial'),
            { type: 'idle', id: 'msg_i', time: { created: 3 }, outcome: 'failed', error: { type: 'provider.quota', status: 429 } },
          ],
        })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const run = await startWithFetch(fetchFn, new AbortController().signal)
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([{ type: 'text', text: 'partial' }])
    expect(result.diagnostic).toContain('category: limit')
    expect(result.diagnostic).toContain('HTTP status: 429')
    expect(result.diagnostic).not.toContain('quota')
  })

  it('maps a length finish to max-tokens', async () => {
    const fetchFn = scriptedFetch((url) => {
      if (url.endsWith('/api/session')) return jsonResponse(200, { data: { id: 'ses_x' } })
      if (url.includes('/prompt')) return jsonResponse(200, { data: { id: 'msg_u' } })
      if (url.includes('/message')) {
        return jsonResponse(200, {
          data: [
            { type: 'user', id: 'msg_u', time: { created: 1 } },
            assistantMessage('msg_a', 2, 'cut off', 'length'),
            idleMessage(3, 'succeeded'),
          ],
        })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const run = await startWithFetch(fetchFn, new AbortController().signal)
    await expect(run.result).resolves.toEqual({ output: [{ type: 'text', text: 'cut off' }], stopReason: 'max-tokens' })
  })

  it('settles as aborted on cancellation', async () => {
    const controller = new AbortController()
    const fetchFn = scriptedFetch((url) => {
      if (url.endsWith('/api/session')) return jsonResponse(200, { data: { id: 'ses_x' } })
      if (url.includes('/prompt')) return jsonResponse(200, { data: { id: 'msg_u' } })
      if (url.includes('/message')) {
        return jsonResponse(200, { data: [{ type: 'user', id: 'msg_u', time: { created: 1 } }] })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const run = await startWithFetch(fetchFn, controller.signal)
    controller.abort()
    await expect(run.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
  })
})
