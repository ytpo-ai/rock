/**
 * Rock onboarding key store: persists the Seagull base URL and employee
 * connector key locally, and resolves a pasted key against that base URL.
 *
 * @module @rock/rock-onboarding/service
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectorIdentity, ConnectorKeyRecord } from './types.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface ConnectorKeyServiceOptions {
  /** Local JSON file persisting the connector key record. */
  keyPath: string
  /** Resolves a base URL + raw key to its client identity, or null when invalid. */
  resolve: (baseUrl: string, key: string) => Promise<ConnectorIdentity | null>
}

/** Persisted connector-key state plus resolution helpers. */
export class ConnectorKeyService {
  private record: ConnectorKeyRecord | null

  constructor(private readonly options: ConnectorKeyServiceOptions) {
    this.record = readRecord(options.keyPath)
  }

  /** The stored record, or null when no key has been added yet. */
  getRecord(): ConnectorKeyRecord | null {
    return this.record
  }

  /** The stored identity, or null when no key has been added yet. */
  getIdentity(): ConnectorIdentity | null {
    if (this.record === null) return null
    return { clientId: this.record.clientId, employeeId: this.record.employeeId }
  }

  /** Validate a base URL + pasted key, persist them, and return the resolved identity. */
  async addKey(baseUrl: string, key: string): Promise<ConnectorIdentity> {
    const trimmedBase = baseUrl.trim().replace(/\/+$/, '')
    const trimmedKey = key.trim()
    if (trimmedBase.length === 0) throw new Error('base URL must be non-empty')
    if (trimmedKey.length === 0) throw new Error('connector key must be non-empty')
    const identity = await this.options.resolve(trimmedBase, trimmedKey)
    if (identity === null) throw new Error('invalid connector key')
    this.record = { baseUrl: trimmedBase, key: trimmedKey, clientId: identity.clientId, employeeId: identity.employeeId }
    await persistRecord(this.options.keyPath, this.record)
    return identity
  }
}

/** Read a persisted key record synchronously, returning null for an absent or malformed file. */
function readRecord(keyPath: string): ConnectorKeyRecord | null {
  let raw: string
  try {
    raw = readFileSync(keyPath, 'utf8')
  } catch {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (!validRecord(parsed)) return null
  return parsed
}

/** Persist one key record atomically. */
async function persistRecord(keyPath: string, record: ConnectorKeyRecord): Promise<void> {
  await mkdir(dirname(keyPath), { recursive: true })
  const tmp = `${keyPath}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await rename(tmp, keyPath)
}

/** Whether an unknown value is a well-formed key record. */
function validRecord(value: unknown): value is ConnectorKeyRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.baseUrl === 'string' && record.baseUrl.length > 0
    && typeof record.key === 'string' && record.key.length > 0
    && typeof record.clientId === 'string' && record.clientId.length > 0
    && typeof record.employeeId === 'string' && record.employeeId.length > 0
}
