/**
 * Tool connection config normalization and backfill, pure functions so the
 * controller stays thin and the logic is unit-testable without a live filesystem.
 *
 * @module @rock/rock-tool-inventory/connection
 */
import type { ToolClientType, ToolConnectionConfig, ToolConnectionPatch } from './types.ts'

/** Normalize a typed connection config: keep only non-empty strings and a known clientType. */
export function normalizeConnectionConfig(config: ToolConnectionConfig): ToolConnectionConfig {
  const clientType: ToolClientType | undefined = config.clientType === 'gui' || config.clientType === 'tui' ? config.clientType : undefined
  return {
    ...(nonEmpty(config.url) ? { url: config.url } : {}),
    ...(nonEmpty(config.token) ? { token: config.token } : {}),
    ...(clientType === undefined ? {} : { clientType }),
    ...(nonEmpty(config.rootDir) ? { rootDir: config.rootDir } : {}),
    ...(nonEmpty(config.configRootDir) ? { configRootDir: config.configRootDir } : {}),
    ...(nonEmpty(config.startupCommand) ? { startupCommand: config.startupCommand } : {}),
  }
}

/** Normalize an unknown file value into a connection config with only non-empty fields, or undefined. */
export function normalizeConnection(value: unknown): ToolConnectionConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const candidate: ToolConnectionConfig = {
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    ...(typeof record.token === 'string' ? { token: record.token } : {}),
    ...(record.clientType === 'gui' || record.clientType === 'tui' ? { clientType: record.clientType } : {}),
    ...(typeof record.rootDir === 'string' ? { rootDir: record.rootDir } : {}),
    ...(typeof record.configRootDir === 'string' ? { configRootDir: record.configRootDir } : {}),
    ...(typeof record.startupCommand === 'string' ? { startupCommand: record.startupCommand } : {}),
  }
  const normalized = normalizeConnectionConfig(candidate)
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * Backfill detected connection fields into the persisted config, only where
 * the existing value is empty (never overwrite a user-supplied value).
 * @param existing - the persisted config for the tool, or undefined.
 * @param patch - the detection-derived patch.
 * @returns the merged config, or undefined when nothing changed.
 */
export function backfillConnectionPatch(
  existing: ToolConnectionConfig | undefined,
  patch: ToolConnectionPatch,
): ToolConnectionConfig | undefined {
  let changed = false
  const next: ToolConnectionConfig = { ...existing }
  if (existing?.clientType === undefined && patch.clientType !== undefined) {
    next.clientType = patch.clientType
    changed = true
  }
  if (existing?.rootDir === undefined && patch.rootDir !== undefined) {
    next.rootDir = patch.rootDir
    changed = true
  }
  if (existing?.configRootDir === undefined && patch.configRootDir !== undefined) {
    next.configRootDir = patch.configRootDir
    changed = true
  }
  if (existing?.startupCommand === undefined && patch.startupCommand !== undefined) {
    next.startupCommand = patch.startupCommand
    changed = true
  }
  return changed ? next : undefined
}

/** A non-empty string. */
function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}
