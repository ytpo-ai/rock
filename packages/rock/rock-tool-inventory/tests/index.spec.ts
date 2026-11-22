import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { EventEmitter } from 'node:events'
import RockToolInventoryController from '../src/index.ts'

type FakeWatcher = EventEmitter & { close: () => Promise<void> }

const fakeInstances = vi.hoisted(() => [] as Array<{ path: string; options: unknown; watcher: FakeWatcher }>)

// chokidar is the nondeterministic OS boundary: faking it lets these tests
// drive the reload pipeline deterministically.
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWatcher extends EventEmitter {
    close = vi.fn(() => Promise.resolve())
  }
  return {
    watch: vi.fn((path: string, options: unknown) => {
      const watcher = new FakeWatcher()
      fakeInstances.push({ path, options, watcher })
      return watcher
    }),
  }
})

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  fakeInstances.length = 0
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rock-tool-inventory-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

interface Booted {
  ctx: Context
  controller: RockToolInventoryController
  dispose: () => Promise<void>
}

async function boot(connectionsPath: string): Promise<Booted> {
  const ctx = new Context()
  const fiber = ctx.plugin(RockToolInventoryController, {
    connectionsPath,
    statePath: join(dirname(connectionsPath), 'tool-inventory.json'),
  })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return { ctx, controller: ctx.rockToolInventory, dispose: () => fiber.dispose() }
}

describe('connection config', () => {
  it('persists and reads the extended fields', async () => {
    const dir = await tempDir()
    const connectionsPath = join(dir, 'tool-connections.json')
    const { controller } = await boot(connectionsPath)

    controller.setConnectionConfig('opencode', {
      clientType: 'gui',
      rootDir: '~/.local/state/opencode',
      startupCommand: 'opencode serve',
    })

    expect(controller.connectionConfig('opencode')).toEqual({
      clientType: 'gui',
      rootDir: '~/.local/state/opencode',
      startupCommand: 'opencode serve',
    })
    expect(JSON.parse(await readFile(connectionsPath, 'utf8'))).toEqual({
      opencode: { clientType: 'gui', rootDir: '~/.local/state/opencode', startupCommand: 'opencode serve' },
    })
  })

  it('rejects a dsh connection without a token even with the new fields set', async () => {
    const dir = await tempDir()
    const { controller } = await boot(join(dir, 'tool-connections.json'))
    expect(() => { controller.setConnectionConfig('dsh', { clientType: 'tui', rootDir: '/dsh' }) })
      .toThrow('tool "dsh" requires a token')
  })

  it('clears an empty field on set', async () => {
    const dir = await tempDir()
    const connectionsPath = join(dir, 'tool-connections.json')
    await writeFile(connectionsPath, JSON.stringify({ opencode: { url: 'http://x', token: 't', clientType: 'gui' } }))
    const { controller } = await boot(connectionsPath)

    controller.setConnectionConfig('opencode', { url: 'http://x', token: '', clientType: undefined, rootDir: '' })

    expect(controller.connectionConfig('opencode')).toEqual({ url: 'http://x' })
  })
})

describe('connection hot reload', () => {
  it('reloads the connection config when the file changes', async () => {
    const dir = await tempDir()
    const connectionsPath = join(dir, 'tool-connections.json')
    await writeFile(connectionsPath, JSON.stringify({ dsh: { url: 'http://old', token: 'old-token' } }))
    const { controller } = await boot(connectionsPath)
    expect(controller.connectionConfig('dsh')).toEqual({ url: 'http://old', token: 'old-token' })

    await writeFile(connectionsPath, JSON.stringify({ dsh: { url: 'http://new', token: 'new-token', clientType: 'tui' } }))
    fakeInstances[0]!.watcher.emit('all', 'change', connectionsPath)
    await vi.waitFor(() => {
      expect(controller.connectionConfig('dsh')).toEqual({ url: 'http://new', token: 'new-token', clientType: 'tui' })
    })
  })

  it('keeps the previous config when the file turns malformed', async () => {
    const dir = await tempDir()
    const connectionsPath = join(dir, 'tool-connections.json')
    await writeFile(connectionsPath, JSON.stringify({ dsh: { token: 'keep' } }))
    const { controller } = await boot(connectionsPath)

    await writeFile(connectionsPath, '{broken')
    fakeInstances[0]!.watcher.emit('all', 'change', connectionsPath)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(controller.connectionConfig('dsh')).toEqual({ token: 'keep' })
  })

  it('closes the watcher on dispose', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'tool-connections.json'), '{}')
    const { dispose } = await boot(join(dir, 'tool-connections.json'))
    const watcher = fakeInstances[0]!.watcher
    await dispose()
    expect(watcher.close).toHaveBeenCalled()
  })
})
