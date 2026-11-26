import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RotatingJsonlLog } from '../src/index.ts'

interface Entry {
  timestamp: string
  agentBotId: string
}

/** One log entry carrying the paging key every case filters on. */
function entry(timestamp: string, agentBotId = 'a'): Entry {
  return { timestamp, agentBotId }
}

describe('RotatingJsonlLog', () => {
  it('bounds the in-memory ring and returns newest-first', () => {
    const store = new RotatingJsonlLog<Entry>({ path: join(tmpdir(), 'rock-log-ring.jsonl'), maxEntries: 3 })
    for (const timestamp of ['1', '2', '3', '4']) store.append(entry(timestamp))
    expect(store.recent().map(item => item.timestamp)).toEqual(['4', '3', '2'])
  })

  it('rotates fragments when the active file exceeds the size limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const store = new RotatingJsonlLog<Entry>({ path: join(dir, 'log.jsonl'), maxFileBytes: 100, maxFragments: 2 })
    for (let index = 0; index < 20; index++) store.append(entry(String(index)))
    await store.flush()
    const files = await readdir(dir)
    // Active file plus at most maxFragments(2) rotated fragments.
    expect(files.length).toBeGreaterThan(0)
    expect(files.length).toBeLessThanOrEqual(3)
    await rm(dir, { recursive: true, force: true })
  })

  it('pages the full history newest-first across the active file and fragments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const store = new RotatingJsonlLog<Entry>({ path: join(dir, 'log.jsonl'), maxFileBytes: 80, maxFragments: 100 })
    for (let index = 0; index < 5; index++) store.append(entry(String(index)))
    await store.flush()

    await expect(store.count()).resolves.toBe(5)
    await expect(store.page(0, 2)).resolves.toEqual([entry('4'), entry('3')])
    await expect(store.page(4, 2)).resolves.toEqual([entry('0')])
    await rm(dir, { recursive: true, force: true })
  })

  it('scans existing fragments on load so paging survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const path = join(dir, 'log.jsonl')
    const store = new RotatingJsonlLog<Entry>({ path, maxFileBytes: 80, maxFragments: 100 })
    for (let index = 0; index < 5; index++) store.append(entry(String(index)))
    await store.flush()

    const reloaded = new RotatingJsonlLog<Entry>({ path, maxFileBytes: 80, maxFragments: 100 })
    await reloaded.load()
    await expect(reloaded.count()).resolves.toBe(5)

    reloaded.append(entry('5'))
    await reloaded.flush()
    await expect(reloaded.count()).resolves.toBe(6)
    await rm(dir, { recursive: true, force: true })
  })

  it('scopes paging and counting to one key and lists the distinct keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const store = new RotatingJsonlLog<Entry>({
      path: join(dir, 'log.jsonl'),
      keyOf: item => item.agentBotId,
    })
    store.append(entry('1', 'bot-a'))
    store.append(entry('2', 'bot-b'))
    store.append(entry('3', 'bot-a'))
    await store.flush()

    await expect(store.count('bot-a')).resolves.toBe(2)
    await expect(store.page(0, 10, 'bot-a')).resolves.toEqual([entry('3', 'bot-a'), entry('1', 'bot-a')])
    await expect(store.page(0, 10, 'bot-b')).resolves.toEqual([entry('2', 'bot-b')])
    // Newest-first history is 3(bot-a), 2(bot-b), 1(bot-a), so bot-a is seen first.
    await expect(store.keys()).resolves.toEqual(['bot-a', 'bot-b'])
    await rm(dir, { recursive: true, force: true })
  })

  it('reports no keys and ignores a key scope when the store carries no key accessor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const store = new RotatingJsonlLog<Entry>({ path: join(dir, 'log.jsonl') })
    store.append(entry('1'))
    await store.flush()

    await expect(store.keys()).resolves.toEqual([])
    await expect(store.count('a')).resolves.toBe(1)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a failed write through onError without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-log-'))
    const blocker = join(dir, 'blocked')
    await writeFile(blocker, 'not a directory', 'utf8')
    const failures: unknown[] = []
    const store = new RotatingJsonlLog<Entry>({
      path: join(blocker, 'log.jsonl'),
      onError: error => failures.push(error),
    })

    store.append(entry('1'))
    await store.flush()

    expect(failures).toHaveLength(1)
    // The ring still holds the entry, so recent reads stay useful when disk fails.
    expect(store.recent()).toEqual([entry('1')])
    await rm(dir, { recursive: true, force: true })
  })
})
