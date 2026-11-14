import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayReporter } from '../src/reporter.ts'
import type { RockReportEvent } from '../src/types.ts'

function event(eventId: string): RockReportEvent {
  return {
    eventId,
    sessionId: 's1',
    type: 'tool.call',
    timestamp: '2026-11-14T00:00:00.000Z',
    payload: { toolId: 'bash' },
    connectorClientId: 'rock-a',
    relayed: true,
  }
}

describe('GatewayReporter', () => {
  let dir: string
  let post: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gateway-reporter-'))
    post = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function reporter(bufferPath?: string): GatewayReporter {
    return new GatewayReporter({
      gatewayUrl: 'http://gateway.test/report',
      connectorClientId: 'rock-a',
      ...bufferPath === undefined ? {} : { bufferPath },
      maxBatchSize: 10,
      flushIntervalMs: 60_000,
      post,
    })
  }

  it('flushes a batch and clears the buffer on success', async () => {
    const buffer = join(dir, 'events.jsonl')
    const rep = reporter(buffer)
    rep.enqueue(event('1'))
    rep.enqueue(event('2'))
    await rep.flush()

    expect(post).toHaveBeenCalledTimes(1)
    const [, batch] = post.mock.calls[0]
    expect(batch).toHaveLength(2)
    expect(rep.pending).toBe(0)
  })

  it('keeps events buffered when delivery fails and replays them on restart', async () => {
    const buffer = join(dir, 'events.jsonl')
    post.mockRejectedValueOnce(new Error('offline'))
    const rep = reporter(buffer)
    rep.enqueue(event('1'))
    rep.enqueue(event('2'))
    await rep.flush()
    expect(rep.pending).toBe(2)

    // Simulate a restart: a fresh reporter replays the persisted buffer.
    const revived = reporter(buffer)
    await revived.replay()
    expect(revived.pending).toBe(2)
  })
})
