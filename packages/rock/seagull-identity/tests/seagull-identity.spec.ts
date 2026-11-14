import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeagullIdentityService } from '../src/service.ts'

const CLAIMS = [
  { agentBotId: 'agent-bot-C', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
  { agentBotId: 'agent-bot-D', employeeId: 'employee-a', claimedAt: '2026-11-14T00:00:00.000Z' },
]

describe('SeagullIdentityService', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'seagull-identity-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('renders one agent-loop entry per claimed bot and resolves bindings', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')

    const service = new SeagullIdentityService({
      claimFile,
      bindings: { 'agent-bot-C': 'codex' },
      defaultToolType: 'dsh',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
    })
    await service.sync()

    expect(service.renderAgents()).toEqual([
      { id: 'agent-bot-C', provider: 'seagull-cloud', model: 'seagull-relay' },
      { id: 'agent-bot-D', provider: 'seagull-cloud', model: 'seagull-relay' },
    ])
    expect(service.toolBindingOf('agent-bot-C')).toBe('codex')
    expect(service.toolBindingOf('agent-bot-D')).toBe('dsh')
  })

  it('syncs from the gateway and falls back to the local file on failure', async () => {
    const claimFile = join(dir, 'claims.json')
    await writeFile(claimFile, JSON.stringify(CLAIMS), 'utf8')
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error('offline'))

    const service = new SeagullIdentityService({
      gatewayUrl: 'http://gateway.test/claims',
      employeeId: 'employee-a',
      claimFile,
      bindings: {},
      defaultToolType: 'codex',
      defaultProvider: 'seagull-cloud',
      defaultModel: 'seagull-relay',
      fetchJson,
    })
    await service.sync()

    expect(fetchJson).toHaveBeenCalledWith('http://gateway.test/claims?employeeId=employee-a')
    expect(service.getClaims()).toHaveLength(2)
  })
})
