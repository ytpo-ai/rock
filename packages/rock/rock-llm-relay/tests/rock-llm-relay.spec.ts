import { afterEach, describe, expect, it, vi } from 'vitest'
import { RockLlmRelay } from '../src/relay.ts'
import { enrichForwardLog } from '../src/index.ts'
import type { RelayForwardLog } from '../src/types.ts'

function relay(overrides: Partial<ConstructorParameters<typeof RockLlmRelay>[0]> = {}): RockLlmRelay {
  return new RockLlmRelay({
    host: '127.0.0.1',
    port: 0,
    localKey: 'sk-rock-test',
    cloudBaseUrl: 'http://cloud.test',
    resolveConnectorKey: () => 'sk-connector-test',
    connectorClientId: 'rock-a',
    resolveEmployeeId: agentBotId => agentBotId === 'agent-bot-C' ? 'employee-a' : undefined,
    ...overrides,
  })
}

function sseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('RockLlmRelay', () => {
  let servers: RockLlmRelay[] = []

  afterEach(async () => {
    await Promise.all(servers.map(server => server.stop()))
    servers = []
  })

  it('parses the agent bot from the base_url path and forwards with provenance', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data:')

    expect(forward).toHaveBeenCalledTimes(1)
    const [url, init] = forward.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/agent-bot-C/chat/completions')
    const headers = init.headers as Headers
    expect(headers.get('x-seagull-agent-bot-id')).toBe('agent-bot-C')
    expect(headers.get('x-seagull-employee-id')).toBe('employee-a')
    expect(headers.get('x-seagull-connector-client-id')).toBe('rock-a')
    expect(headers.get('x-seagull-relayed')).toBe('true')
    expect(headers.get('authorization')).toBe('Bearer sk-connector-test')
  })

  it('replaces the request model with the bot-binding placeholder', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [] }),
    })

    const [, init] = forward.mock.calls[0]! as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { model: string }
    expect(body.model).toBe('seagull-relay')
  })

  it('forwards the /responses suffix to the per-bot cloud endpoint', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'seagull-relay', input: [] }),
    })

    const [url, init] = forward.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/agent-bot-C/responses')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer sk-connector-test')
  })

  it('canonicalizes the Anthropic SDK `/v1/messages` suffix to `/messages`', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const onForward = vi.fn()
    const server = relay({ forward, onForward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    const [url, init] = forward.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/agent-bot-C/messages')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer sk-connector-test')

    const log = onForward.mock.calls[0]![0] as RelayForwardLog
    expect(log.pathSuffix).toBe('/messages')
    expect(log.wireProtocol).toBe('anthropic-messages')
  })

  it('authenticates the Anthropic `x-api-key` header', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-rock-test' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    expect(response.status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(1)
    const [url, init] = forward.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/agent-bot-C/messages')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer sk-connector-test')
  })

  it('preserves the query string while canonicalizing the Anthropic path', async () => {
    const forward = vi.fn().mockResolvedValue(sseResponse())
    const onForward = vi.fn()
    const server = relay({ forward, onForward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/v1/messages?beta=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-rock-test' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    const [url] = forward.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('http://cloud.test/v1/bots/agent-bot-C/messages?beta=true')

    const log = onForward.mock.calls[0]![0] as RelayForwardLog
    expect(log.pathSuffix).toBe('/messages')
    expect(log.wireProtocol).toBe('anthropic-messages')
  })

  it('returns 401 for a request missing the local bearer key', async () => {
    const forward = vi.fn()
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    expect(response.status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
  })

  it('returns 401 for a request with the wrong local bearer key', async () => {
    const forward = vi.fn()
    const server = relay({ forward })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-wrong' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    expect(response.status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
  })

  it('returns 404 for a path that does not name an agent bot', async () => {
    const server = relay({ forward: vi.fn() })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-rock-test' },
    })
    expect(response.status).toBe(404)
  })

  it('records the forward model mapping and session ids via onForward', async () => {
    const onForward = vi.fn()
    const server = relay({ forward: vi.fn().mockResolvedValue(sseResponse()), onForward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-rock-test',
        'x-dsh-session-id': 'bot-test-123',
        'x-session-id': 'tool-session-456',
      },
      body: JSON.stringify({ model: 'gpt-5', messages: [] }),
    })

    expect(onForward).toHaveBeenCalledTimes(1)
    const log = onForward.mock.calls[0]![0] as RelayForwardLog
    expect(log.agentBotId).toBe('agent-bot-C')
    expect(log.pathSuffix).toBe('/chat/completions')
    expect(log.requestModel).toBe('gpt-5')
    expect(log.mappedModel).toBe('seagull-relay')
    expect(log.rockSessionId).toBe('bot-test-123')
    expect(log.toolSessionId).toBe('tool-session-456')
    expect(log.status).toBe(200)
    expect(log.startedAt).toBeTypeOf('string')
    expect(log.durationMs).toBeTypeOf('number')
    expect(log.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('falls back to the body sessionId for rockSessionId', async () => {
    const onForward = vi.fn()
    const server = relay({ forward: vi.fn().mockResolvedValue(sseResponse()), onForward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'gpt-5', sessionId: 'bot-test-789', messages: [] }),
    })

    const log = onForward.mock.calls[0]![0] as RelayForwardLog
    expect(log.rockSessionId).toBe('bot-test-789')
    expect(log.toolSessionId).toBeUndefined()
  })

  it('records a forward failure with an error diagnostic', async () => {
    const onForward = vi.fn()
    const server = relay({ forward: vi.fn().mockRejectedValue(new Error('upstream down')), onForward })
    servers.push(server)
    const port = await server.start()

    await fetch(`http://127.0.0.1:${port}/v1/bots/agent-bot-C/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-rock-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [] }),
    })

    const log = onForward.mock.calls[0]![0] as RelayForwardLog
    expect(log.status).toBeUndefined()
    expect(log.error).toBe('upstream down')
  })
})

describe('enrichForwardLog', () => {
  it('attaches bot name, bound model, and bound tool when the identity resolves them', () => {
    const log: RelayForwardLog = { timestamp: 't', agentBotId: 'bot-a', pathSuffix: '/chat/completions', mappedModel: 'seagull-relay' }
    const enriched = enrichForwardLog(log, {
      getClaims: () => [{ agentBotId: 'bot-a', name: 'Bot A', employeeId: 'e1', model: { model: 'gpt-5' } }],
      getAssistants: () => [],
      toolBindingOf: id => id === 'bot-a' ? 'codex' : undefined,
    })
    expect(enriched).toEqual({
      timestamp: 't',
      agentBotId: 'bot-a',
      pathSuffix: '/chat/completions',
      mappedModel: 'seagull-relay',
      botName: 'Bot A',
      boundModel: 'gpt-5',
      toolType: 'codex',
    })
  })

  it('leaves the record unchanged when the identity is absent', () => {
    const log: RelayForwardLog = { timestamp: 't', agentBotId: 'bot-a', pathSuffix: '/chat/completions', mappedModel: 'seagull-relay' }
    expect(enrichForwardLog(log, undefined)).toBe(log)
  })
})
