// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BotDetailDrawer } from '../src/client/BotDetailDrawer.tsx'
import type { RockBotManagerKey } from '../src/client/locales.ts'
import type { BotRow } from '../src/types.ts'

afterEach(cleanup)

/** Return the key verbatim so assertions target structural copy, not localized text. */
const t = (key: RockBotManagerKey): string => key

const CLAIMED: BotRow = {
  id: 'bot-C',
  name: 'Bot C',
  role: 'QA',
  source: 'claimed',
  llm: { provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek-V3' },
  tool: { toolType: 'codex' },
  canRebind: true,
  canDelete: false,
  active: false,
  projectName: 'Project A',
}

const ASSISTANT: BotRow = {
  id: 'assistant-1',
  name: 'Assistant',
  source: 'assistant',
  canRebind: false,
  canDelete: false,
  active: false,
}

/** Render one bot's drawer with every action wired to no-ops. */
function renderDrawer(bot: BotRow, status: 'undeployed' | 'deployed' = 'undeployed'): void {
  const boundTool = bot.tool?.toolType
  render(
    <BotDetailDrawer
      t={t}
      bot={bot}
      deployment={{
        id: bot.id,
        name: bot.name,
        ...boundTool === undefined ? {} : { toolType: boundTool },
        status,
        deployable: true,
      }}
      status={status}
      toolTypes={['codex', 'dsh']}
      installed={new Set(['codex', 'dsh'])}
      debug={null}
      deployLocked={false}
      deployBusy={false}
      debugBusy={false}
      onBind={() => {}}
      onDeploy={() => {}}
      onDebug={() => {}}
      onProxy={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
    />,
  )
}

describe('BotDetailDrawer', () => {
  it('shows the basic information and every source-permitted action', () => {
    renderDrawer(CLAIMED)
    expect(screen.getByText('detail.section.basic')).toBeTruthy()
    expect(screen.getByText('DeepSeek-V3')).toBeTruthy()
    expect(screen.getByText('Project A')).toBeTruthy()
    expect(screen.getByText('detail.rebind')).toBeTruthy()
    expect(screen.getByText('debug')).toBeTruthy()
    expect(screen.getByText('proxy.button')).toBeTruthy()
    expect(screen.queryByText('edit')).toBeNull()
  })

  it('offers the bind action while the bot is unbound', () => {
    const { tool: _tool, ...unbound } = CLAIMED
    renderDrawer(unbound)
    // The unbound tool field and the bind action both read as pending.
    expect(screen.getAllByText('bind.pending').length).toBeGreaterThan(1)
    expect(screen.getByText('detail.section.execution')).toBeTruthy()
  })

  it('hides execution and every action for the dedicated assistant', () => {
    renderDrawer(ASSISTANT)
    expect(screen.queryByText('detail.section.execution')).toBeNull()
    expect(screen.getByText('detail.assistantHint')).toBeTruthy()
    expect(screen.queryByText('debug')).toBeNull()
    expect(screen.queryByText('deploy.action')).toBeNull()
    expect(screen.queryByText('proxy.button')).toBeNull()
  })

  it('shows the redeploy action once the bot is deployed', () => {
    renderDrawer(CLAIMED, 'deployed')
    expect(screen.getByText('deploy.redeploy')).toBeTruthy()
  })
})
