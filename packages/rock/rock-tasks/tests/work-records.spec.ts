import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TaskWorkRecordStore } from '../src/work-records.ts'

/** Minimal SessionEvent stand-in carrying only the fields the store reads. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as SessionEvent
}

describe('TaskWorkRecordStore', () => {
  it('attributes tool events to the linked task and ignores non-tool events', () => {
    const store = new TaskWorkRecordStore()
    store.linkSession('s1', 'task-1')
    store.record('s1', event('tool/call', { name: 'bash', arguments: '{}', step: 0 }))
    store.record('s1', event('tool/result', { message: { toolCallId: 'c1', isError: false }, step: 0 }))
    store.record('s1', event('assistant/message', {}))

    const records = store.list('task-1')
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ type: 'tool.call', toolId: 'bash' })
    expect(records[1]).toMatchObject({ type: 'tool.result', toolId: 'c1', ok: true })
  })

  it('ignores sessions not linked to a task', () => {
    const store = new TaskWorkRecordStore()
    store.record('unknown', event('tool/call', { name: 'bash', arguments: '{}', step: 0 }))
    expect(store.list('task-1')).toEqual([])
  })

  it('captures step and turn events for the linked task', () => {
    const store = new TaskWorkRecordStore()
    store.linkSession('s1', 'task-1')
    store.record('s1', event('step/start', { turn: 1, step: 1 }))
    store.record('s1', event('step/end', { turn: 1, step: 1 }))
    store.record('s1', event('turn/start', { turn: 1 }))
    store.record('s1', event('turn/end', { turn: 1, reason: 'tool-calls' }))

    const records = store.list('task-1')
    expect(records).toHaveLength(4)
    expect(records[0]).toMatchObject({ type: 'step.start', turn: 1, stepId: 1 })
    expect(records[1]).toMatchObject({ type: 'step.end', turn: 1, stepId: 1 })
    expect(records[2]).toMatchObject({ type: 'turn.start', turn: 1 })
    expect(records[3]).toMatchObject({ type: 'turn.end', turn: 1, reason: 'tool-calls' })
  })

  it('persists records to a file and replays them across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    const file = join(dir, 'records.jsonl')
    try {
      const store = new TaskWorkRecordStore(file)
      store.linkSession('s1', 'task-1')
      store.record('s1', event('tool/call', { name: 'bash', arguments: '{}', step: 0 }))

      const revived = new TaskWorkRecordStore(file)
      revived.replay()
      expect(revived.list('task-1')).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
