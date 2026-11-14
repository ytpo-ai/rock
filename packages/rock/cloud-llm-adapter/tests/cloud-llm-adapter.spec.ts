import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { CloudLlmAdapter } from '../src/adapter.ts'

/** Build an OpenAI-style SSE body whose chunks carry the given deltas. */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function adapter(): CloudLlmAdapter {
  return new CloudLlmAdapter({ baseUrl: 'http://cloud.test', apiKey: 'sk-agent-test', defaultModel: 'seagull-relay' })
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'seagull-cloud',
    model: 'seagull-relay',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], id: 'm1' as never, source: { kind: 'user' } }],
    ...overrides,
  } as GenerateOptions
}

describe('CloudLlmAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams text, usage, and a stop finish from an OpenAI SSE response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
      'data: [DONE]',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const chunks = []
    for await (const chunk of adapter().stream(options())) chunks.push(chunk)

    expect(chunks.find(c => c.type === 'block-start')).toMatchObject({ type: 'block-start', blockType: 'text' })
    expect(chunks.filter(c => c.type === 'text-delta').map(c => (c as { text: string }).text).join('')).toBe('Hello world')
    expect(chunks.find(c => c.type === 'usage')).toMatchObject({ type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })

    // The request body routes to the cloud Proxy with the agent key as Bearer.
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('seagull-relay')
    expect(body.stream).toBe(true)
    expect(String(init.headers.get('authorization'))).toBe('Bearer sk-agent-test')
  })

  it('maps a length finish to max-tokens and carries tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}',
    ])))

    const chunks = []
    for await (const chunk of adapter().stream(options())) chunks.push(chunk)

    const toolEnd = chunks.find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    expect(toolEnd).toBeDefined()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'max-tokens' } })
  })
})
