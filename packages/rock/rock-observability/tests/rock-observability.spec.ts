import { describe, expect, it } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { fillForwardLog, type IdentityLike } from '../src/relay-log.ts'
import type { RelayForwardLog } from '../src/types.ts'
import { RockObservabilityService } from '../src/service.ts'

/** Minimal Session stand-in for the fold, which only reads `session.id`. */
function session(id: string): Session {
  return { id } as Session
}

/** Minimal SessionEvent stand-in carrying only the fields the fold reads. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as SessionEvent
}

describe('RockObservabilityService', () => {
  it('folds turns, steps, and output tokens per session', () => {
    const service = new RockObservabilityService()
    const s = session('session-1')

    service.observe(s, event('step/start', { turn: 1, step: 1 }))
    service.observe(s, event('assistant/message', { turn: 1, step: 1, usage: { outputTokens: 42 } }))
    service.observe(s, event('step/end', { turn: 1, step: 1 }))
    service.observe(s, event('step/start', { turn: 1, step: 2 }))
    service.observe(s, event('assistant/message', { turn: 1, step: 2, usage: { outputTokens: 8 } }))
    service.observe(s, event('step/end', { turn: 1, step: 2 }))

    expect(service.rows()).toEqual([{ sessionId: 'session-1', turns: 1, steps: 2, outputTokens: 50 }])
  })

  it('counts one turn per distinct turn number', () => {
    const service = new RockObservabilityService()
    const s = session('session-1')

    service.observe(s, event('step/end', { turn: 1, step: 1 }))
    service.observe(s, event('step/end', { turn: 2, step: 1 }))
    service.observe(s, event('step/end', { turn: 2, step: 2 }))

    expect(service.rowOf('session-1')).toMatchObject({ turns: 2, steps: 3 })
  })

  it('ignores events without output-token usage and keeps sessions separate', () => {
    const service = new RockObservabilityService()

    service.observe(session('a'), event('assistant/message', { turn: 1, step: 1, usage: { outputTokens: 10 } }))
    service.observe(session('b'), event('assistant/message', { turn: 1, step: 1 }))
    service.observe(session('a'), event('step/end', { turn: 1, step: 1 }))

    expect(service.rows()).toEqual([
      { sessionId: 'a', turns: 1, steps: 1, outputTokens: 10 },
      { sessionId: 'b', turns: 0, steps: 0, outputTokens: 0 },
    ])
  })
})

describe('fillForwardLog', () => {
  const identity: IdentityLike = {
    getClaims: () => [{ agentBotId: 'bot-a', name: 'Bot A', model: { model: 'gpt-5' } }],
    getAssistants: () => [],
    toolBindingOf: id => id === 'bot-a' ? 'codex' : undefined,
  }

  it('fills missing bot name, bound model, and tool from the identity', () => {
    const log: RelayForwardLog = { timestamp: 't', agentBotId: 'bot-a', pathSuffix: '/chat/completions', mappedModel: 'seagull-relay' }
    expect(fillForwardLog(log, identity)).toEqual({
      timestamp: 't',
      agentBotId: 'bot-a',
      pathSuffix: '/chat/completions',
      mappedModel: 'seagull-relay',
      botName: 'Bot A',
      boundModel: 'gpt-5',
      toolType: 'codex',
    })
  })

  it('keeps values the record already carries (write-time values win)', () => {
    const log: RelayForwardLog = {
      timestamp: 't',
      agentBotId: 'bot-a',
      pathSuffix: '/chat/completions',
      mappedModel: 'seagull-relay',
      botName: 'Old Name',
      toolType: 'pi',
    }
    expect(fillForwardLog(log, identity)).toEqual({
      timestamp: 't',
      agentBotId: 'bot-a',
      pathSuffix: '/chat/completions',
      mappedModel: 'seagull-relay',
      botName: 'Old Name',
      toolType: 'pi',
      boundModel: 'gpt-5',
    })
  })

  it('returns the record unchanged when the identity is absent', () => {
    const log: RelayForwardLog = { timestamp: 't', agentBotId: 'bot-a', pathSuffix: '/chat/completions', mappedModel: 'seagull-relay' }
    expect(fillForwardLog(log, undefined)).toBe(log)
  })
})
