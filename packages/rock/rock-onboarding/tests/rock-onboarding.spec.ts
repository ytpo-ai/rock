import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConnectorKeyService } from '../src/service.ts'

describe('ConnectorKeyService', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rock-onboarding-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('validates and persists a base URL + key, exposing its identity', async () => {
    const service = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async (baseUrl, key) => baseUrl === 'http://localhost:3000' && key === 'sk-valid'
        ? { clientId: 'client-1', employeeId: 'emp-1' }
        : null,
    })
    const identity = await service.addKey('  http://localhost:3000/  ', '  sk-valid  ')
    expect(identity).toEqual({ clientId: 'client-1', employeeId: 'emp-1' })
    expect(service.getRecord()).toMatchObject({ baseUrl: 'http://localhost:3000', employeeId: 'emp-1' })

    // Persisted record survives a fresh service over the same file.
    const reloaded = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async () => null,
    })
    await reloaded.load()
    expect(reloaded.getIdentity()).toEqual({ clientId: 'client-1', employeeId: 'emp-1' })
  })

  it('rejects an empty base URL or key, and an invalid key', async () => {
    const service = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async () => null,
    })
    await expect(service.addKey('   ', 'sk-valid')).rejects.toThrow('base URL')
    await expect(service.addKey('http://localhost:3000', '   ')).rejects.toThrow('non-empty')
    await expect(service.addKey('http://localhost:3000', 'sk-invalid')).rejects.toThrow('invalid connector key')
  })
})
