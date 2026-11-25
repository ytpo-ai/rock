import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServiceStatusPoller } from '../src/service-status.ts'
import type { ToolDescriptor } from '../src/types.ts'

const tools: readonly ToolDescriptor[] = [
  { id: 'codex', command: 'codex' },
  { id: 'opencode', command: 'opencode' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ServiceStatusPoller', () => {
  it('probes every tool and reports the freshest statuses in order', async () => {
    const probe = vi.fn(async (toolId: string) => toolId === 'codex')
    const onResult = vi.fn()
    const poller = new ServiceStatusPoller({
      intervalMs: 1000,
      timeoutMs: 100,
      tools,
      connections: () => ({}),
      onResult,
      probe,
    })

    const statuses = await poller.poll()

    expect(statuses.map(status => [status.id, status.running])).toEqual([['codex', true], ['opencode', false]])
    expect(statuses.every(status => status.lastCheckedAt.length > 0)).toBe(true)
    expect(onResult).toHaveBeenCalledWith(statuses)
    expect(probe).toHaveBeenCalledWith('codex', undefined, 100)
    expect(probe).toHaveBeenCalledWith('opencode', undefined, 100)
  })

  it('treats a throwing probe as offline and still reports', async () => {
    const probe = vi.fn(async () => { throw new Error('boom') })
    const onResult = vi.fn()
    const poller = new ServiceStatusPoller({ intervalMs: 1000, timeoutMs: 100, tools, connections: () => ({}), onResult, probe })

    const statuses = await poller.poll()

    expect(statuses.map(status => status.running)).toEqual([false, false])
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('ignores a throwing consumer without failing the round', async () => {
    const onResult = vi.fn(() => { throw new Error('consumer') })
    const poller = new ServiceStatusPoller({
      intervalMs: 1000,
      timeoutMs: 100,
      tools,
      connections: () => ({}),
      onResult,
      probe: async () => false,
    })

    const statuses = await poller.poll()

    expect(statuses).toHaveLength(2)
  })

  it('manages its interval on start/stop', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const poller = new ServiceStatusPoller({
      intervalMs: 1000,
      timeoutMs: 100,
      tools,
      connections: () => ({}),
      onResult: () => {},
      probe: async () => false,
    })

    poller.start()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    poller.stop()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })
})
