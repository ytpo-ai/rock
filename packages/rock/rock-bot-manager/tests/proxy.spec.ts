import { describe, expect, it } from 'vitest'
import { buildLlmProxyChecklist, providerIdFor, RELAY_PROTOCOL } from '../src/proxy.ts'

describe('buildLlmProxyChecklist', () => {
  it('derives the provider id, base URL, protocol, key, and model fields', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', '客服助手', 'gpt-5', {
      baseUrl: 'http://127.0.0.1:4090',
      apiKey: 'sk-rock-test',
    })

    expect(checklist.botId).toBe('agent-bot-C')
    expect(checklist.providerId).toBe('rock-agent-bot-c')
    expect(checklist.displayName).toBe('客服助手')
    expect(checklist.baseUrl).toBe('http://127.0.0.1:4090/v1/bots/agent-bot-C')
    expect(checklist.protocol).toBe(RELAY_PROTOCOL)
    expect(checklist.apiKey).toBe('sk-rock-test')
    expect(checklist.modelId).toBe('gpt-5')
    expect(checklist.modelName).toBe('gpt-5/客服助手')
  })

  it('strips a trailing slash from the relay origin before appending the bot path', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', 'x', 'm', {
      baseUrl: 'http://127.0.0.1:4090/',
      apiKey: 'k',
    })

    expect(checklist.baseUrl).toBe('http://127.0.0.1:4090/v1/bots/agent-bot-C')
  })
})

describe('providerIdFor', () => {
  it('lowercases and hyphenates the agent bot id', () => {
    expect(providerIdFor('Agent-Bot_C')).toBe('rock-agent-bot-c')
  })

  it('falls back to a stable id when the input sanitizes to empty', () => {
    expect(providerIdFor('___')).toBe('rock-bot')
  })
})
