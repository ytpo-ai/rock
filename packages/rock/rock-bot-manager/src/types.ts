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

/** API protocol a custom bot declares for its upstream LLM route. */
export type ApiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini'

/** Model input modality a custom bot accepts. */
export type BotInputType = 'text' | 'image'

/** One reasoning-effort mapping row: the level name shown in the UI and the API parameter value sent upstream. */
export interface BotReasoningLevel {
  /** Level name shown in the UI (e.g. `off`, `low`, `high`). */
  level: string
  /** Value sent to the API (e.g. `'low'`, `0`, or `1024`). */
  value: string | number
}

/** Reasoning-effort configuration for a custom bot's model. */
export interface BotReasoning {
  /** Whether the model exposes reasoning-effort levels. */
  enabled: boolean
  /** Ordered level → value mapping; empty when {@link enabled} is false. */
  levels: BotReasoningLevel[]
}

/** Upstream LLM route for one custom bot. */
export interface BotLlm {
  /** Provider id: the DSH provider route id and the checklist's Provider ID. */
  provider: string
  /** Provider display name; falls back to {@link provider} when absent. */
  name?: string
  /** API endpoint origin, without the protocol-specific path suffix. */
  baseUrl?: string
  /** API protocol; defaults to OpenAI Chat Completions when absent. */
  protocol?: ApiProtocol
  /** Credential reference; retained for compatibility with the earlier seam. */
  apiKeyRef?: string
  /** Raw provider API key the user entered; persisted in plaintext by explicit product choice, never logged. */
  apiKey?: string
  /** Model id passed to the provider. */
  model: string
  /** Model display name; falls back to {@link model} when absent. */
  modelName?: string
  /** Total context-window token limit, used to time auto-compaction. */
  contextWindow?: number
  /** Single-reply max output token limit. */
  maxOutputTokens?: number
  /** Input modalities the model accepts. */
  inputTypes?: BotInputType[]
  /** Reasoning-effort mapping; absent when the model exposes none. */
  reasoning?: BotReasoning
}

/** Execution backend binding for one custom bot. */
export interface BotTool {
  /** Subagent provider the delegator forwards to. */
  toolType: ToolType
}

/**
 * One locally-defined agent bot (the `BotDefinition` domain record). A bot is
 * stored unbound: no execution backend is implied until the user binds one.
 */
export interface BotDefinition {
  /** Stable local bot id, also used as the agent-loop entry id. */
  id: string
  /** Human-readable display name. */
  name: string
  /** Optional role/persona label; free text for local bots. */
  role?: string
  /** Upstream LLM route. */
  llm: BotLlm
  /** Execution backend binding; absent means unbound. */
  tool?: BotTool
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
  /** Current execution-backend binding; absent means the bot is unbound. */
  tool?: BotTool
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

/** Live progress of one bot debug run. */
export interface BotDebugProgress {
  /** Total delegation steps expected (fixed 1). */
  total: number
  /** Number of delegation steps completed. */
  detected: number
  /** The bound execution backend currently being delegated to. */
  current?: string
  /** Number of tool calls observed. */
  steps: number
}

/** Current per-bot debug run state exposed to the panel. */
export interface BotDebugState {
  /** Whether a debug run is in flight. */
  running: boolean
  /** The bot id being debugged (or last debugged). */
  botId?: string
  /** The bot display name for the progress line. */
  botName?: string
  /** The execution-backend tool type that was debugged. */
  toolType?: string
  /** The DSH session id for the current (or last) run. */
  sessionId?: string
  /** The completed result of the last debug run, when any. */
  result?: BotTestResult
  /** Live progress; the full process renders in the DSH session. */
  progress: BotDebugProgress
  /** Safe failure diagnostic when the run could not start or failed. */
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

/** Deployment status of one bot to its bound execution backend. */
export type DeploymentStatus = 'deploying' | 'deployed' | 'failed'

/** Persisted deployment record for one bot (Rock-recorded state, not probed). */
export interface DeploymentRecord {
  /** The bot this record belongs to. */
  agentBotId: string
  /** Execution backend the bot was (or is being) deployed to. */
  toolType: string
  /** Current deployment status. */
  status: DeploymentStatus
  /** ISO-8601 time of the last status change. */
  updatedAt: string
  /** Safe failure diagnostic when {@link status} is `failed`. */
  error?: string
}

/** One bot's deployment row for the management panel. */
export interface BotDeploymentRow {
  /** Stable bot id. */
  id: string
  /** Human-readable display name. */
  name: string
  /** Execution backend the bot binds to; absent when the bot is unbound. */
  toolType?: string
  /** Deployment status; `undeployed` when Rock has no record yet. */
  status: DeploymentStatus | 'undeployed'
  /** Whether this bot can be deployed (cloud bot with a known relay checklist + skill). */
  deployable: boolean
  /** ISO-8601 time of the last status change, when recorded. */
  updatedAt?: string
  /** Safe failure diagnostic when the last deployment failed. */
  error?: string
}

/** Live progress of a batch deployment run. */
export interface BotDeployState {
  /** Whether a batch (or single) deployment is in flight. */
  running: boolean
  /** Total bots in the current batch. */
  total: number
  /** Bots settled so far. */
  done: number
  /** The bot currently being deployed. */
  current?: string | undefined
  /** Last settled bot id + status, for a short progress line. */
  last?: { id: string; status: DeploymentStatus } | undefined
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A bot with the same id already exists. */
    'rockBots/duplicate': Record<string, never>
    /** No bot with the requested id exists. */
    'rockBots/unknown': Record<string, never>
    /** The bot has no execution-backend binding, so it cannot be tested or deployed. */
    'rockBots/unbound': Record<string, never>
    /** The supplied bot fields failed validation. */
    'rockBots/invalid': Record<string, never>
  }
}
