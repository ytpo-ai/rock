/**
 * Loopback relay inbound-key store: reads the persisted local bearer key or
 * generates a fresh one, and persists it atomically. This key authenticates
 * external tools against the Rock relay only; the cloud-facing connector key
 * (from `rock-onboarding`) is a separate credential.
 *
 * @module @rock/rock-llm-relay/key-service
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Persisted relay-key record. */
export interface RelayKeyRecord {
  /** Local inbound bearer key. */
  key: string
}

/** Owns the loopback relay's inbound bearer key: read or generate + persist. */
export class RelayKeyService {
  private readonly record: RelayKeyRecord
  private readonly generated: boolean

  constructor(private readonly keyPath: string) {
    const existing = readRecord(keyPath)
    this.generated = existing === null
    this.record = existing ?? { key: `sk-rock-${randomBytes(24).toString('hex')}` }
  }

  /** The current local bearer key. */
  getKey(): string {
    return this.record.key
  }

  /** Whether a fresh key was generated on this boot (i.e. not yet persisted). */
  get generatedOnBoot(): boolean {
    return this.generated
  }

  /** Persist the current record atomically; rejects on IO failure. */
  persist(): Promise<void> {
    return persistRecord(this.keyPath, this.record)
  }
}

/** Read a persisted key record, returning null for an absent or malformed file. */
function readRecord(keyPath: string): RelayKeyRecord | null {
  let raw: string
  try {
    raw = readFileSync(keyPath, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const key = (parsed as Record<string, unknown>).key
  return typeof key === 'string' && key.length > 0 ? { key } : null
}

/** Persist one key record atomically. */
async function persistRecord(keyPath: string, record: RelayKeyRecord): Promise<void> {
  await mkdir(dirname(keyPath), { recursive: true })
  const tmp = `${keyPath}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await rename(tmp, keyPath)
}
