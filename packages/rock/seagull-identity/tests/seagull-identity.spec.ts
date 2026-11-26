import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeagullIdentityService } from '../src/service.ts'

const CLAIMS = [
  { agentBotId: 'agent-bot-C', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
  { agentBotId: 'agent-bot-D', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
]

const CLAIMS_WITH_MODELS = [
  {
    agentBotId: 'agent-bot-C',
    employeeId: 'employee-a',
    claimedAt: '2026-11-14T00:00:00.000Z',
    model: { provider: 'deepseek', model: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
  },
  {
    agentBotId: 'agent-bot-D',
    employeeId: 'employee-a',
    claimedAt: '2026-11-14T00:00:00.000Z',
    model: { provider: 'moonshotai', model: 'kimi-k2.6', name: 'Kimi k2.6' },
  },
]

describe('SeagullIdentityService', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'seagull-identity-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('renders one agent-loop entry per claimed bot and resolves bindings', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: { 'agent-bot-C': 'codex' },
      defaultToolType: 'dsh',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
    })
    await service.sync()

    expect(service.renderAgents()).toEqual([
      { id: 'agent-bot-C', provider: 'seagull-cloud', model: 'seagull-relay', sessionId: 'agent-bot-C' },
      { id: 'agent-bot-D', provider: 'seagull-cloud', model: 'seagull-relay', sessionId: 'agent-bot-D' },
    ])
    expect(service.toolBindingOf('agent-bot-C')).toBe('codex')
    expect(service.toolBindingOf('agent-bot-D')).toBe('dsh')

    // 委派器化收尾：renderAgentLoopPatch 生成可写回 profile 的 agent-loop patch
    expect(service.renderAgentLoopPatch()).toEqual({
      id: 'agent-loop',
      name: '@deepseek-ai/dsh-agent-loop',
      config: { agents: service.renderAgents() },
    })
  })

  it('resolves a bot bound model or falls back to the relay placeholder', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS_WITH_MODELS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
    })
    await service.sync()

    expect(service.modelOf('agent-bot-C')).toBe('deepseek-v4-flash')
    expect(service.modelOf('agent-bot-D')).toBe('kimi-k2.6')
    // A bot without a projected model falls back to the relay placeholder.
    expect(service.modelOf('agent-bot-E')).toBe('seagull-relay')
  })

  it('syncs from the gateway and falls back to the local file on failure', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error('offline'))

    const service = new SeagullIdentityService({
      gatewayUrl: 'http://gateway.test/claims',
      employeeId: 'employee-a',
      claimFile,
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
      fetchJson,
    })
    await service.sync()

    expect(fetchJson).toHaveBeenCalledWith('http://gateway.test/claims?employeeId=employee-a')
    expect(service.getClaims()).toHaveLength(2)
  })

  it('syncs the dedicated assistant alongside claims from the gateway', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      data: {
        claims: CLAIMS,
        assistants: [{ agentBotId: 'assistant-1', name: 'Van的专属助理', role: '专属助理' }],
      },
    })

    const service = new SeagullIdentityService({
      gatewayUrl: 'http://gateway.test/claims',
      employeeId: 'employee-a',
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
      fetchJson,
    })
    await service.sync()

    expect(service.getAssistants()).toEqual([{ agentBotId: 'assistant-1', name: 'Van的专属助理', role: '专属助理' }])
  })

  it('merges local custom bots into the rendered agents with their own provider/model', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
      botDefinitions: [
        {
          id: 'agent-bot-E',
          name: 'Local Bot E',
          llm: { provider: 'deepseek', model: 'deepseek-chat' },
          tool: { toolType: 'codex' },
        },
      ],
    })
    await service.sync()

    expect(service.renderAgents()).toEqual([
      { id: 'agent-bot-C', provider: 'seagull-cloud', model: 'seagull-relay', sessionId: 'agent-bot-C' },
      { id: 'agent-bot-D', provider: 'seagull-cloud', model: 'seagull-relay', sessionId: 'agent-bot-D' },
      { id: 'agent-bot-E', provider: 'deepseek', model: 'deepseek-chat', sessionId: 'agent-bot-E' },
    ])
    expect(service.toolBindingOf('agent-bot-E')).toBe('codex')
    expect(service.toolBindingOf('agent-bot-C')).toBe('codex')
  })

  it('leaves a bot without any binding unbound', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: {},
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
    })
    await service.sync()

    expect(service.toolBindingOf('agent-bot-C')).toBeUndefined()

    service.setBotDefinitions([
      { id: 'agent-bot-D', name: 'Unbound Local', llm: { provider: 'deepseek', model: 'deepseek-chat' } },
    ])
    expect(service.toolBindingOf('agent-bot-D')).toBeUndefined()
  })

  it('lets a local bot override a claimed bot id and updates via setBotDefinitions', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: {},
      defaultToolType: 'dsh',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
    })
    await service.sync()

    service.setBotDefinitions([
      {
        id: 'agent-bot-C',
        name: 'Overridden C',
        llm: { provider: 'openai', model: 'gpt-4o' },
        tool: { toolType: 'pi' },
      },
    ])
    expect(service.renderAgents()).toContainEqual({ id: 'agent-bot-C', provider: 'openai', model: 'gpt-4o', sessionId: 'agent-bot-C' })
    expect(service.toolBindingOf('agent-bot-C')).toBe('pi')
  })

  it('resolves a bot bound channel wire protocols, or undefined when absent', async () => {
    const fetchJson = vi.fn().mockResolvedValue({
      data: {
        claims: [{
          agentBotId: 'agent-bot-C',
          employeeId: 'employee-a',
          claimedAt: '2026-11-14T00:00:00.000Z',
          model: { provider: 'deepseek', model: 'deepseek-v4-flash', name: 'deepseek-v4-flash', supportedProtocols: ['anthropic-messages', 'openai-responses', 'chat-completions'] },
        }],
        assistants: [{
          agentBotId: 'assistant-1',
          name: 'Van的专属助理',
          model: { provider: 'moonshotai', model: 'kimi-k3.1-pro', name: 'Kimi', supportedProtocols: ['anthropic-messages', 'chat-completions'] },
        }],
      },
    })

    const service = new SeagullIdentityService({
      gatewayUrl: 'http://gateway.test/claims',
      employeeId: 'employee-a',
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
      fetchJson,
    })
    await service.sync()

    expect(service.supportedProtocolsOf('agent-bot-C')).toEqual(['anthropic-messages', 'openai-responses', 'chat-completions'])
    expect(service.supportedProtocolsOf('assistant-1')).toEqual(['anthropic-messages', 'chat-completions'])
    expect(service.supportedProtocolsOf('unknown')).toBeUndefined()
  })
})
