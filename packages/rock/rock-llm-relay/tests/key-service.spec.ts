import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RelayKeyService } from '../src/key-service.ts'

describe('RelayKeyService', () => {
  const dirs: string[] = []

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'rock-llm-relay-'))
    dirs.push(dir)
    return dir
  }

  afterEach(async () => {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('generates and persists a fresh key when the file is absent', async () => {
    const dir = await tempDir()
    const keyPath = join(dir, 'relay-key.json')
    const service = new RelayKeyService(keyPath)

    expect(service.generatedOnBoot).toBe(true)
    expect(service.getKey()).toMatch(/^sk-rock-[0-9a-f]{48}$/)

    await service.persist()
    const record = JSON.parse(await readFile(keyPath, 'utf8')) as { key: string }
    expect(record.key).toBe(service.getKey())
  })

  it('reuses the persisted key on the next boot', async () => {
    const dir = await tempDir()
    const keyPath = join(dir, 'relay-key.json')
    const first = new RelayKeyService(keyPath)
    await first.persist()

    const second = new RelayKeyService(keyPath)
    expect(second.generatedOnBoot).toBe(false)
    expect(second.getKey()).toBe(first.getKey())
  })

  it('ignores a malformed key file and regenerates', async () => {
    const dir = await tempDir()
    const keyPath = join(dir, 'relay-key.json')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(keyPath, '{ not json', 'utf8'))

    const service = new RelayKeyService(keyPath)
    expect(service.generatedOnBoot).toBe(true)
    expect(service.getKey()).toMatch(/^sk-rock-[0-9a-f]{48}$/)
  })
})
