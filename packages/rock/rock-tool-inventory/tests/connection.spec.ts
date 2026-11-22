import { describe, expect, it } from 'vitest'
import { backfillConnectionPatch, normalizeConnection, normalizeConnectionConfig } from '../src/connection.ts'

describe('normalizeConnectionConfig', () => {
  it('keeps non-empty fields and a known clientType', () => {
    expect(normalizeConnectionConfig({
      url: 'http://127.0.0.1:3080',
      token: 'SECRET',
      clientType: 'tui',
      rootDir: '~/.codex',
      startupCommand: 'codex app-server start',
    })).toEqual({
      url: 'http://127.0.0.1:3080',
      token: 'SECRET',
      clientType: 'tui',
      rootDir: '~/.codex',
      startupCommand: 'codex app-server start',
    })
  })

  it('drops empty strings and an absent clientType', () => {
    expect(normalizeConnectionConfig({
      url: '',
      token: '',
      clientType: undefined,
      rootDir: '',
      startupCommand: '',
    })).toEqual({})
  })
})

describe('normalizeConnection', () => {
  it('parses non-empty fields and a known clientType', () => {
    expect(normalizeConnection({ url: 'http://x', token: 't', clientType: 'gui', rootDir: '/r', startupCommand: 's' }))
      .toEqual({ url: 'http://x', token: 't', clientType: 'gui', rootDir: '/r', startupCommand: 's' })
  })

  it('drops unknown clientType values and empty strings', () => {
    expect(normalizeConnection({ url: 'http://x', token: '', clientType: 'web', rootDir: '', startupCommand: '' }))
      .toEqual({ url: 'http://x' })
  })

  it('returns undefined for a non-object or an all-empty object', () => {
    expect(normalizeConnection('nope')).toBeUndefined()
    expect(normalizeConnection({ url: '', token: '' })).toBeUndefined()
  })
})

describe('backfillConnectionPatch', () => {
  it('fills empty fields without overwriting existing values', () => {
    expect(backfillConnectionPatch(
      { token: 'SECRET', clientType: 'gui' },
      { id: 'dsh', clientType: 'tui', rootDir: '/r', startupCommand: 's' },
    )).toEqual({ token: 'SECRET', clientType: 'gui', rootDir: '/r', startupCommand: 's' })
  })

  it('returns undefined when nothing changes', () => {
    expect(backfillConnectionPatch(
      { clientType: 'gui', rootDir: '/r', startupCommand: 's' },
      { id: 'dsh', clientType: 'tui', rootDir: '/other', startupCommand: 'x' },
    )).toBeUndefined()
  })
})
