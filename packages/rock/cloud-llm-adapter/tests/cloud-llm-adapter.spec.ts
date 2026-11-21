import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
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
  return new CloudLlmAdapter({
    providers: {
      'seagull-cloud': { baseUrl: 'http://cloud.test', apiKey: 'sk-agent-test', defaultModel: 'seagull-relay' },
      'deepseek': {
        baseUrl: 'https://api.deepseek.test',
        apiKey: 'sk-deepseek-test',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
      },
    },
  })
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

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter().stream(options())) chunks.push(chunk)

    expect(chunks.find(c => c.type === 'block-start')).toMatchObject({ type: 'block-start', blockType: 'text' })
    expect(chunks.filter(c => c.type === 'text-delta').map(c => (c as { text: string }).text).join('')).toBe('Hello world')
    expect(chunks.find(c => c.type === 'usage')).toMatchObject({ type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })

    // The request body routes to the cloud Proxy with the agent key as Bearer.
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('seagull-relay')
    expect(body.stream).toBe(true)
    expect(String((init.headers as Headers).get('authorization'))).toBe('Bearer sk-agent-test')
  })

  it('maps a length finish to max-tokens and carries tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}',
    ])))

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter().stream(options())) chunks.push(chunk)

    const toolEnd = chunks.find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    expect(toolEnd).toBeDefined()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('routes each provider to its own baseUrl and apiKey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    for await (const _ of adapter().stream(options({ provider: 'deepseek', model: 'deepseek-chat' }))) { /* drain */ }

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.test/v1/chat/completions')
    expect(String((init.headers as Headers).get('authorization'))).toBe('Bearer sk-deepseek-test')
    expect(JSON.parse(String(init.body)).model).toBe('deepseek-chat')
  })

  it('advertises the configured catalog per provider', async () => {
    const subject = adapter()
    await expect(subject.listModels('deepseek')).resolves.toEqual([
      { provider: 'deepseek', id: 'deepseek-chat', name: 'deepseek-chat', inputModalities: ['text'] },
      { provider: 'deepseek', id: 'deepseek-reasoner', name: 'deepseek-reasoner', inputModalities: ['text'] },
    ])
    await expect(subject.listModels('seagull-cloud')).resolves.toEqual([
      { provider: 'seagull-cloud', id: 'seagull-relay', name: 'seagull-relay', inputModalities: ['text'] },
    ])
  })

  it('rejects an unconfigured provider route', async () => {
    const stream = adapter().stream(options({ provider: 'unknown' }))
    await expect((async () => {
      for await (const _ of stream) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })

  it('relays the harness sessionId through the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    for await (const _ of adapter().stream(options({ sessionId: 'bot-test-123' as never }))) { /* drain */ }

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(JSON.parse(String(init.body)).sessionId).toBe('bot-test-123')
  })
})
