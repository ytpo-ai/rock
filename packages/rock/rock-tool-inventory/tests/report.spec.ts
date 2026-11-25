import { describe, expect, it, vi } from 'vitest'
import { postToolStatus } from '../src/report.ts'

describe('postToolStatus', () => {
  it('POSTs the snapshot with the connector key bearer', async () => {
    const url = 'http://cloud/v1/connectors/tool-status'
    const key = 'sk-connector-x'
    const tools = [{ id: 'codex', running: true, lastCheckedAt: '2026-11-25T00:00:00.000Z' }]
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true } as Response))

    await postToolStatus(url, key, tools, mockFetch as unknown as typeof fetch)

    expect(mockFetch).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tools }),
    })
  })

  it('throws on a non-ok response', async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: false, status: 401 } as Response))
    await expect(postToolStatus('http://cloud/v1/connectors/tool-status', 'key', [], mockFetch as unknown as typeof fetch)).rejects.toThrow('401')
  })
})
