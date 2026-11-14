import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { mapToM3 } from '../src/m3.ts'

/** Build a minimal session-event fixture (branded seq/time are test-owned). */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: Date.now(), data } as unknown as SessionEvent
}

describe('mapToM3', () => {
  it('maps tool/call to tool.call', () => {
    const mapped = mapToM3(event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}' }))
    expect(mapped.type).toBe('tool.call')
    expect(mapped.payload).toMatchObject({ toolId: 'bash', stepId: 1, args: { cmd: 'ls' } })
  })

  it('maps tool/result to tool.result with ok flag', () => {
    const mapped = mapToM3(event('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'call-1', isError: false, content: [], source: { kind: 'tool', callId: 'call-1' } },
    }))
    expect(mapped.type).toBe('tool.result')
    expect(mapped.payload).toMatchObject({ toolId: 'call-1', ok: true, stepId: 1 })
  })

  it('maps assistant/message usage to llm.usage tokens', () => {
    const mapped = mapToM3(event('assistant/message', {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
      stream: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 2 },
    }))
    expect(mapped.type).toBe('llm.usage')
    expect(mapped.payload.tokens).toMatchObject({ input: 10, output: 5, reasoning: 2 })
  })

  it('maps step/start and turn/end', () => {
    expect(mapToM3(event('step/start', { turn: 1, step: 1 }))).toMatchObject({
      type: 'step.start',
      payload: { stepId: 1 },
    })
    expect(mapToM3(event('turn/end', { turn: 1, reason: 'completed' }))).toMatchObject({
      type: 'run.complete',
      payload: { outcome: 'completed' },
    })
  })

  it('passes unknown event types through unchanged', () => {
    const mapped = mapToM3(event('custom/thing', { a: 1 }))
    expect(mapped.type).toBe('custom/thing')
    expect(mapped.payload).toEqual({ a: 1 })
  })
})
