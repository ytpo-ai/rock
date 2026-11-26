import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { RotatingJsonlLog } from '@rock/rock-log-store'
import { CloudLlmAdapter } from '../src/adapter.ts'
import { enrichRequestLog, RockLlmAdapterService } from '../src/index.ts'
import type { LlmRequestLog } from '../src/types.ts'

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

/** Read one recorded request's JSON body, refusing a body that is not a JSON object. */
function requestBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('request body is not a string')
  const parsed: unknown = JSON.parse(init.body)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** One adapter that reports finished requests through the given hook. */
function adapterWithLog(onRequest: (log: LlmRequestLog) => void): CloudLlmAdapter {
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
    onRequest,
  })
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'seagull-cloud',
    model: 'seagull-relay',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], id: 'm1' as never, source: { kind: 'user' } }],
    ...overrides,
  }
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
    const body = requestBody(init)
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
    expect(requestBody(init).model).toBe('deepseek-chat')
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

  it('rejects a relay route without an agent-bot id instead of falling back to the session id', async () => {
    const relayAdapter = new CloudLlmAdapter({
      providers: {
        'seagull-cloud': { baseUrl: 'http://cloud.test', defaultModel: 'seagull-relay', relay: true },
      },
      resolveConnectorKey: () => 'sk-connector-test',
    })

    const stream = relayAdapter.stream(options({ sessionId: 'bot-test-123' as never }))
    await expect((async () => {
      for await (const _ of stream) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('routes a relay request through /v1/bots/{agentId} with the connector key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const relayAdapter = new CloudLlmAdapter({
      providers: {
        'seagull-cloud': { baseUrl: 'http://cloud.test', defaultModel: 'seagull-relay', relay: true },
      },
      resolveConnectorKey: () => 'sk-connector-test',
    })

    for await (const _ of relayAdapter.stream(options({ agentId: '69b63932c694637f7b9f5900' }))) { /* drain */ }

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/69b63932c694637f7b9f5900/chat/completions')
    expect(String((init.headers as Headers).get('authorization'))).toBe('Bearer sk-connector-test')
  })

  it('carries cache reads from OpenAI prompt_tokens_details as a disjoint bucket', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":5,"total_tokens":1005,"prompt_tokens_details":{"cached_tokens":896}}}',
    ])))

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter().stream(options())) chunks.push(chunk)

    expect(chunks.find(c => c.type === 'usage')).toMatchObject({
      usage: { inputTokens: 104, outputTokens: 5, totalTokens: 1005, cacheReadTokens: 896 },
    })
  })

  it('merges the Anthropic message_start cache fields with the message_delta output count', async () => {
    const relayAdapter = new CloudLlmAdapter({
      providers: {
        'seagull-cloud': { baseUrl: 'http://cloud.test', defaultModel: 'seagull-relay', relay: true },
      },
      resolveConnectorKey: () => 'sk-connector-test',
      resolveSupportedProtocols: () => ['anthropic-messages'],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":104,"cache_read_input_tokens":896,"cache_creation_input_tokens":12}}}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
    ])))

    const chunks: StreamChunk[] = []
    for await (const chunk of relayAdapter.stream(options({ agentId: '69b63932c694637f7b9f5900' }))) chunks.push(chunk)

    expect(chunks.find(c => c.type === 'usage')).toMatchObject({
      usage: { inputTokens: 104, outputTokens: 5, cacheReadTokens: 896, cacheWriteTokens: 12 },
    })
  })

  it('carries cache reads from a Responses input_tokens_details as a disjoint bucket', async () => {
    const responsesAdapter = new CloudLlmAdapter({
      providers: {
        'seagull-cloud': { baseUrl: 'http://cloud.test', defaultModel: 'seagull-relay', relay: true },
      },
      resolveConnectorKey: () => 'sk-connector-test',
      resolveSupportedProtocols: () => ['openai-responses'],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: response.completed',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1000,"output_tokens":5,"total_tokens":1005,"input_tokens_details":{"cached_tokens":896}}}}',
    ])))

    const chunks: StreamChunk[] = []
    for await (const chunk of responsesAdapter.stream(options({ agentId: '69b63932c694637f7b9f5900' }))) chunks.push(chunk)

    expect(chunks.find(c => c.type === 'usage')).toMatchObject({
      usage: { inputTokens: 104, outputTokens: 5, totalTokens: 1005, cacheReadTokens: 896 },
    })
  })

  it('relays the harness sessionId through the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    for await (const _ of adapter().stream(options({ sessionId: 'bot-test-123' as never }))) { /* drain */ }

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(requestBody(init).sessionId).toBe('bot-test-123')
  })
})

describe('adapter request log', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records status, duration, model, and provider tokens for a completed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":40,"completion_tokens":12,"total_tokens":52,"prompt_tokens_details":{"cached_tokens":8},"completion_tokens_details":{"reasoning_tokens":3}}}',
    ])))
    const recorded: LlmRequestLog[] = []

    for await (const _ of adapterWithLog(log => recorded.push(log)).stream(options({
      agentId: 'bot-a',
      sessionId: 's1' as never,
      tools: [{ name: 'bash', description: 'run', parameters: {} }],
    }))) { /* drain */ }

    expect(recorded).toHaveLength(1)
    const log = recorded[0]!
    expect(log).toMatchObject({
      agentBotId: 'bot-a',
      provider: 'seagull-cloud',
      wireProtocol: 'chat-completions',
      sessionId: 's1',
      requestModel: 'seagull-relay',
      messageCount: 1,
      toolCount: 1,
      status: 200,
    })
    expect(log.error).toBeUndefined()
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
    expect(log.tokens).toEqual({ input: 32, output: 12, total: 52, cacheRead: 8, reasoning: 3 })
  })

  it('records the failure diagnostic and no status when the upstream rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('overloaded', { status: 503 })))
    const recorded: LlmRequestLog[] = []

    await expect((async () => {
      for await (const _ of adapterWithLog(log => recorded.push(log)).stream(options())) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'HTTP_503' })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ provider: 'seagull-cloud', requestModel: 'seagull-relay' })
    expect(recorded[0]!.error).toContain('503')
    expect(recorded[0]!.status).toBeUndefined()
    expect(recorded[0]!.tokens).toBeUndefined()
  })

  it('records a transport failure as an error without a status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))
    const recorded: LlmRequestLog[] = []

    await expect((async () => {
      for await (const _ of adapterWithLog(log => recorded.push(log)).stream(options())) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'HTTP_500' })

    expect(recorded[0]).toMatchObject({
      requestModel: 'seagull-relay',
      error: 'cloud proxy request failed: socket hang up',
    })
  })

  it('records an early-ended stream as incomplete instead of a success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"par"},"finish_reason":null}]}',
    ])))
    const recorded: LlmRequestLog[] = []

    for await (const _ of adapterWithLog(log => recorded.push(log)).stream(options())) { /* drain */ }

    // The harness still yields a synthetic stop finish, but the log marks the truncation.
    expect(recorded[0]!.error).toBe('stream ended before completion')
  })

  it('omits the agent bot, session, tools, and tokens fields when the request carried none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    ])))
    const recorded: LlmRequestLog[] = []

    for await (const _ of adapterWithLog(log => recorded.push(log)).stream(options())) { /* drain */ }

    const log = recorded[0]!
    expect(log.agentBotId).toBeUndefined()
    expect(log.sessionId).toBeUndefined()
    expect(log.toolCount).toBeUndefined()
    expect(log.tokens).toBeUndefined()
  })
})

describe('RockLlmAdapterService', () => {
  it('pages request logs newest-first and scopes them to one bot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-adapter-log-'))
    const store = new RotatingJsonlLog<LlmRequestLog>({ path: join(dir, 'log.jsonl'), keyOf: log => log.agentBotId ?? '' })
    const service = new RockLlmAdapterService(store)
    store.append({ ...ENTRY, timestamp: '1', agentBotId: 'bot-a' })
    store.append({ ...ENTRY, timestamp: '2', agentBotId: 'bot-b' })
    store.append({ ...ENTRY, timestamp: '3', agentBotId: 'bot-a' })
    await store.flush()

    await expect(service.logCount()).resolves.toBe(3)
    await expect(service.logCount('bot-a')).resolves.toBe(2)
    await expect(service.logPage(0, 10, 'bot-a')).resolves.toMatchObject([{ timestamp: '3' }, { timestamp: '1' }])
    expect(service.recentLogs().map(log => log.timestamp)).toEqual(['3', '2', '1'])
    await rm(dir, { recursive: true, force: true })
  })
})

describe('enrichRequestLog', () => {
  it('attaches the bot name, bound model, and bound tool resolved from the identity', () => {
    const enriched = enrichRequestLog({ ...ENTRY, agentBotId: 'bot-a' }, {
      getClaims: () => [{ agentBotId: 'bot-a', name: 'Bot A', model: { model: 'gpt-5' } }],
      getAssistants: () => [],
      toolBindingOf: () => 'codex',
    })
    expect(enriched).toMatchObject({ botName: 'Bot A', boundModel: 'gpt-5', toolType: 'codex' })
  })

  it('leaves the record untouched without an identity or an agent bot', () => {
    const withoutIdentity = { ...ENTRY, agentBotId: 'bot-a' }
    expect(enrichRequestLog(withoutIdentity, undefined)).toBe(withoutIdentity)
    const unnamed = { ...ENTRY }
    expect(enrichRequestLog(unnamed, {
      getClaims: () => [{ agentBotId: 'bot-a', name: 'Bot A' }],
      getAssistants: () => [],
      toolBindingOf: () => 'codex',
    })).toBe(unnamed)
  })
})

/** One minimal request-log entry whose fields every case overrides. */
const ENTRY: LlmRequestLog = {
  timestamp: '2026-11-26T00:00:00.000Z',
  startedAt: '2026-11-26T00:00:00.000Z',
  durationMs: 10,
  provider: 'seagull-cloud',
  requestModel: 'seagull-relay',
  messageCount: 1,
}
