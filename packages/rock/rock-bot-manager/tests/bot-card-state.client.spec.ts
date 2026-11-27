import { describe, expect, it } from 'vitest'
import { bindLockedReason, boundToolType, cardCtas, currentModelId, detailActions, isDeployable, modelChanged, supportsTools } from '../src/client/bot-card-state.ts'
import type { BotDeploymentRow, BotRow } from '../src/types.ts'

/** A claimed cloud bot with full rebind rights. */
const CLAIMED: BotRow = {
  id: 'bot-C',
  name: 'Bot C',
  source: 'claimed',
  tool: { toolType: 'codex' },
  canRebind: true,
  canDelete: false,
  active: false,
}

/** A local custom bot, bound and deletable. */
const LOCAL: BotRow = {
  id: 'bot-L',
  name: 'Bot L',
  source: 'local',
  tool: { toolType: 'dsh' },
  canRebind: true,
  canDelete: true,
  active: false,
}

/** The dedicated assistant never binds or runs an external tool. */
const ASSISTANT: BotRow = {
  id: 'assistant-1',
  name: 'Assistant',
  source: 'assistant',
  canRebind: false,
  canDelete: false,
  active: false,
}

describe('bot card actions', () => {
  it('offers only the pending bind action for an unbound bot', () => {
    const { tool: _tool, ...unbound } = CLAIMED
    expect(cardCtas(unbound, 'undeployed')).toEqual(['bind'])
    expect(boundToolType(unbound)).toBeUndefined()
  })

  it('offers deploy and debug before deployment and no action once deployed', () => {
    expect(cardCtas(CLAIMED, 'undeployed')).toEqual(['deploy', 'debug'])
    expect(cardCtas(CLAIMED, 'failed')).toEqual(['deploy', 'debug'])
    expect(cardCtas(CLAIMED, 'deploying')).toEqual(['deploy'])
    expect(cardCtas(CLAIMED, 'deployed')).toEqual([])
  })

  it('offers no card action for the dedicated assistant', () => {
    expect(supportsTools(ASSISTANT)).toBe(false)
    expect(cardCtas(ASSISTANT, 'undeployed')).toEqual([])
    expect(detailActions(ASSISTANT, true)).toEqual([])
  })
})

describe('bot detail actions', () => {
  it('offers every action the source permits to a claimed bot', () => {
    expect(detailActions(CLAIMED, true)).toEqual(['bind', 'deploy', 'debug', 'proxy'])
  })

  it('keeps deploy and proxy off a bot that cannot be deployed', () => {
    expect(detailActions(CLAIMED, false)).toEqual(['bind', 'debug', 'proxy'])
  })

  it('offers edit and delete to a local bot without the proxy checklist', () => {
    expect(detailActions(LOCAL, false)).toEqual(['bind', 'debug', 'edit', 'delete'])
  })

  it('offers debug even while the bot is unbound so the drawer explains why', () => {
    const { tool: _tool, ...unbound } = LOCAL
    expect(detailActions(unbound, false)).toContain('debug')
  })
})

describe('binding lock', () => {
  it('locks the binding while a cloud task runs, then while the source forbids rebinding', () => {
    expect(bindLockedReason({ ...CLAIMED, active: true }, 'running', 'locked')).toBe('running')
    expect(bindLockedReason(ASSISTANT, 'running', 'locked')).toBe('locked')
    expect(bindLockedReason(CLAIMED, 'running', 'locked')).toBeUndefined()
  })
})

describe('deployability', () => {
  it('reads deployability only from a recorded deployment row', () => {
    expect(isDeployable(undefined)).toBe(false)
    expect(isDeployable({ id: 'bot-C', name: 'Bot C', toolType: 'codex', status: 'undeployed', deployable: false })).toBe(false)
    expect(isDeployable({ id: 'bot-C', name: 'Bot C', toolType: 'codex', status: 'undeployed', deployable: true })).toBe(true)
  })
})

describe('model change detection', () => {
  const deployed: BotDeploymentRow = { id: 'bot-C', name: 'Bot C', status: 'deployed', deployable: true, deployedModel: 'gpt-4' }

  it('reads the raw model id before the display-name fallback', () => {
    expect(currentModelId({ ...CLAIMED, modelId: 'gpt-5', llm: { provider: 'x', model: 'GPT-5' } })).toBe('gpt-5')
    expect(currentModelId({ ...CLAIMED, llm: { provider: 'x', model: 'gpt-4' } })).toBe('gpt-4')
    expect(currentModelId({ ...CLAIMED, llm: { provider: 'x', model: '' } })).toBeUndefined()
    expect(currentModelId(CLAIMED)).toBeUndefined()
  })

  it('flags a deployed bot whose model changed since the last deploy', () => {
    const bot = { ...CLAIMED, modelId: 'gpt-5' }
    const { deployedModel: _deployedModel, ...neverDeployed } = deployed
    const { modelId: _modelId, ...botWithoutModel } = bot
    expect(modelChanged(bot, deployed)).toBe(true)
    expect(modelChanged({ ...bot, modelId: 'gpt-4' }, deployed)).toBe(false)
    expect(modelChanged(bot, { ...deployed, status: 'undeployed' })).toBe(false)
    expect(modelChanged(bot, neverDeployed)).toBe(false)
    expect(modelChanged(botWithoutModel, deployed)).toBe(false)
  })

  it('offers a redeploy action on the card only after the model changed', () => {
    const bot = { ...CLAIMED, modelId: 'gpt-5' }
    expect(cardCtas(bot, 'deployed', deployed)).toEqual(['deploy'])
    expect(cardCtas({ ...bot, modelId: 'gpt-4' }, 'deployed', deployed)).toEqual([])
    expect(cardCtas(bot, 'deployed', undefined)).toEqual([])
  })
})
