import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RockBotService } from '../src/service.ts'
import { JsonFileBotStore, JsonFileDeploymentStore } from '../src/store.ts'
import { activeBotIdsFrom } from '../src/tasks.ts'
import type { ApiProtocol, BotDefinition } from '../src/types.ts'

const BOT: BotDefinition = {
  id: 'agent-bot-E',
  name: 'Local Bot E',
  role: 'QA',
  llm: { provider: 'deepseek', model: 'deepseek-chat', apiKeyRef: 'deepseek-key', apiKey: 'sk-test' },
  tool: { toolType: 'codex' },
}

describe('RockBotService', () => {
  let dir: string
  let store: JsonFileBotStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rock-bot-manager-'))
    store = new JsonFileBotStore(join(dir, 'bots.json'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates, lists, updates, and removes bots with persistence', async () => {
    const service = new RockBotService({ store })

    await expect(service.create(BOT)).resolves.toMatchObject({ id: 'agent-bot-E', role: 'QA', llm: { provider: 'deepseek' } })
    expect(service.list()).toHaveLength(1)
    expect(service.get('agent-bot-E')).toMatchObject({ name: 'Local Bot E', role: 'QA' })
    expect(service.get('agent-bot-E')!.llm.apiKey).toBe('sk-test')

    await service.update('agent-bot-E', { llm: { ...BOT.llm, model: 'deepseek-reasoner' } })
    expect(service.get('agent-bot-E')!.llm.model).toBe('deepseek-reasoner')

    // Persisted list survives a fresh service over the same file.
    const reloaded = new RockBotService({ store })
    await reloaded.load()
    expect(reloaded.list()).toEqual([service.get('agent-bot-E')])

    await service.remove('agent-bot-E')
    expect(service.list()).toHaveLength(0)
  })

  it('omits an absent role instead of persisting an empty field', async () => {
    const service = new RockBotService({ store })
    await service.create({ id: BOT.id, name: BOT.name, llm: BOT.llm, tool: { toolType: 'codex' } })
    expect(service.get('agent-bot-E')).not.toHaveProperty('role')
  })

  it('rejects a duplicate id with a typed error', async () => {
    const service = new RockBotService({ store })
    await service.create(BOT)
    await expect(service.create(BOT)).rejects.toMatchObject({ code: 'DUPLICATE_BOT' })
  })

  it('rejects an unknown id with a typed error', async () => {
    const service = new RockBotService({ store })
    await expect(service.remove('nope')).rejects.toMatchObject({ code: 'UNKNOWN_BOT' })
    await expect(service.update('nope', { name: 'x' })).rejects.toMatchObject({ code: 'UNKNOWN_BOT' })
  })

  it('rejects a bot with an empty id, provider, or toolType', async () => {
    const service = new RockBotService({ store })
    await expect(service.create({ ...BOT, id: '' })).rejects.toThrow('non-empty')
    await expect(service.create({ ...BOT, llm: { provider: '', model: 'm' }, tool: { toolType: 'codex' } })).rejects.toThrow('provider')
    await expect(service.create({ ...BOT, llm: { provider: 'p', model: 'm' }, tool: { toolType: '' } })).rejects.toThrow('toolType')
  })

  it('stores a bot without an execution backend and keeps it unbound', async () => {
    const service = new RockBotService({ store })
    const created = await service.create({ id: 'bot-unbound', name: 'Unbound Bot', llm: { provider: 'deepseek', model: 'deepseek-chat' } })
    expect(created).not.toHaveProperty('tool')
    expect(service.get('bot-unbound')).not.toHaveProperty('tool')
  })

  it('persists the extended provider and model fields round-trip', async () => {
    const service = new RockBotService({ store })
    const bot: BotDefinition = {
      id: 'bot-full',
      name: 'Full Bot',
      llm: {
        provider: 'acme-gateway',
        name: 'Acme 中转站',
        baseUrl: 'https://gateway.example.com/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-xxx',
        model: 'gpt-5',
        modelName: 'GPT-5',
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        inputTypes: ['text', 'image'],
        reasoning: { enabled: true, levels: [{ level: 'off', value: '0' }, { level: 'high', value: 'high' }] },
      },
      tool: { toolType: 'codex' },
    }
    await service.create(bot)
    expect(service.get('bot-full')).toEqual(bot)

    const reloaded = new RockBotService({ store })
    await reloaded.load()
    expect(reloaded.list()).toEqual([bot])
  })

  it('rejects an unsupported protocol, non-positive token limits, and an empty reasoning level', async () => {
    const service = new RockBotService({ store })
    await expect(service.create({ ...BOT, llm: { ...BOT.llm, protocol: 'grpc' as ApiProtocol } })).rejects.toThrow('protocol')
    await expect(service.create({ ...BOT, llm: { ...BOT.llm, contextWindow: -1 } })).rejects.toThrow('contextWindow')
    await expect(service.create({ ...BOT, llm: { ...BOT.llm, maxOutputTokens: 0 } })).rejects.toThrow('maxOutputTokens')
    await expect(service.create({ ...BOT, llm: { ...BOT.llm, reasoning: { enabled: true, levels: [{ level: '', value: 'x' }] } } })).rejects.toThrow('level')
  })
})

describe('RockBotService deployment state', () => {
  let dir: string
  let store: JsonFileBotStore
  let deploymentsStore: JsonFileDeploymentStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rock-bot-manager-deploy-'))
    store = new JsonFileBotStore(join(dir, 'bots.json'))
    deploymentsStore = new JsonFileDeploymentStore(join(dir, 'deployments.json'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('records and reloads a bot deployment status', async () => {
    const service = new RockBotService({ store, deploymentsStore })
    await service.create(BOT)
    await service.setDeployment({ agentBotId: BOT.id, toolType: 'codex', status: 'deployed', updatedAt: '2026-11-22T00:00:00.000Z' })
    expect(service.getDeployment(BOT.id)).toMatchObject({ status: 'deployed', toolType: 'codex' })
    expect(service.listDeployments()[BOT.id]?.status).toBe('deployed')

    const reloaded = new RockBotService({ store, deploymentsStore })
    await reloaded.load()
    expect(reloaded.getDeployment(BOT.id)).toMatchObject({ status: 'deployed', toolType: 'codex' })
  })

  it('records a failed deployment with an error diagnostic', async () => {
    const service = new RockBotService({ store, deploymentsStore })
    await service.setDeployment({ agentBotId: 'bot-x', toolType: 'dsh', status: 'failed', updatedAt: '2026-11-22T00:00:00.000Z', error: 'boom' })
    expect(service.getDeployment('bot-x')).toMatchObject({ status: 'failed', error: 'boom' })
  })
})

describe('activeBotIdsFrom', () => {
  it('returns deduped owner ids with an active status, ignoring malformed rows', () => {
    const tasks = [
      { owner: 'bot-a', status: 'in-progress' },
      { owner: 'bot-a', status: 'pending' },
      { owner: 'bot-b', status: 'accepted' },
      { owner: 'bot-c', status: 'blocked' },
      { owner: '', status: 'in-progress' },
      { owner: 'bot-d', status: 42 },
    ]
    expect(activeBotIdsFrom(tasks)).toEqual(['bot-a', 'bot-c'])
  })

  it('returns an empty list when no task is active', () => {
    expect(activeBotIdsFrom([
      { owner: 'bot-b', status: 'accepted' },
      { owner: 'bot-b', status: 'done' },
    ])).toEqual([])
  })
})
