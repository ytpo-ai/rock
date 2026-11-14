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
