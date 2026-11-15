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

  it('validates and persists a key, exposing its identity', async () => {
    const service = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async key => key === 'sk-valid' ? { clientId: 'client-1', employeeId: 'emp-1' } : null,
    })
    const identity = await service.addKey('  sk-valid  ')
    expect(identity).toEqual({ clientId: 'client-1', employeeId: 'emp-1' })
    expect(service.getIdentity()).toEqual({ clientId: 'client-1', employeeId: 'emp-1' })

    // Persisted record survives a fresh service over the same file.
    const reloaded = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async () => null,
    })
    await reloaded.load()
    expect(reloaded.getIdentity()).toEqual({ clientId: 'client-1', employeeId: 'emp-1' })
  })

  it('rejects an empty or invalid key', async () => {
    const service = new ConnectorKeyService({
      keyPath: join(dir, 'connector-key.json'),
      resolve: async () => null,
    })
    await expect(service.addKey('   ')).rejects.toThrow('non-empty')
    await expect(service.addKey('sk-invalid')).rejects.toThrow('invalid connector key')
  })
})
