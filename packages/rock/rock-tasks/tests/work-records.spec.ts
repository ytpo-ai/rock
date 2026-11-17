import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TaskArchiveStore } from '../src/work-records.ts'
import type { TaskSummary } from '../src/types.ts'

/** Minimal SessionEvent stand-in carrying only the fields the store reads. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data } as SessionEvent
}

/** A TaskArchiveStore backed by a temp workspace root. */
function makeStore(root: string): TaskArchiveStore {
  return new TaskArchiveStore({
    resolvePath: (taskId, projectId) => projectId
      ? join(root, 'projects', projectId, 'tasks', `${taskId}.jsonl`)
      : join(root, 'tasks', `${taskId}.jsonl`),
    rootPath: () => root,
  })
}

/** A minimal task summary. */
function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    type: 'task',
    title: 'Title',
    description: 'Description',
    status: 'in-progress',
    executorId: 'bot-1',
    ...overrides,
  }
}

describe('TaskArchiveStore', () => {
  it('openTask writes a header, definition, and run.start line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.openTask(task(), 'bot-1', 's1')

      const path = join(dir, 'tasks', 'task-1.jsonl')
      const lines = readFileSync(path, 'utf8').trim().split('\n')
      expect(JSON.parse(lines[0]).type).toBe('task')
      expect(JSON.parse(lines[1]).type).toBe('task.definition')
      expect(JSON.parse(lines[2]).type).toBe('run.start')

      const records = store.list('task-1')
      expect(records.map(record => record.type)).toEqual(['task.definition', 'run.start'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('attributes tool events to the opened task and reads them from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.openTask(task(), 'bot-1', 's1')
      store.record('s1', event('tool/call', { name: 'bash', arguments: '{}', step: 0 }))
      store.record('s1', event('tool/result', { message: { toolCallId: 'c1', isError: false }, step: 0 }))
      store.record('s1', event('assistant/message', {
        turn: 1,
        step: 0,
        message: { content: [{ type: 'text', text: 'hi' }] },
        usage: { inputTokens: 1, outputTokens: 2 },
      }))

      const records = store.list('task-1')
      const types = records.map(record => record.type)
      expect(types).toEqual(['task.definition', 'run.start', 'tool.call', 'tool.result', 'assistant.message'])
      const assistant = records[4]
      expect(assistant.text).toBe('hi')
      expect(assistant.usage).toEqual({ inputTokens: 1, outputTokens: 2 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('ignores sessions not linked to a task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.record('unknown', event('tool/call', { name: 'bash', arguments: '{}', step: 0 }))
      expect(store.list('task-1')).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('routes project tasks under projects/<projectId>/tasks/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.openTask(task({ projectId: 'proj-a' }), 'bot-1', 's1')
      expect(existsSync(join(dir, 'projects', 'proj-a', 'tasks', 'task-1.jsonl'))).toBe(true)
      expect(store.list('task-1')).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes a receipt once via ensureReceipt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.openTask(task(), 'bot-1', 's1')
      store.ensureReceipt('task-1', { outcome: 'success', summary: 'done' })
      store.ensureReceipt('task-1', { outcome: 'failed', summary: 'again' })

      const records = store.list('task-1')
      const receipts = records.filter(record => record.type === 'task.receipt')
      expect(receipts).toHaveLength(1)
      expect(receipts[0].data).toMatchObject({ outcome: 'success', summary: 'done' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replays and indexes archives across restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-tasks-'))
    try {
      const store = makeStore(dir)
      store.openTask(task({ status: 'done', resolution: 'accepted' }), 'bot-1', 's1')
      store.writeReceipt('task-1', { outcome: 'success', summary: 'done' })

      const revived = makeStore(dir)
      revived.replay()
      const archived = revived.listArchived()
      expect(archived).toHaveLength(1)
      expect(archived[0]).toMatchObject({ id: 'task-1', status: 'done', resolution: 'accepted' })
      expect(archived[0].receipt).toMatchObject({ outcome: 'success' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
