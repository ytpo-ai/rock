import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RockBotService } from '../src/service.ts'
import { JsonFileBotStore } from '../src/store.ts'
import { activeBotIdsFrom } from '../src/tasks.ts'
import type { BotDefinition } from '../src/types.ts'

const BOT: BotDefinition = {
  id: 'agent-bot-E',
  name: 'Local Bot E',
  llm: { provider: 'deepseek', model: 'deepseek-chat', apiKeyRef: 'deepseek-key' },
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

    await expect(service.create(BOT)).resolves.toMatchObject({ id: 'agent-bot-E', llm: { provider: 'deepseek' } })
    expect(service.list()).toHaveLength(1)
    expect(service.get('agent-bot-E')).toMatchObject({ name: 'Local Bot E' })

    await service.update('agent-bot-E', { llm: { ...BOT.llm, model: 'deepseek-reasoner' } })
    expect(service.get('agent-bot-E')!.llm.model).toBe('deepseek-reasoner')

    // Persisted list survives a fresh service over the same file.
    const reloaded = new RockBotService({ store })
    await reloaded.load()
    expect(reloaded.list()).toEqual([service.get('agent-bot-E')])

    await service.remove('agent-bot-E')
    expect(service.list()).toHaveLength(0)
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
