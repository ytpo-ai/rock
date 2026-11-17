import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Heartbeat } from '../src/heartbeat.ts'

describe('Heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('beats immediately on start and once per interval, then stops', async () => {
    const post = vi.fn<(url: string, key: string) => Promise<void>>().mockResolvedValue(undefined)
    const heartbeat = new Heartbeat({
      intervalMs: 1000,
      resolve: () => ({ baseUrl: 'http://gw.test', key: 'sk-x' }),
      post,
    })

    heartbeat.start()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]![0]).toBe('http://gw.test/v1/connectors/heartbeat')
    expect(post.mock.calls[0]![1]).toBe('sk-x')

    await vi.advanceTimersByTimeAsync(3000)
    expect(post).toHaveBeenCalledTimes(4)

    heartbeat.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(post).toHaveBeenCalledTimes(4)
  })

  it('skips beating when resolve returns null', async () => {
    const post = vi.fn<(url: string, key: string) => Promise<void>>().mockResolvedValue(undefined)
    const heartbeat = new Heartbeat({ intervalMs: 1000, resolve: () => null, post })

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(post).not.toHaveBeenCalled()
    heartbeat.stop()
  })
})
