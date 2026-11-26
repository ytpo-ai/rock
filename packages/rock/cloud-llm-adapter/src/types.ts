/**
 * Rock LLM adapter request-log vocabulary: one recorded model call made by a
 * Rock agent through the `@deepseek-ai/dsh-llm` seam, with its resolved route
 * and provider-reported token usage.
 *
 * @module @rock/cloud-llm-adapter/types
 */

/** Token counters one adapter request reported, mirroring the harness `TokenUsage`. */
export interface LlmRequestTokens {
  /** Prompt tokens billed as fresh input. */
  input: number
  /** Completion tokens. */
  output: number
  /** Reasoning tokens the provider segregated from output. */
  reasoning?: number
  /** Prompt tokens served from the provider's KV cache. */
  cacheRead?: number
  /** Prompt tokens written into the provider's KV cache. */
  cacheWrite?: number
  /** Provider-reported exact total, when available. */
  total?: number
}

/** One recorded adapter request. */
export interface LlmRequestLog {
  /** ISO-8601 timestamp of request completion. */
  timestamp: string
  /** ISO-8601 timestamp of request start, before the upstream call. */
  startedAt: string
  /** Elapsed milliseconds from request start to completion. */
  durationMs: number
  /** Rock agent bot id the harness stamped (`GenerateOptions.agentId`), when present. */
  agentBotId?: string
  /** Human-readable bot name resolved from the identity, when available. */
  botName?: string
  /** Execution backend the bot binds to (codex/pi/dsh/acp/…), when bound. */
  toolType?: string
  /** Provider route id the request selected (`GenerateOptions.provider`). */
  provider: string
  /** Wire protocol the request used, for relay routes. */
  wireProtocol?: string
  /** Harness session id that issued the request, when present. */
  sessionId?: string
  /** Model id the request asked for. */
  requestModel: string
  /** The bot's bound model resolved from the identity, when the relay overrides the request model. */
  boundModel?: string
  /** Conversation messages carried by the request. */
  messageCount: number
  /** Declared tools carried by the request; absent when it sent none. */
  toolCount?: number
  /** Upstream HTTP status once a response arrived. */
  status?: number
  /** Safe failure diagnostic when the request failed. */
  error?: string
  /** Provider-reported token usage, when the stream carried it. */
  tokens?: LlmRequestTokens
}
