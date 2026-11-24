/**
 * Plugin entry tests: default descriptor registration, HMR disposal, and
 * config validation.
 */

import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import * as dshRemote from '../src/index.ts'
import { relayProviderId, resolveRelayRoute } from '../src/index.ts'

async function mountSubagents(ctx: Context): Promise<void> {
  await ctx.plugin(SessionProjectionRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
}

describe('subagent-dsh-remote plugin', () => {
  it('registers the default descriptor, validates config, and unregisters on HMR', async () => {
    const ctx = new Context()
    await mountSubagents(ctx)
    const fiber = await ctx.plugin(dshRemote, { token: 'token' })
    const provider = ctx.subagents.getProvider('dsh-remote')
    expect(provider).toBeDefined()
    expect(provider).toMatchObject({
      name: 'dsh-remote',
      capabilities: {
        agentOptions: false,
        agentPreset: false,
        outputSchema: false,
        depthLimit: false,
      },
      inheritsParentContext: false,
    })
    await fiber.dispose()
    expect(ctx.subagents.getProvider('dsh-remote')).toBeUndefined()

    for (const waitTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(ctx.plugin(dshRemote, { token: 'token', waitTimeoutMs }))
        .rejects.toThrow('waitTimeoutMs must be a positive finite number')
    }
    await ctx.fiber.dispose()
  })

  it('registers under a configured provider name', async () => {
    const ctx = new Context()
    await mountSubagents(ctx)
    const fiber = await ctx.plugin(dshRemote, { token: 'token', providerName: 'dsh-remote-custom' })
    expect(ctx.subagents.getProvider('dsh-remote-custom')?.name).toBe('dsh-remote-custom')
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

describe('relay provider routing', () => {
  it('derives the deploy-flow DSH provider id from a Seagull agent-bot id', () => {
    expect(relayProviderId('69A04A2574989E4972C4CBB9')).toBe('rock-69a04a2574989e4972c4cbb9')
    expect(relayProviderId('Bot/Name.With_Chars')).toBe('rock-bot-name-with-chars')
    expect(relayProviderId('---')).toBe('rock-bot')
  })

  it('resolves a per-bot relay route from the parent identity + bound model', () => {
    expect(resolveRelayRoute('69A04A2574989E4972C4CBB9', 'deepseek-v4'))
      .toEqual({ provider: 'rock-69a04a2574989e4972c4cbb9', model: 'deepseek-v4' })
  })

  it('returns undefined when the parent lacks a relay identity or bound model', () => {
    expect(resolveRelayRoute(undefined, 'deepseek-v4')).toBeUndefined()
    expect(resolveRelayRoute('', 'deepseek-v4')).toBeUndefined()
    expect(resolveRelayRoute('bot', undefined)).toBeUndefined()
    expect(resolveRelayRoute('bot', '')).toBeUndefined()
  })
})
