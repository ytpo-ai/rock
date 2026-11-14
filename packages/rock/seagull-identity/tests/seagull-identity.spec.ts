import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeagullIdentityService } from '../src/service.ts'

const CLAIMS = [
  { agentBotId: 'agent-bot-C', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
  { agentBotId: 'agent-bot-D', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
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
      { id: 'agent-bot-C', provider: 'seagull-cloud', model: 'seagull-relay' },
      { id: 'agent-bot-D', provider: 'seagull-cloud', model: 'seagull-relay' },
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
      { id: 'agent-bot-C', provider: 'seagull-cloud', model: 'seagull-relay' },
      { id: 'agent-bot-D', provider: 'seagull-cloud', model: 'seagull-relay' },
      { id: 'agent-bot-E', provider: 'deepseek', model: 'deepseek-chat' },
    ])
    expect(service.toolBindingOf('agent-bot-E')).toBe('codex')
    expect(service.toolBindingOf('agent-bot-C')).toBe('codex')
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
    expect(service.renderAgents()).toContainEqual({ id: 'agent-bot-C', provider: 'openai', model: 'gpt-4o' })
    expect(service.toolBindingOf('agent-bot-C')).toBe('pi')
  })
})
