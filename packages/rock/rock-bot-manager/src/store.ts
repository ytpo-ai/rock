/**
 * JSON-file persistence for the local bot definitions. The store owns the
 * on-disk representation and exposes plain array read/write; the service adds
 * validation and identity rules on top. Writes are atomic (temp file + rename)
 * so a crash never leaves a truncated bot list.
 *
 * @module @rock/rock-bot-manager/store
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BotDefinition, DeploymentRecord } from './types.ts'

/** A schema-free JSON list on disk; validation lives in the service. */
export interface BotStore {
  /** Read the persisted bots, or an empty list when the file is absent. */
  load(): Promise<BotDefinition[]>
  /** Persist the whole list atomically. */
  save(bots: readonly BotDefinition[]): Promise<void>
}

/** File-system-backed store rooted at one JSON file path. */
export class JsonFileBotStore implements BotStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<BotDefinition[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as BotDefinition[]
  }

  async save(bots: readonly BotDefinition[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(bots, null, 2)}\n`, 'utf8')
    await rename(tmp, this.filePath)
  }
}

/** Whether an unknown thrown value is a "file does not exist" read error. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** A persisted `agentBotId → DeploymentRecord` map (Rock-recorded deploy state). */
export interface DeploymentStore {
  /** Read the persisted deployments, or an empty map when the file is absent. */
  load(): Promise<Record<string, DeploymentRecord>>
  /** Persist the whole map atomically. */
  save(deployments: Record<string, DeploymentRecord>): Promise<void>
}

/** File-system-backed deployment store rooted at one JSON file path. */
export class JsonFileDeploymentStore implements DeploymentStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, DeploymentRecord>> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return {}
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, DeploymentRecord>
  }

  async save(deployments: Record<string, DeploymentRecord>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(deployments, null, 2)}\n`, 'utf8')
    await rename(tmp, this.filePath)
  }
}

/** A persisted `agentBotId → toolType` map for cloud-sourced bots. */
export interface BindingStore {
  /** Read the persisted bindings, or an empty map when the file is absent. */
  load(): Promise<Record<string, string>>
  /** Persist the whole map atomically. */
  save(bindings: Record<string, string>): Promise<void>
}

/** File-system-backed binding store rooted at one JSON file path. */
export class JsonFileBindingStore implements BindingStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, string>> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return {}
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  }

  async save(bindings: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(bindings, null, 2)}\n`, 'utf8')
    await rename(tmp, this.filePath)
  }
}
