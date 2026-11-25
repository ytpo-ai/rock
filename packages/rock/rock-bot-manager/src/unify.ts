/**
 * Unified bot-row projection (D-036): merge the three bot sources into one
 * ordered `BotRow[]` with source-driven permissions. Pure and synchronous so
 * the controller can keep it unit-tested in isolation.
 *
 * @module @rock/rock-bot-manager/unify
 */
import type { BotDefinition, BotModelInfo, BotRow, BotSource } from './types.ts'

/** A cloud-assigned bot reference without a local `BotDefinition`. */
export interface CloudBotRef {
  /** Agent bot id (claim or assistant id). */
  agentBotId: string
  /** Optional display name; falls back to the id. */
  name?: string
  /** Role/persona label set on Seagull for this bot. */
  role?: string
  /** Whether the binding may be edited; false locks it (assistant pre-onboarding). */
  canRebind?: boolean
  /** Upstream LLM route for display, projected from the Seagull agent model. */
  model?: BotModelInfo
  /** Owning project id; absent means a global (project-less) bot. */
  projectId?: string
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
  /** Resolves the tool type a claimed/assistant bot binds to; `undefined` when unbound. */
  bindingOf: (agentBotId: string) => string | undefined
  /** Resolves a project's display name; falls back to the raw id when unsynced. */
  projectNameOf: (projectId: string) => string | undefined
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
    ...bot.role === undefined ? {} : { role: bot.role },
    source: 'local',
    llm: bot.llm,
    ...bot.tool === undefined ? {} : { tool: bot.tool },
    canRebind: true,
    canDelete: true,
    active,
  }
}

/** Build a cloud-sourced row (claimed or assistant). */
function cloudRow(ref: CloudBotRef, source: BotSource, input: UnifiedBotsInput): BotRow {
  const toolType = input.bindingOf(ref.agentBotId)
  return {
    id: ref.agentBotId,
    name: ref.name ?? ref.agentBotId,
    ...ref.role === undefined ? {} : { role: ref.role },
    source,
    ...ref.model === undefined ? {} : { llm: toBotLlm(ref.model) },
    ...ref.model?.model === undefined ? {} : { modelId: ref.model.model },
    ...toolType === undefined ? {} : { tool: { toolType } },
    canRebind: ref.canRebind ?? false,
    canDelete: false,
    active: input.activeIds.has(ref.agentBotId),
    ...ref.projectId === undefined ? {} : { projectId: ref.projectId, projectName: input.projectNameOf(ref.projectId) ?? ref.projectId },
    ...ref.model?.supportedProtocols === undefined ? {} : { supportedProtocols: ref.model.supportedProtocols },
  }
}

/** Build a display LLM route from a cloud bot's model summary (readable name first). */
function toBotLlm(model: BotModelInfo): { provider: string; model: string } {
  return {
    provider: model.provider ?? '',
    model: model.name ?? model.model ?? '',
  }
}

/**
 * Resolve the execution-backend tool type for one bot id across the unified
 * sources, mirroring {@link buildUnifiedBots}'s per-row `tool.toolType`
 * assignment: local bots read their `BotDefinition`, while cloud bots
 * (claimed/assistant) resolve through `bindingOf`. Returns `undefined` for an
 * unknown id or an unbound bot.
 */
export function resolveBotToolType(
  id: string,
  localBots: readonly BotDefinition[],
  cloudIds: ReadonlySet<string>,
  bindingOf: (agentBotId: string) => string | undefined,
): string | undefined {
  const local = localBots.find(bot => bot.id === id)
  if (local !== undefined) return local.tool?.toolType
  if (!cloudIds.has(id)) return undefined
  return bindingOf(id)
}
