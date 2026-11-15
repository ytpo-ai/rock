import { describe, expect, it } from 'vitest'
import { buildUnifiedBots } from '../src/unify.ts'
import type { BotDefinition } from '../src/types.ts'

const LOCAL: BotDefinition = {
  id: 'local-1',
  name: 'Local One',
  llm: { provider: 'deepseek', model: 'deepseek-chat' },
  tool: { toolType: 'codex' },
}

describe('buildUnifiedBots', () => {
  it('projects local bots with full rights and their own llm', () => {
    const rows = buildUnifiedBots({
      localBots: [LOCAL],
      claimed: [],
      assistants: [],
      activeIds: new Set(),
      bindingOf: () => 'codex',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'local-1', source: 'local', canRebind: true, canDelete: true, active: false })
    expect(rows[0]?.llm).toEqual(LOCAL.llm)
  })

  it('projects claimed bots without delete rights and resolves their binding', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [{ agentBotId: 'bot-C', canRebind: true }],
      assistants: [],
      activeIds: new Set(['bot-C']),
      bindingOf: () => 'pi',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'bot-C', source: 'claimed', canRebind: true, canDelete: false, active: true })
    expect(rows[0]?.tool).toEqual({ toolType: 'pi' })
    expect(rows[0]?.llm).toBeUndefined()
  })

  it('defaults a cloud bot name to its id and locks assistants by default', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [],
      assistants: [{ agentBotId: 'assistant-1' }],
      activeIds: new Set(),
      bindingOf: () => 'dsh',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'assistant-1', name: 'assistant-1', source: 'assistant', canRebind: false, canDelete: false })
  })
})
