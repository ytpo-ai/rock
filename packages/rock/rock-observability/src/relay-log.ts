/**
 * Read-time enrichment for relay forward logs: fills identity-derived fields
 * only when the record lacks them, so legacy JSONL entries (written before the
 * fields existed) still resolve a display name and tool from the live identity.
 *
 * @module @rock/rock-observability/relay-log
 */
import type { RelayForwardLog } from './types.ts'

/** Minimal structural view of the `seagull-identity` service (optional dep). */
export interface IdentityLike {
  getClaims(): readonly { agentBotId: string; name?: string; model?: { model?: string } }[]
  getAssistants(): readonly { agentBotId: string; name?: string; model?: { model?: string } }[]
  toolBindingOf(id: string): string | undefined
}

/**
 * Fill a log's bot name, bound model, and tool from the identity, without
 * overwriting values the record already carries.
 * @param log - the persisted relay record.
 * @param identity - the `seagull-identity` service surface, or `undefined` when absent.
 * @returns a new record with any missing `botName` / `boundModel` / `toolType` resolved.
 */
export function fillForwardLog(log: RelayForwardLog, identity: IdentityLike | undefined): RelayForwardLog {
  if (identity === undefined) return log
  const ref = [...identity.getClaims(), ...identity.getAssistants()].find(item => item.agentBotId === log.agentBotId)
  const toolType = identity.toolBindingOf(log.agentBotId)
  return {
    ...log,
    ...(log.botName === undefined && ref?.name !== undefined ? { botName: ref.name } : {}),
    ...(log.boundModel === undefined && ref?.model?.model !== undefined ? { boundModel: ref.model.model } : {}),
    ...(log.toolType === undefined && toolType !== undefined ? { toolType } : {}),
  }
}
