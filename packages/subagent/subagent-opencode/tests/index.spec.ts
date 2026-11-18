/**
 * Plugin entry tests: default descriptor registration, HMR disposal, and
 * config validation.
 */

import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import * as opencode from '../src/index.ts'

async function mountSubagents(ctx: Context): Promise<void> {
  await ctx.plugin(SessionProjectionRegistry)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
}

describe('subagent-opencode plugin', () => {
  it('registers the default descriptor, validates config, and unregisters on HMR', async () => {
    const ctx = new Context()
    await mountSubagents(ctx)
    const fiber = await ctx.plugin(opencode, {})
    const provider = ctx.subagents.getProvider('opencode')
    expect(provider).toBeDefined()
    expect(provider).toMatchObject({
      name: 'opencode',
      capabilities: {
        agentOptions: false,
        agentPreset: false,
        outputSchema: false,
        depthLimit: false,
      },
      inheritsParentContext: false,
    })
    await fiber.dispose()
    expect(ctx.subagents.getProvider('opencode')).toBeUndefined()

    for (const pollIntervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(ctx.plugin(opencode, { pollIntervalMs }))
        .rejects.toThrow('pollIntervalMs must be a positive finite number')
    }
    await ctx.fiber.dispose()
  })

  it('registers under a configured provider name', async () => {
    const ctx = new Context()
    await mountSubagents(ctx)
    const fiber = await ctx.plugin(opencode, { providerName: 'opencode-custom' })
    expect(ctx.subagents.getProvider('opencode-custom')?.name).toBe('opencode-custom')
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
