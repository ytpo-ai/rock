/**
 * The observability Remote's log sources: relay forwards and adapter requests
 * page with the same bot scope, and the bot filter lists the identity's bots
 * before the local registry's. Both log plugins are optional dependencies, so
 * an absent source must read as empty rather than throw.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import RockObservabilityController from '../src/index.ts'
import type { AdapterRequestLog, RelayForwardLog } from '../src/types.ts'

/** One relay record carrying only what the assertions read. */
function relayLog(timestamp: string, agentBotId: string): RelayForwardLog {
  return { timestamp, agentBotId, pathSuffix: '/chat/completions', mappedModel: 'seagull-relay' }
}

/** One adapter record carrying only what the assertions read. */
function adapterLog(timestamp: string, agentBotId: string): AdapterRequestLog {
  return {
    timestamp,
    startedAt: timestamp,
    durationMs: 5,
    agentBotId,
    provider: 'seagull-cloud',
    requestModel: 'seagull-relay',
    messageCount: 1,
  }
}

/** Paged read surface over a fixed newest-first history, scoped by agent bot id. */
function logSource<Entry extends { agentBotId?: string }>(entries: Entry[]) {
  return {
    logPage: async (offset: number, limit: number, botId?: string): Promise<Entry[]> =>
      scoped(entries, botId).slice(offset, offset + limit),
    logCount: async (botId?: string): Promise<number> => scoped(entries, botId).length,
  }
}

function scoped<Entry extends { agentBotId?: string }>(entries: Entry[], botId: string | undefined): Entry[] {
  if (botId === undefined || botId === '') return entries
  return entries.filter(entry => entry.agentBotId === botId)
}

/** Mount the controller over the given optional services. */
async function mount(services: Record<string, unknown> = {}): Promise<RockObservabilityController> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('sessions', {})
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
  await ctx.plugin(RockObservabilityController)
  return ctx.rockObservability
}

describe('RockObservabilityController log sources', () => {
  const relay = logSource([relayLog('3', 'bot-a'), relayLog('2', 'bot-b'), relayLog('1', 'bot-a')])
  const adapter = logSource([adapterLog('3', 'bot-a'), adapterLog('2', 'bot-b')])

  it('pages relay forwards newest-first and scopes them to one bot', async () => {
    const subject = await mount({ rockLlmRelay: relay })

    await expect(subject.relayLogs(0, 10)).resolves.toMatchObject([{ timestamp: '3' }, { timestamp: '2' }, { timestamp: '1' }])
    await expect(subject.relayLogs(0, 10, 'bot-a')).resolves.toMatchObject([{ timestamp: '3' }, { timestamp: '1' }])
    await expect(subject.relayLogCount()).resolves.toBe(3)
    await expect(subject.relayLogCount('bot-a')).resolves.toBe(2)
  })

  it('pages adapter requests newest-first and scopes them to one bot', async () => {
    const subject = await mount({ rockLlmAdapter: adapter })

    await expect(subject.adapterLogs(0, 10)).resolves.toMatchObject([{ timestamp: '3' }, { timestamp: '2' }])
    await expect(subject.adapterLogs(0, 10, 'bot-b')).resolves.toMatchObject([{ timestamp: '2' }])
    await expect(subject.adapterLogCount('bot-a')).resolves.toBe(1)
  })

  it('reads every log source as empty when its plugin is absent', async () => {
    const subject = await mount()

    await expect(subject.relayLogs(0, 10)).resolves.toEqual([])
    await expect(subject.relayLogCount()).resolves.toBe(0)
    await expect(subject.adapterLogs(0, 10)).resolves.toEqual([])
    await expect(subject.adapterLogCount()).resolves.toBe(0)
  })

  it('lists claims and assistants before local bots, without duplicates', async () => {
    const subject = await mount({
      seagullIdentity: {
        getClaims: () => [{ agentBotId: 'bot-a', name: 'Bot A' }, { agentBotId: 'bot-unnamed' }],
        getAssistants: () => [{ agentBotId: 'bot-assistant', name: 'Assistant' }],
      },
      rockBots: {
        listBots: () => [{ id: 'bot-a', name: 'Bot A (local)' }, { id: 'bot-local', name: 'Local Bot' }],
      },
    })

    expect(subject.bots()).toEqual([
      { id: 'bot-a', name: 'Bot A' },
      { id: 'bot-unnamed', name: 'bot-unnamed' },
      { id: 'bot-assistant', name: 'Assistant' },
      { id: 'bot-local', name: 'Local Bot' },
    ])
  })

  it('offers no bot choices when neither identity nor registry is mounted', async () => {
    const subject = await mount()
    expect(subject.bots()).toEqual([])
  })
})
