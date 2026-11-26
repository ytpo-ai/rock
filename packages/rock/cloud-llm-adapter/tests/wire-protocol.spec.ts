import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CloudLlmAdapter, preferredWireProtocol } from '../src/adapter.ts'

/** Build an SSE body from raw lines (empty strings render blank separator lines). */
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

function relayAdapter(supported?: string[]): CloudLlmAdapter {
  return new CloudLlmAdapter({
    providers: {
      'seagull-cloud': { baseUrl: 'http://cloud.test', defaultModel: 'seagull-relay', relay: true },
    },
    resolveConnectorKey: () => 'sk-connector-test',
    resolveSupportedProtocols: () => supported,
  })
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'seagull-cloud',
    model: 'seagull-relay',
    agentId: 'bot-123',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], id: 'm1' as never, source: { kind: 'user' } }],
    ...overrides,
  } as GenerateOptions
}

function textOf(chunks: StreamChunk[]): string {
  return chunks.filter(c => c.type === 'text-delta').map(c => (c as { text: string }).text).join('')
}

describe('preferredWireProtocol', () => {
  it('prefers anthropic-messages, then openai-responses, then chat-completions', () => {
    expect(preferredWireProtocol(['chat-completions', 'openai-responses', 'anthropic-messages'])).toBe('anthropic-messages')
    expect(preferredWireProtocol(['chat-completions', 'openai-responses'])).toBe('openai-responses')
    expect(preferredWireProtocol(['chat-completions'])).toBe('chat-completions')
  })

  it('falls back to chat-completions when support is unknown, empty, or unmatched', () => {
    expect(preferredWireProtocol(undefined)).toBe('chat-completions')
    expect(preferredWireProtocol([])).toBe('chat-completions')
    expect(preferredWireProtocol(['grpc'])).toBe('chat-completions')
  })
})

describe('CloudLlmAdapter wire protocol routing', () => {
  it('routes to /messages and parses an Anthropic stream when anthropic is supported', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":0,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":2}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      'data: [DONE]',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const chunks: StreamChunk[] = []
    for await (const chunk of relayAdapter(['anthropic-messages', 'chat-completions']).stream(options())) chunks.push(chunk)

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/bot-123/messages')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('seagull-relay')
    expect(body.system).toBeUndefined()
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(textOf(chunks)).toBe('hi')
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('routes to /responses and parses a Responses stream when responses is the best supported', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}',
      '',
      'data: [DONE]',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const chunks: StreamChunk[] = []
    for await (const chunk of relayAdapter(['openai-responses', 'chat-completions']).stream(options())) chunks.push(chunk)

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/bot-123/responses')
    const body = JSON.parse(String(init.body))
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
    expect(textOf(chunks)).toBe('hi')
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('keeps the chat-completions default when support is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      'data: [DONE]',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    for await (const _ of relayAdapter(undefined).stream(options())) { /* drain */ }

    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/bot-123/chat/completions')
  })
})
