import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { mapToM3 } from '../src/m3.ts'

function event(data: SessionEvent): SessionEvent {
  return { seq: 1 as never, time: Date.now(), ...data } as SessionEvent
}

describe('mapToM3', () => {
  it('maps tool/call to tool.call', () => {
    const mapped = mapToM3(event({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'bash', arguments: '{"cmd":"ls"}' },
    } as SessionEvent))
    expect(mapped.type).toBe('tool.call')
    expect(mapped.payload).toMatchObject({ toolId: 'bash', stepId: 1, args: { cmd: 'ls' } })
  })

  it('maps tool/result to tool.result with ok flag', () => {
    const mapped = mapToM3(event({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: 'call-1' as never, isError: false, content: [], source: { kind: 'tool', callId: 'call-1' as never } },
      },
    } as SessionEvent))
    expect(mapped.type).toBe('tool.result')
    expect(mapped.payload).toMatchObject({ toolId: 'call-1', ok: true, stepId: 1 })
  })

  it('maps assistant/message usage to llm.usage tokens', () => {
    const mapped = mapToM3(event({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 2 },
      },
    } as SessionEvent))
    expect(mapped.type).toBe('llm.usage')
    expect(mapped.payload.tokens).toMatchObject({ input: 10, output: 5, reasoning: 2 })
  })

  it('maps step/start and turn/end', () => {
    expect(mapToM3(event({ type: 'step/start', data: { turn: 1, step: 1 } } as SessionEvent))).toMatchObject({
      type: 'step.start',
      payload: { stepId: 1 },
    })
    expect(mapToM3(event({ type: 'turn/end', data: { turn: 1, reason: 'completed' } } as SessionEvent))).toMatchObject({
      type: 'run.complete',
      payload: { outcome: 'completed' },
    })
  })

  it('passes unknown event types through unchanged', () => {
    const mapped = mapToM3(event({ type: 'custom/thing', data: { a: 1 } } as SessionEvent))
    expect(mapped.type).toBe('custom/thing')
    expect(mapped.payload).toEqual({ a: 1 })
  })
})
