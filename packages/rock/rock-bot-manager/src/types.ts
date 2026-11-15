/**
 * Rock local bot vocabulary: one locally-defined agent bot on the employee
 * workbench. A custom bot names its own upstream LLM (official
 * OpenAI-compatible provider + apiKey reference) and its execution backend,
 * independent of the Seagull seat-claim model.
 *
 * @module @rock/rock-bot-manager/types
 */

/** Local execution backend a bot delegates to through `tool-subagent` (e.g. codex / pi / dsh / acp / claude-code). */
export type ToolType = string

/** Upstream LLM route for one custom bot. */
export interface BotLlm {
  /** Provider route id registered by `cloud-llm-adapter` (or any `ctx.llm` provider). */
  provider: string
  /** OpenAI-compatible endpoint origin; absent for providers already configured globally. */
  baseUrl?: string
  /** Credential reference (never the raw key); the credential seam resolves it. */
  apiKeyRef?: string
  /** Model id passed to the provider. */
  model: string
}

/** Execution backend binding for one custom bot. */
export interface BotTool {
  /** Subagent provider the delegator forwards to. */
  toolType: ToolType
}

/** One locally-defined agent bot (the `BotDefinition` domain record). */
export interface BotDefinition {
  /** Stable local bot id, also used as the agent-loop entry id. */
  id: string
  /** Human-readable display name. */
  name: string
  /** Upstream LLM route. */
  llm: BotLlm
  /** Execution backend binding. */
  tool: BotTool
}

/** A full-bot create payload; the id is optional (falls back to the name). */
export type BotInput = Omit<BotDefinition, 'id'> & { id?: string }

/** Where a managed bot comes from in the unified panel (D-036). */
export type BotSource = 'claimed' | 'local' | 'assistant'

/** One unified bot row the management panel renders, regardless of source. */
export interface BotRow {
  /** Stable bot id (agent bot id for claimed/assistant, local id for local). */
  id: string
  /** Human-readable display name. */
  name: string
  /** Bot source driving the edit/delete permissions (D-036). */
  source: BotSource
  /** Upstream LLM route for local bots; absent for cloud-managed sources. */
  llm?: BotLlm
  /** Current execution-backend binding. */
  tool: BotTool
  /** Whether the binding may be edited. */
  canRebind: boolean
  /** Whether the bot may be removed. */
  canDelete: boolean
  /** Whether the bot has an active (non-terminal) cloud task. */
  active: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A bot with the same id already exists. */
    'rockBots/duplicate': Record<string, never>
    /** No bot with the requested id exists. */
    'rockBots/unknown': Record<string, never>
    /** The supplied bot fields failed validation. */
    'rockBots/invalid': Record<string, never>
  }
}
