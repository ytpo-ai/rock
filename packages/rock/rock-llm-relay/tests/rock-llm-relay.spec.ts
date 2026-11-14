import { afterEach, describe, expect, it, vi } from 'vitest'
import { RockLlmRelay } from '../src/relay.ts'

function relay(overrides: Partial<ConstructorParameters<typeof RockLlmRelay>[0]> = {}): RockLlmRelay {
  return new RockLlmRelay({
    host: '127.0.0.1',
    port: 0,
    cloudBaseUrl: 'http://cloud.test',
    agentApiKey: 'sk-agent-test',
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'seagull-relay', messages: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data:')

    expect(forward).toHaveBeenCalledTimes(1)
    const [url, init] = forward.mock.calls[0]!
    expect(url).toBe('http://cloud.test/v1/chat/completions')
    const headers = init.headers as Headers
    expect(headers.get('x-seagull-agent-bot-id')).toBe('agent-bot-C')
    expect(headers.get('x-seagull-employee-id')).toBe('employee-a')
    expect(headers.get('x-seagull-connector-client-id')).toBe('rock-a')
    expect(headers.get('x-seagull-relayed')).toBe('true')
    expect(headers.get('authorization')).toBe('Bearer sk-agent-test')
  })

  it('returns 404 for a path that does not name an agent bot', async () => {
    const server = relay({ forward: vi.fn() })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST' })
    expect(response.status).toBe(404)
  })
})
