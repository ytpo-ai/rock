import { describe, expect, it } from 'vitest'
import { buildUnifiedBots, resolveBotToolType } from '../src/unify.ts'
import type { BotDefinition } from '../src/types.ts'

const LOCAL: BotDefinition = {
  id: 'local-1',
  name: 'Local One',
  role: 'Frontend',
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
      projectNameOf: () => undefined,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'local-1', role: 'Frontend', source: 'local', canRebind: true, canDelete: true, active: false })
    expect(rows[0]?.llm).toEqual(LOCAL.llm)
  })

  it('projects an unbound local bot without a tool field', () => {
    const rows = buildUnifiedBots({
      localBots: [{ id: 'local-2', name: 'Local Two', llm: { provider: 'deepseek', model: 'deepseek-chat' } }],
      claimed: [],
      assistants: [],
      activeIds: new Set(),
      bindingOf: () => undefined,
      projectNameOf: () => undefined,
    })
    expect(rows[0]).not.toHaveProperty('tool')
  })

  it('projects an unbound cloud bot without a tool field', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [{ agentBotId: 'bot-C', name: 'Bot C' }],
      assistants: [],
      activeIds: new Set(),
      bindingOf: () => undefined,
      projectNameOf: () => undefined,
    })
    expect(rows[0]).not.toHaveProperty('tool')
  })

  it('projects claimed bots without delete rights and resolves their binding', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [{ agentBotId: 'bot-C', name: 'Bot C', role: 'QA', canRebind: true }],
      assistants: [],
      activeIds: new Set(['bot-C']),
      bindingOf: () => 'pi',
      projectNameOf: () => undefined,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'bot-C', name: 'Bot C', role: 'QA', source: 'claimed', canRebind: true, canDelete: false, active: true })
    expect(rows[0]?.tool).toEqual({ toolType: 'pi' })
    expect(rows[0]?.llm).toBeUndefined()
  })

  it('projects a cloud bot model and project into the row', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [{
        agentBotId: 'bot-C',
        name: 'Bot C',
        model: { provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek-V3' },
        projectId: 'proj-a',
        canRebind: true,
      }],
      assistants: [],
      activeIds: new Set(),
      bindingOf: () => 'codex',
      projectNameOf: id => (id === 'proj-a' ? 'Project A' : undefined),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'bot-C',
      source: 'claimed',
      llm: { provider: 'deepseek', model: 'DeepSeek-V3' },
      projectId: 'proj-a',
      projectName: 'Project A',
    })
  })

  it('carries the supported protocols from a cloud bot model onto the row', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [{
        agentBotId: 'bot-C',
        name: 'Bot C',
        model: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          name: 'DeepSeek-V3',
          supportedProtocols: ['anthropic-messages', 'openai-responses', 'chat-completions'],
        },
        canRebind: true,
      }],
      assistants: [],
      activeIds: new Set(),
      bindingOf: () => 'codex',
      projectNameOf: () => undefined,
    })
    expect(rows[0]?.supportedProtocols).toEqual(['anthropic-messages', 'openai-responses', 'chat-completions'])
  })

  it('defaults a cloud bot name to its id and locks assistants by default', () => {
    const rows = buildUnifiedBots({
      localBots: [],
      claimed: [],
      assistants: [{ agentBotId: 'assistant-1' }],
      activeIds: new Set(),
      bindingOf: () => 'dsh',
      projectNameOf: () => undefined,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'assistant-1', name: 'assistant-1', source: 'assistant', canRebind: false, canDelete: false })
  })
})

describe('resolveBotToolType', () => {
  it('resolves a local bot id from its own definition', () => {
    expect(resolveBotToolType('local-1', [LOCAL], new Set(), () => 'pi')).toBe('codex')
  })

  it('resolves a cloud bot id through the binding resolver', () => {
    expect(resolveBotToolType('bot-C', [], new Set(['bot-C']), () => 'pi')).toBe('pi')
  })

  it('returns undefined for an unknown id', () => {
    expect(resolveBotToolType('nope', [LOCAL], new Set(['bot-C']), () => 'codex')).toBeUndefined()
  })

  it('returns undefined for a bot without an execution backend', () => {
    const unbound = { id: 'local-2', name: 'Local Two', llm: { provider: 'deepseek', model: 'deepseek-chat' } }
    expect(resolveBotToolType('local-2', [unbound], new Set(), () => undefined)).toBeUndefined()
    expect(resolveBotToolType('bot-C', [], new Set(['bot-C']), () => undefined)).toBeUndefined()
  })
})
