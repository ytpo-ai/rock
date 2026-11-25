// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BotDetailDrawer } from '../src/client/BotDetailDrawer.tsx'
import type { RockBotManagerKey } from '../src/client/locales.ts'
import type { BotRow, LlmProxyChecklist } from '../src/types.ts'

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
  supportedProtocols: ['anthropic-messages', 'chat-completions'],
}

const ASSISTANT: BotRow = {
  id: 'assistant-1',
  name: 'Assistant',
  source: 'assistant',
  canRebind: false,
  canDelete: false,
  active: false,
}

const CHECKLIST: LlmProxyChecklist = {
  botId: 'bot-C',
  providerId: 'rock-bot-c',
  displayName: 'Bot C',
  baseUrl: 'http://127.0.0.1:4090/v1/bots/bot-C',
  protocol: 'OpenAI Chat Completions',
  apiKey: 'sk-rock-test',
  modelId: 'gpt-5',
  modelName: 'gpt-5/Bot C',
}

/** Render one bot's drawer with every action wired to no-ops. */
function renderDrawer(bot: BotRow, options: {
  status?: 'undeployed' | 'deployed'
  loadProxy?: () => Promise<LlmProxyChecklist | null>
} = {}): void {
  const status = options.status ?? 'undeployed'
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
      debug={null}
      deployLocked={false}
      deployBusy={false}
      debugBusy={false}
      loadProxy={options.loadProxy}
      onBind={() => {}}
      onDeploy={() => {}}
      onDebug={() => {}}
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
    expect(screen.getByText('wireProtocol.anthropic-messages / wireProtocol.chat-completions')).toBeTruthy()
    expect(screen.getByText('detail.rebind')).toBeTruthy()
    expect(screen.getByText('debug')).toBeTruthy()
    expect(screen.queryByText('edit')).toBeNull()
  })

  it('offers the bind action while the bot is unbound', () => {
    const { tool: _tool, ...unbound } = CLAIMED
    renderDrawer(unbound)
    expect(screen.getByText('bind.pending')).toBeTruthy()
    expect(screen.getByText('bind.action')).toBeTruthy()
    expect(screen.getByText('detail.section.execution')).toBeTruthy()
  })

  it('puts the rebind control beside the execution-tool value rather than in the footer', () => {
    renderDrawer(CLAIMED)
    const toolField = screen.getByText('detail.tool').closest('div')
    expect(toolField).not.toBeNull()
    expect(toolField?.querySelector('button')?.textContent).toBe('detail.rebind')

    const footer = document.querySelector('footer')
    expect(footer).not.toBeNull()
    expect(footer?.textContent).not.toContain('detail.rebind')
  })

  it('hides execution and every action for the dedicated assistant', () => {
    renderDrawer(ASSISTANT)
    expect(screen.queryByText('detail.section.execution')).toBeNull()
    expect(screen.getByText('detail.assistantHint')).toBeTruthy()
    expect(screen.queryByText('debug')).toBeNull()
    expect(screen.queryByText('deploy.action')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows the redeploy action once the bot is deployed', () => {
    renderDrawer(CLAIMED, { status: 'deployed' })
    expect(screen.getByText('deploy.redeploy')).toBeTruthy()
  })

  it('reads the proxy checklist only when its tab is opened', async () => {
    const loadProxy = vi.fn(() => Promise.resolve(CHECKLIST))
    renderDrawer(CLAIMED, { loadProxy })

    expect(loadProxy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'proxy.tab' }))

    expect(await screen.findByText('rock-bot-c')).toBeTruthy()
    expect(loadProxy).toHaveBeenCalledTimes(1)
  })

  it('reports a failed proxy read inside the tab', async () => {
    renderDrawer(CLAIMED, { loadProxy: () => Promise.resolve(null) })

    fireEvent.click(screen.getByRole('tab', { name: 'proxy.tab' }))

    expect(await screen.findByText('proxy.loadFailed')).toBeTruthy()
    expect(screen.getByText('load.retry')).toBeTruthy()
  })
})
