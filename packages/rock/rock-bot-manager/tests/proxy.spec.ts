import { describe, expect, it } from 'vitest'
import { buildLlmProxyChecklist, defaultWireProtocol, isWireProtocol, providerIdFor, RELAY_PROTOCOL } from '../src/proxy.ts'

describe('buildLlmProxyChecklist', () => {
  it('derives the provider id, base URL, protocol, key, and model fields', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', '客服助手', 'gpt-5', {
      baseUrl: 'http://127.0.0.1:4090',
      apiKey: 'sk-rock-test',
    }, 'chat-completions')

    expect(checklist.botId).toBe('agent-bot-C')
    expect(checklist.providerId).toBe('rock-agent-bot-c')
    expect(checklist.displayName).toBe('客服助手')
    expect(checklist.baseUrl).toBe('http://127.0.0.1:4090/v1/bots/agent-bot-C')
    expect(checklist.protocol).toBe(RELAY_PROTOCOL)
    expect(checklist.wireProtocol).toBe('chat-completions')
    expect(checklist.apiKey).toBe('sk-rock-test')
    expect(checklist.modelId).toBe('gpt-5')
    expect(checklist.modelName).toBe('gpt-5/客服助手')
  })

  it('derives the display protocol from the selected wire protocol', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', 'x', 'm', {
      baseUrl: 'http://127.0.0.1:4090',
      apiKey: 'k',
    }, 'anthropic-messages')

    expect(checklist.wireProtocol).toBe('anthropic-messages')
    expect(checklist.protocol).toBe('Anthropic Messages')
  })

  it('strips a trailing slash from the relay origin before appending the bot path', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', 'x', 'm', {
      baseUrl: 'http://127.0.0.1:4090/',
      apiKey: 'k',
    }, 'chat-completions')

    expect(checklist.baseUrl).toBe('http://127.0.0.1:4090/v1/bots/agent-bot-C')
  })

  it('carries the supported protocols when provided', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', 'x', 'm', {
      baseUrl: 'http://127.0.0.1:4090',
      apiKey: 'k',
    }, 'chat-completions', ['anthropic-messages', 'chat-completions'])

    expect(checklist.supportedProtocols).toEqual(['anthropic-messages', 'chat-completions'])
  })

  it('omits supported protocols when none are provided', () => {
    const checklist = buildLlmProxyChecklist('agent-bot-C', 'x', 'm', {
      baseUrl: 'http://127.0.0.1:4090',
      apiKey: 'k',
    }, 'chat-completions')

    expect(checklist.supportedProtocols).toBeUndefined()
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

describe('wire protocol helpers', () => {
  it('recognizes the three wire protocols and rejects unknown values', () => {
    expect(isWireProtocol('chat-completions')).toBe(true)
    expect(isWireProtocol('openai-responses')).toBe(true)
    expect(isWireProtocol('anthropic-messages')).toBe(true)
    expect(isWireProtocol('grpc')).toBe(false)
  })

  it('defaults to chat-completions when supported, else the first supported, else chat-completions', () => {
    expect(defaultWireProtocol(undefined)).toBe('chat-completions')
    expect(defaultWireProtocol([])).toBe('chat-completions')
    expect(defaultWireProtocol(['openai-responses', 'chat-completions'])).toBe('chat-completions')
    expect(defaultWireProtocol(['anthropic-messages', 'openai-responses'])).toBe('anthropic-messages')
    expect(defaultWireProtocol(['grpc'])).toBe('chat-completions')
  })
})
