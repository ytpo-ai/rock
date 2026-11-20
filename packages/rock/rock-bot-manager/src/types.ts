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
  /** Credential reference; retained for compatibility with the earlier seam. */
  apiKeyRef?: string
  /** Raw provider API key the user entered; persisted in plaintext by explicit product choice, never logged. */
  apiKey?: string
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
  /** Optional role/persona label; free text for local bots. */
  role?: string
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
  /** Role/persona label: Seagull role for cloud bots, free text for local bots. */
  role?: string
  /** Bot source driving the edit/delete permissions (D-036). */
  source: BotSource
  /** Upstream LLM route; cloud bots carry it once the claim/assistant projects the model. */
  llm?: BotLlm
  /** Current execution-backend binding. */
  tool: BotTool
  /** Whether the binding may be edited. */
  canRebind: boolean
  /** Whether the bot may be removed. */
  canDelete: boolean
  /** Whether the bot has an active (non-terminal) cloud task. */
  active: boolean
  /** Owning project id; absent means a global (project-less) bot. */
  projectId?: string
  /** Resolved project display name; absent for global bots or when the list is unsynced. */
  projectName?: string
}

/** Display summary of a cloud-sourced bot's upstream LLM route. */
export interface BotModelInfo {
  /** Provider route id. */
  provider?: string
  /** Model id passed to the provider. */
  model?: string
  /** Human-readable model name. */
  name?: string
}

/** Structured outcome of a card's "test" action against a bot's bound tool. */
export interface BotTestResult {
  /** Whether the bound tool answered the smoke-test prompt. */
  ok: boolean
  /** The tool type that was invoked. */
  toolType: string
  /** The tool's answer, on success. */
  answer?: string
  /** A safe failure diagnostic, on failure. */
  error?: string
}

/** A ready-to-paste checklist for wiring one cloud bot into DSH's custom model API (D-034). */
export interface LlmProxyChecklist {
  /** Cloud agent bot id the relay routes by. */
  botId: string
  /** DSH provider id, derived as `rock-{agentBotId}`. */
  providerId: string
  /** DSH provider display name (bot name). */
  displayName: string
  /** DSH provider API address (base URL through the relay). */
  baseUrl: string
  /** DSH provider API protocol (fixed: OpenAI Chat Completions). */
  protocol: string
  /** Local relay bearer key the DSH provider authenticates with. */
  apiKey: string
  /** Real model id sent upstream (the bot's bound model, e.g. `gpt-5`). */
  modelId: string
  /** Model display name: `{modelId}/{botName}`. */
  modelName: string
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
