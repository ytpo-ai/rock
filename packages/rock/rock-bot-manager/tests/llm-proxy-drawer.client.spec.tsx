// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LlmProxyDrawer } from '../src/client/LlmProxyDrawer.tsx'
import type { RockBotManagerKey } from '../src/client/locales.ts'
import type { LlmProxyChecklist } from '../src/types.ts'

afterEach(cleanup)

const checklist: LlmProxyChecklist = {
  botId: 'agent-bot-C',
  providerId: 'rock-agent-bot-c',
  displayName: '客服助手',
  baseUrl: 'http://127.0.0.1:4090/v1/bots/agent-bot-C',
  protocol: 'OpenAI Chat Completions',
  apiKey: 'sk-rock-test',
  modelId: 'gpt-5',
  modelName: 'gpt-5/客服助手',
}

/** Return the key verbatim so assertions target the checklist values, not localized copy. */
const t = (key: RockBotManagerKey): string => key

describe('LlmProxyDrawer', () => {
  it('renders every provider and model field value', () => {
    render(<LlmProxyDrawer t={t} checklist={checklist} onClose={() => {}} />)

    expect(screen.getByText('rock-agent-bot-c')).toBeTruthy()
    expect(screen.getByText('客服助手')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:4090/v1/bots/agent-bot-C')).toBeTruthy()
    expect(screen.getByText('OpenAI Chat Completions')).toBeTruthy()
    expect(screen.getByText('sk-rock-test')).toBeTruthy()
    expect(screen.getByText('gpt-5')).toBeTruthy()
    expect(screen.getByText('gpt-5/客服助手')).toBeTruthy()
  })

  it('offers a copy action for each copyable field', () => {
    render(<LlmProxyDrawer t={t} checklist={checklist} onClose={() => {}} />)

    // Seven copyable fields (5 provider + model id + model name) plus the header/footer close buttons.
    expect(screen.getAllByText('proxy.copy').length).toBe(7)
  })
})
