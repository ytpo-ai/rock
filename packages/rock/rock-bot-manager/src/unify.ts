/**
 * Unified bot-row projection (D-036): merge the three bot sources into one
 * ordered `BotRow[]` with source-driven permissions. Pure and synchronous so
 * the controller can keep it unit-tested in isolation.
 *
 * @module @rock/rock-bot-manager/unify
 */
import type { BotDefinition, BotRow, BotSource } from './types.ts'

/** A cloud-assigned bot reference without a local `BotDefinition`. */
export interface CloudBotRef {
  /** Agent bot id (claim or assistant id). */
  agentBotId: string
  /** Optional display name; falls back to the id. */
  name?: string
  /** Whether the binding may be edited; false locks it (assistant pre-onboarding). */
  canRebind?: boolean
}

/** Inputs for the unified projection. */
export interface UnifiedBotsInput {
  /** Locally-defined custom bots. */
  localBots: readonly BotDefinition[]
  /** Cloud-claimed bots (D-033). */
  claimed: readonly CloudBotRef[]
  /** System-assigned assistants (D-035); empty until REQ-012 provides them. */
  assistants: readonly CloudBotRef[]
  /** Bot ids that own at least one active cloud task. */
  activeIds: ReadonlySet<string>
  /** Resolves the tool type a claimed/assistant bot binds to. */
  bindingOf: (agentBotId: string) => string
}

/** Merge local + claimed + assistant bots into one permission-carrying list. */
export function buildUnifiedBots(input: UnifiedBotsInput): BotRow[] {
  const rows: BotRow[] = []
  for (const bot of input.localBots) {
    rows.push(localRow(bot, input.activeIds.has(bot.id)))
  }
  for (const claim of input.claimed) {
    rows.push(cloudRow(claim, 'claimed', input))
  }
  for (const assistant of input.assistants) {
    rows.push(cloudRow(assistant, 'assistant', input))
  }
  return rows
}

/** Build a local-bot row (full edit/delete rights). */
function localRow(bot: BotDefinition, active: boolean): BotRow {
  return {
    id: bot.id,
    name: bot.name,
    source: 'local',
    llm: bot.llm,
    tool: bot.tool,
    canRebind: true,
    canDelete: true,
    active,
  }
}

/** Build a cloud-sourced row (claimed or assistant). */
function cloudRow(ref: CloudBotRef, source: BotSource, input: UnifiedBotsInput): BotRow {
  return {
    id: ref.agentBotId,
    name: ref.name ?? ref.agentBotId,
    source,
    tool: { toolType: input.bindingOf(ref.agentBotId) },
    canRebind: ref.canRebind ?? false,
    canDelete: false,
    active: input.activeIds.has(ref.agentBotId),
  }
}
