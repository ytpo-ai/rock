import { describe, expect, it, vi } from 'vitest'
import { probeServiceLiveness } from '../src/service-probe.ts'

const resolvingFetch = () => vi.fn(async () => ({})) as unknown as typeof fetch
const rejectingFetch = () => vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch

describe('probeServiceLiveness', () => {
  describe('codex (unix socket)', () => {
    it('reports online when the socket connects', async () => {
      const connectSocket = vi.fn(async () => {})
      const online = await probeServiceLiveness('codex', undefined, 100, {
        connectSocket,
        homeDir: () => '/home/u',
        env: {},
      })
      expect(online).toBe(true)
      expect(connectSocket).toHaveBeenCalledWith('/home/u/.codex/app-server-control/app-server-control.sock', 100)
    })

    it('reports offline when the socket connect fails', async () => {
      const connectSocket = vi.fn(async () => { throw new Error('ECONNREFUSED') })
      const online = await probeServiceLiveness('codex', undefined, 100, { connectSocket, homeDir: () => '/home/u', env: {} })
      expect(online).toBe(false)
    })

    it('prefers connection.url as the socket path', async () => {
      const connectSocket = vi.fn(async () => {})
      const online = await probeServiceLiveness('codex', { url: '/custom/sock' }, 100, { connectSocket, homeDir: () => '/home/u', env: {} })
      expect(online).toBe(true)
      expect(connectSocket).toHaveBeenCalledWith('/custom/sock', 100)
    })

    it('honors CODEX_HOME', async () => {
      const connectSocket = vi.fn(async () => {})
      await probeServiceLiveness('codex', undefined, 100, { connectSocket, homeDir: () => '/home/u', env: { CODEX_HOME: '/opt/codex' } })
      expect(connectSocket).toHaveBeenCalledWith('/opt/codex/app-server-control/app-server-control.sock', 100)
    })
  })

  describe('opencode (http)', () => {
    it('reports online when the server responds', async () => {
      const fetchFn = resolvingFetch()
      const online = await probeServiceLiveness('opencode', { url: 'http://127.0.0.1:4096' }, 100, { fetch: fetchFn, homeDir: () => '/home/u', env: {} })
      expect(online).toBe(true)
    })

    it('discovers the url from the service file', async () => {
      const fetchFn = resolvingFetch()
      const online = await probeServiceLiveness('opencode', undefined, 100, {
        fetch: fetchFn,
        homeDir: () => '/home/u',
        env: {},
        existsFile: path => path === '/home/u/.local/state/opencode/service.json',
        readFile: () => JSON.stringify({ url: 'http://127.0.0.1:4096', password: 'x' }),
      })
      expect(online).toBe(true)
      expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:4096', expect.objectContaining({ method: 'GET' }))
    })

    it('reports offline when the discovery file is missing', async () => {
      const online = await probeServiceLiveness('opencode', undefined, 100, { existsFile: () => false, homeDir: () => '/home/u', env: {} })
      expect(online).toBe(false)
    })

    it('reports offline when the fetch fails', async () => {
      const online = await probeServiceLiveness('opencode', { url: 'http://127.0.0.1:4096' }, 100, { fetch: rejectingFetch(), homeDir: () => '/home/u', env: {} })
      expect(online).toBe(false)
    })
  })

  describe('dsh (http)', () => {
    it('reports online when the server responds at the default url', async () => {
      const fetchFn = resolvingFetch()
      const online = await probeServiceLiveness('dsh', undefined, 100, { fetch: fetchFn, env: {} })
      expect(online).toBe(true)
      expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:3080', expect.objectContaining({ method: 'GET' }))
    })

    it('prefers connection.url', async () => {
      const fetchFn = resolvingFetch()
      await probeServiceLiveness('dsh', { url: 'http://localhost:9999' }, 100, { fetch: fetchFn, env: {} })
      expect(fetchFn).toHaveBeenCalledWith('http://localhost:9999', expect.objectContaining({ method: 'GET' }))
    })

    it('honors ROCK_DSH_REMOTE_URL', async () => {
      const fetchFn = resolvingFetch()
      await probeServiceLiveness('dsh', undefined, 100, { fetch: fetchFn, env: { ROCK_DSH_REMOTE_URL: 'http://localhost:9999' } })
      expect(fetchFn).toHaveBeenCalledWith('http://localhost:9999', expect.objectContaining({ method: 'GET' }))
    })

    it('reports offline when the fetch fails', async () => {
      const online = await probeServiceLiveness('dsh', undefined, 100, { fetch: rejectingFetch(), env: {} })
      expect(online).toBe(false)
    })
  })

  it('reports offline for tools without a resident service', async () => {
    expect(await probeServiceLiveness('pi', undefined, 100, {})).toBe(false)
    expect(await probeServiceLiveness('claude-code', undefined, 100, {})).toBe(false)
  })
})
