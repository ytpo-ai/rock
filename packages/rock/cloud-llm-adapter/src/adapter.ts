/**
 * OpenAI-compatible cloud-backed implementation of the Harness LLM seam.
 *
 * The adapter owns one provider route and streams every call to the Seagull
 * cloud LLM Proxy. It translates the harness's provider-neutral message and
 * stream vocabulary into an OpenAI `/v1/chat/completions` request and back,
 * carrying the agent API key as a Bearer credential plus the harness
 * attribution headers.
 *
 * @module @rock/cloud-llm-adapter/adapter
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolCallId,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'

/** Wire protocol the relay routes to Seagull (mirrors Seagull's `WireProtocol`). */
type WireProtocol = 'anthropic-messages' | 'openai-responses' | 'chat-completions'

/** Protocol preference: Anthropic Messages first, then OpenAI Responses, then Chat Completions. */
const WIRE_PROTOCOL_PRIORITY: readonly WireProtocol[] = ['anthropic-messages', 'openai-responses', 'chat-completions']

/** Relay path suffix per wire protocol. */
const WIRE_PROTOCOL_PATH: Readonly<Record<WireProtocol, string>> = {
  'anthropic-messages': '/messages',
  'openai-responses': '/responses',
  'chat-completions': '/chat/completions',
}

/**
 * Select the wire protocol by channel support priority; unknown or empty support
 * falls back to `chat-completions` (the relay's long-standing default).
 * @param supported - the bot's bound channel wire protocols, or undefined.
 * @returns the preferred wire protocol.
 */
export function preferredWireProtocol(supported: readonly string[] | undefined): WireProtocol {
  const supportedSet = new Set(supported ?? [])
  return WIRE_PROTOCOL_PRIORITY.find(protocol => supportedSet.has(protocol)) ?? 'chat-completions'
}

/** One OpenAI-compatible provider route owned by this adapter. */
export interface CloudProviderConfig {
  /** OpenAI-compatible endpoint origin; the adapter appends `/v1/chat/completions`. */
  baseUrl: string
  /** Bearer API key presented to this provider. */
  apiKey?: string
  /** Human-readable display name; defaults to the provider id. */
  name?: string
  /** Advertised model ids for the catalog; omitted falls back to `defaultModel`. */
  models?: string[]
  /** Placeholder model id for catalog and omitted-request fallback. */
  defaultModel: string
  /**
   * Rock-relayed route: connector-key auth + `/v1/bots/{agentId}` scoped URL.
   * Requires `GenerateOptions.agentId`; a missing id throws `INVALID_REQUEST`
   * instead of falling back to the session id.
   */
  relay?: boolean
}

/** Constructor options owned by the plugin's `apply`. */
export interface CloudLlmAdapterOptions {
  /** Provider routes keyed by the id passed to `GenerateOptions.provider`. */
  providers: Record<string, CloudProviderConfig>
  /** Resolve the Rock connector key for `relay` routes; undefined means the route has no key yet. */
  resolveConnectorKey?: () => string | undefined
  /** Resolve a relay bot's bound channel wire protocols; undefined means unknown. */
  resolveSupportedProtocols?: (agentId: string) => string[] | undefined
}

/** One OpenAI chat message after translation from the harness vocabulary. */
interface OpenAiMessage {
  role: string
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** One OpenAI tool declaration. */
interface OpenAiTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** One streamed OpenAI delta chunk (subset of the wire shape this adapter reads). */
interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

/** Concatenate the visible text blocks of one content array. */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** Collect the assistant tool-call blocks of one content array. */
function toolCallsOf(content: readonly ContentBlock[]): NonNullable<OpenAiMessage['tool_calls']> {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    .map(block => ({
      id: String(block.id),
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
}

/** Translate one harness conversation message into an OpenAI message. */
function messageToOpenAi(message: RequestMessage): OpenAiMessage {
  switch (message.role) {
    case 'system':
    case 'developer':
      return { role: 'system', content: textOf(message.content) || '' }
    case 'assistant': {
      const toolCalls = toolCallsOf(message.content)
      return {
        role: 'assistant',
        content: textOf(message.content) || null,
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
      }
    }
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: String(message.toolCallId),
        content: textOf(message.content) || '',
      }
    case 'user':
      return { role: 'user', content: textOf(message.content) || '' }
  }
}

/** Translate one harness tool schema into an OpenAI tool declaration. */
function toolToOpenAi(tool: ToolSchema): OpenAiTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }
}

/** Translate one harness tool schema into an OpenAI Responses tool declaration. */
function toolToResponses(tool: ToolSchema): Record<string, unknown> {
  return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }
}

/** Translate one harness tool schema into an Anthropic tool declaration. */
function toolToAnthropic(tool: ToolSchema): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters }
}

/** Parse a raw JSON string into an object, falling back to a wrapped raw string. */
function parseJsonArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return { _raw: raw }
  }
}

/** Translate one harness message into OpenAI Responses input items (assistant tool calls split into `function_call` items). */
function messageToResponsesInput(message: RequestMessage): unknown[] {
  switch (message.role) {
    case 'system':
    case 'developer':
      return [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: textOf(message.content) }] }]
    case 'user':
      return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: textOf(message.content) }] }]
    case 'assistant': {
      const out: unknown[] = []
      const text = textOf(message.content)
      const toolCalls = toolCallsOf(message.content)
      if (text.length > 0 || toolCalls.length === 0) {
        out.push({ type: 'message', role: 'assistant', content: [{ type: 'input_text', text }] })
      }
      for (const call of toolCalls) {
        out.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
      return out
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: String(message.toolCallId), output: textOf(message.content) }]
  }
}

/**
 * Translate harness messages into Anthropic `messages` (system/developer are
 * omitted here — they surface as the top-level `system`). Consecutive tool
 * results are merged into one user message to satisfy Anthropic alternation.
 */
function messagesToAnthropic(messages: readonly RequestMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    if (message === undefined) break
    if (message.role === 'system' || message.role === 'developer') {
      index += 1
      continue
    }
    if (message.role === 'assistant') {
      const blocks: unknown[] = []
      const text = textOf(message.content)
      if (text.length > 0) blocks.push({ type: 'text', text })
      for (const call of toolCallsOf(message.content)) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseJsonArguments(call.function.arguments) })
      }
      if (blocks.length > 0) out.push({ role: 'assistant', content: blocks })
      index += 1
      continue
    }
    if (message.role === 'user') {
      const text = textOf(message.content)
      out.push({ role: 'user', content: text.length > 0 ? [{ type: 'text', text }] : [] })
      index += 1
      continue
    }
    // tool role: merge consecutive tool results into one user message.
    const blocks: unknown[] = []
    while (index < messages.length) {
      const toolMessage = messages[index]
      if (toolMessage === undefined || toolMessage.role !== 'tool') break
      blocks.push({ type: 'tool_result', tool_use_id: String(toolMessage.toolCallId), content: textOf(toolMessage.content) })
      index += 1
    }
    out.push({ role: 'user', content: blocks })
  }
  return out
}

/** Map OpenAI Responses usage to the harness disjoint token accounting. */
function responsesUsageOf(usage: {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}): TokenUsage {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens: Math.max(0, (usage.input_tokens ?? 0) - cached),
    outputTokens: usage.output_tokens ?? 0,
    ...usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens },
    ...cached > 0 ? { cacheReadTokens: cached } : {},
  }
}

/** Mutable per-stream accumulation of the Anthropic usage halves. */
interface AnthropicUsageCounts {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Map Anthropic usage to the harness disjoint token accounting.
 *
 * Anthropic reports `input_tokens` excluding cache reads/writes, which is
 * already the harness's uncached bucket; the cache fields are carried through
 * so the token meter and the cache-hit display see them.
 */
function anthropicUsageOf(usage: AnthropicUsageCounts): TokenUsage {
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    ...cacheRead > 0 ? { cacheReadTokens: cacheRead } : {},
    ...cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {},
  }
}

/** Map an Anthropic stop_reason to the harness finish reason. */
function anthropicFinishReasonOf(stopReason: string | null | undefined): FinishReason {
  switch (stopReason) {
    case 'tool_use': return { kind: 'tool-calls' }
    case 'max_tokens': return { kind: 'max-tokens' }
    default: return { kind: 'stop' }
  }
}

/** Map one OpenAI streamed finish reason to the harness vocabulary. */
function finishReasonOf(reason: string | null | undefined): FinishReason | undefined {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    case null:
    case undefined:
    case '': return undefined
    default: return { kind: 'error', failure: { message: `cloud proxy stopped with reason "${reason}"`, code: 'HTTP_400' } }
  }
}

/** Map OpenAI usage counts to the harness's disjoint token accounting. */
function usageOf(usage: NonNullable<OpenAiChunk['usage']>): TokenUsage {
  const prompt = usage.prompt_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: usage.completion_tokens ?? 0,
    ...usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens },
    ...cached > 0 ? { cacheReadTokens: cached } : {},
    ...reasoning === undefined ? {} : { reasoningTokens: reasoning },
  }
}

/** Streaming block accumulator: collects text/reasoning/tool-call deltas. */
class BlockAccumulator {
  private nextIndex = 0
  private text: { index: number; value: string } | undefined
  private reasoning: { index: number; value: string } | undefined
  private readonly toolCalls = new Map<number, { blockIndex: number; id: string; name: string; arguments: string }>()

  startText(): StreamChunk | undefined {
    if (this.text !== undefined) return undefined
    const index = this.nextIndex++
    this.text = { index, value: '' }
    return { type: 'block-start', index, blockType: 'text' }
  }

  startReasoning(): StreamChunk | undefined {
    if (this.reasoning !== undefined) return undefined
    const index = this.nextIndex++
    this.reasoning = { index, value: '' }
    return { type: 'block-start', index, blockType: 'reasoning' }
  }

  startToolCall(rawIndex: number | undefined, id: string): StreamChunk | undefined {
    const key = rawIndex ?? 0
    if (this.toolCalls.has(key)) return undefined
    const blockIndex = this.nextIndex++
    this.toolCalls.set(key, { blockIndex, id, name: '', arguments: '' })
    return { type: 'block-start', index: blockIndex, blockType: 'tool-call' }
  }

  appendText(value: string): StreamChunk | undefined {
    if (this.text === undefined || value.length === 0) return undefined
    this.text.value += value
    return { type: 'text-delta', index: this.text.index, text: value }
  }

  appendReasoning(value: string): StreamChunk | undefined {
    if (this.reasoning === undefined || value.length === 0) return undefined
    this.reasoning.value += value
    return { type: 'reasoning-delta', index: this.reasoning.index, text: value }
  }

  appendToolCall(rawIndex: number | undefined, patch: { id?: string; name?: string; argumentsDelta?: string }): StreamChunk | undefined {
    const call = this.toolCalls.get(rawIndex ?? 0)
    if (call === undefined) return undefined
    if (patch.id !== undefined) call.id = patch.id
    if (patch.name !== undefined) call.name += patch.name
    if (patch.argumentsDelta !== undefined) call.arguments += patch.argumentsDelta
    return {
      type: 'tool-call-delta',
      index: call.blockIndex,
      id: brandString<ToolCallId>(call.id),
      ...call.name === '' ? {} : { name: call.name },
      argumentsDelta: patch.argumentsDelta ?? '',
    }
  }

  /** Emit the terminal block-end chunks for every open block. */
  * flush(): Iterable<StreamChunk> {
    if (this.text !== undefined) {
      yield { type: 'block-end', index: this.text.index, block: { type: 'text', text: this.text.value } }
    }
    if (this.reasoning !== undefined) {
      yield { type: 'block-end', index: this.reasoning.index, block: { type: 'reasoning', text: this.reasoning.value } }
    }
    for (const call of this.toolCalls.values()) {
      yield {
        type: 'block-end',
        index: call.blockIndex,
        block: { type: 'tool-call', id: brandString<ToolCallId>(call.id), name: call.name, arguments: call.arguments },
      }
    }
  }
}

/** OpenAI-compatible cloud-backed LLM adapter for the harness LLM seam. */
export class CloudLlmAdapter extends LlmAdapter {
  constructor(private readonly config: CloudLlmAdapterOptions) {
    super()
  }

  /** Resolve one provider route's connection facts, refusing unknown routes. */
  private providerConfig(provider: string): CloudProviderConfig {
    const route = this.config.providers[provider]
    if (route === undefined) {
      throw new LlmError(`no provider route configured for "${provider}"`, 'NO_ADAPTER')
    }
    return route
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providerConfig(provider).name ?? provider }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const route = this.providerConfig(provider)
    const ids = route.models !== undefined && route.models.length > 0 ? route.models : [route.defaultModel]
    return Promise.resolve(ids.map(id => ({
      provider,
      id,
      name: id,
      inputModalities: ['text'],
    })))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: 128_000 },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = this.providerConfig(options.provider)
    const relay = route.relay === true
    const agentId = options.agentId
    if (relay && (agentId === undefined || agentId === '')) {
      throw new LlmError('relay route requires an agent-bot id', 'INVALID_REQUEST')
    }
    const protocol: WireProtocol = relay
      ? preferredWireProtocol(this.config.resolveSupportedProtocols?.(agentId ?? ''))
      : 'chat-completions'
    const url = relay
      ? `${route.baseUrl.replace(/\/$/, '')}/v1/bots/${agentId ?? ''}${WIRE_PROTOCOL_PATH[protocol]}`
      : `${route.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    const apiKey = relay ? this.config.resolveConnectorKey?.() : route.apiKey
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    if (apiKey !== undefined && apiKey !== '') headers.set('authorization', `Bearer ${apiKey}`)

    const body = this.buildBody(options, protocol)

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...options.signal === undefined ? {} : { signal: options.signal },
    }

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError('cloud proxy request aborted by caller', 'ABORTED', { cause: error })
      }
      throw new LlmError(`cloud proxy request failed: ${diagnosticOf(error)}`, 'HTTP_500', { cause: error })
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LlmError(`cloud proxy returned ${response.status}: ${detail.slice(0, 200)}`, `HTTP_${response.status}`)
    }
    if (response.body === null) {
      throw new LlmError('cloud proxy returned an empty response body', 'HTTP_500')
    }

    yield* this.parseSse(response.body, options.signal, protocol)
  }

  private buildBody(options: GenerateOptions, protocol: WireProtocol): Record<string, unknown> {
    switch (protocol) {
      case 'anthropic-messages': return this.buildAnthropicBody(options)
      case 'openai-responses': return this.buildResponsesBody(options)
      case 'chat-completions': return this.buildChatBody(options)
    }
  }

  private buildChatBody(options: GenerateOptions): Record<string, unknown> {
    return {
      model: options.model,
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      messages: [
        ...options.system === undefined ? [] : [{ role: 'system', content: options.system }],
        ...options.messages.map(messageToOpenAi),
      ],
      ...options.tools !== undefined && options.tools.length > 0 ? { tools: options.tools.map(toolToOpenAi) } : {},
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
      ...options.stop !== undefined && options.stop.length > 0 ? { stop: options.stop } : {},
      stream: true,
      stream_options: { include_usage: true },
    }
  }

  private buildResponsesBody(options: GenerateOptions): Record<string, unknown> {
    const input: unknown[] = []
    for (const message of options.messages) input.push(...messageToResponsesInput(message))
    return {
      model: options.model,
      ...options.system === undefined || options.system.length === 0 ? {} : { instructions: options.system },
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      input,
      ...options.tools !== undefined && options.tools.length > 0 ? { tools: options.tools.map(toolToResponses) } : {},
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
      ...options.stop !== undefined && options.stop.length > 0 ? { stop: options.stop } : {},
      stream: true,
    }
  }

  private buildAnthropicBody(options: GenerateOptions): Record<string, unknown> {
    const system = this.anthropicSystemOf(options)
    return {
      model: options.model,
      ...system === undefined ? {} : { system },
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      messages: messagesToAnthropic(options.messages),
      ...options.tools !== undefined && options.tools.length > 0 ? { tools: options.tools.map(toolToAnthropic) } : {},
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
      ...options.stop !== undefined && options.stop.length > 0 ? { stop_sequences: options.stop } : {},
      stream: true,
    }
  }

  private anthropicSystemOf(options: GenerateOptions): string | undefined {
    if (options.system !== undefined && options.system.length > 0) return options.system
    const leading = options.messages.find(message => message.role === 'system' || message.role === 'developer')
    if (leading === undefined) return undefined
    const text = textOf(leading.content)
    return text.length > 0 ? text : undefined
  }

  private async * parseSse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal | undefined,
    protocol: WireProtocol,
  ): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder()
    const reader = body.getReader()
    let buffer = ''
    let event: string | undefined
    const accumulator = new BlockAccumulator()
    // Anthropic splits one call's usage across message_start (input + cache) and
    // message_delta (output); accumulate per stream so the terminal usage chunk
    // carries both halves instead of the output-only half overwriting the input.
    const anthropicUsage: AnthropicUsageCounts = {}
    let finished = false
    const handler = protocol === 'anthropic-messages'
      ? (name: string | undefined, data: string): StreamChunk[] => this.handleAnthropicSseLine(name, data, accumulator, anthropicUsage)
      : protocol === 'openai-responses'
        ? (name: string | undefined, data: string): StreamChunk[] => this.handleResponsesSseLine(name, data, accumulator)
        : (name: string | undefined, data: string): StreamChunk[] => this.handleChatSseLine(name, data, accumulator)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (line.length === 0) {
            event = undefined
            continue
          }
          if (line.startsWith('event:')) {
            event = line.slice(6).trim()
            continue
          }
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          if (signal?.aborted) {
            throw new LlmError('cloud proxy stream aborted by caller', 'ABORTED')
          }
          for (const chunk of handler(event, payload)) {
            if (chunk.type === 'finish') finished = true
            yield chunk
          }
        }
      }
      if (!finished) {
        for (const chunk of accumulator.flush()) yield chunk
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private handleChatSseLine(_event: string | undefined, data: string, accumulator: BlockAccumulator): StreamChunk[] {
    if (data === '') return []
    const chunk = JSON.parse(data) as OpenAiChunk
    const out: StreamChunk[] = []
    const delta = chunk.choices?.[0]?.delta
    if (delta !== undefined) {
      if (delta.content !== undefined) {
        const started = accumulator.startText()
        if (started !== undefined) out.push(started)
        const appended = accumulator.appendText(delta.content)
        if (appended !== undefined) out.push(appended)
      }
      if (delta.reasoning_content !== undefined) {
        const started = accumulator.startReasoning()
        if (started !== undefined) out.push(started)
        const appended = accumulator.appendReasoning(delta.reasoning_content)
        if (appended !== undefined) out.push(appended)
      }
      for (const call of delta.tool_calls ?? []) {
        if (call.id !== undefined) {
          const started = accumulator.startToolCall(call.index, call.id)
          if (started !== undefined) out.push(started)
        }
        const appended = accumulator.appendToolCall(call.index, {
          ...call.id === undefined ? {} : { id: call.id },
          ...call.function?.name === undefined ? {} : { name: call.function.name },
          ...call.function?.arguments === undefined ? {} : { argumentsDelta: call.function.arguments },
        })
        if (appended !== undefined) out.push(appended)
      }
    }
    if (chunk.usage !== undefined) {
      out.push({ type: 'usage', usage: usageOf(chunk.usage) })
    }
    const finish = finishReasonOf(chunk.choices?.[0]?.finish_reason)
    if (finish !== undefined) {
      out.push(...accumulator.flush(), { type: 'finish', reason: finish })
    }
    return out
  }

  private handleResponsesSseLine(_event: string | undefined, data: string, accumulator: BlockAccumulator): StreamChunk[] {
    if (data === '') return []
    const chunk = JSON.parse(data) as {
      type?: string
      delta?: string
      output_index?: number
      arguments?: string
      item?: { type?: string; id?: string; call_id?: string; name?: string }
      response?: { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }
    }
    const out: StreamChunk[] = []
    switch (chunk.type) {
      case 'response.output_text.delta': {
        if (chunk.delta === undefined) break
        const started = accumulator.startText()
        if (started !== undefined) out.push(started)
        const appended = accumulator.appendText(chunk.delta)
        if (appended !== undefined) out.push(appended)
        break
      }
      case 'response.output_item.added': {
        if (chunk.item?.type === 'function_call') {
          const index = chunk.output_index ?? 0
          const id = chunk.item.call_id ?? chunk.item.id ?? ''
          const started = accumulator.startToolCall(index, id)
          if (started !== undefined) out.push(started)
          if (chunk.item.name !== undefined) {
            const appended = accumulator.appendToolCall(index, { name: chunk.item.name })
            if (appended !== undefined) out.push(appended)
          }
        }
        break
      }
      case 'response.function_call_arguments.done': {
        const index = chunk.output_index ?? 0
        const appended = accumulator.appendToolCall(index, { argumentsDelta: chunk.arguments ?? '' })
        if (appended !== undefined) out.push(appended)
        break
      }
      case 'response.completed': {
        if (chunk.response?.usage !== undefined) out.push({ type: 'usage', usage: responsesUsageOf(chunk.response.usage) })
        out.push(...accumulator.flush(), { type: 'finish', reason: { kind: 'stop' } as FinishReason })
        break
      }
      default:
        break
    }
    return out
  }

  private handleAnthropicSseLine(
    _event: string | undefined,
    data: string,
    accumulator: BlockAccumulator,
    usage: AnthropicUsageCounts,
  ): StreamChunk[] {
    if (data === '') return []
    const chunk = JSON.parse(data) as {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string }
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null }
      message?: { usage?: AnthropicUsageCounts }
      usage?: AnthropicUsageCounts
    }
    const out: StreamChunk[] = []
    switch (chunk.type) {
      case 'message_start': {
        // Anthropic puts the prompt-side usage on the message, not the event.
        if (chunk.message?.usage !== undefined) Object.assign(usage, chunk.message.usage)
        break
      }
      case 'content_block_start': {
        if (chunk.content_block?.type === 'text') {
          const started = accumulator.startText()
          if (started !== undefined) out.push(started)
        } else if (chunk.content_block?.type === 'tool_use') {
          const index = chunk.index ?? 0
          const started = accumulator.startToolCall(index, chunk.content_block.id ?? '')
          if (started !== undefined) out.push(started)
          if (chunk.content_block.name !== undefined) {
            const appended = accumulator.appendToolCall(index, { name: chunk.content_block.name })
            if (appended !== undefined) out.push(appended)
          }
        }
        break
      }
      case 'content_block_delta': {
        if (chunk.delta?.type === 'text_delta' && chunk.delta.text !== undefined) {
          const appended = accumulator.appendText(chunk.delta.text)
          if (appended !== undefined) out.push(appended)
        } else if (chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json !== undefined) {
          const index = chunk.index ?? 0
          const appended = accumulator.appendToolCall(index, { argumentsDelta: chunk.delta.partial_json })
          if (appended !== undefined) out.push(appended)
        }
        break
      }
      case 'message_delta': {
        if (chunk.usage !== undefined) Object.assign(usage, chunk.usage)
        out.push({ type: 'usage', usage: anthropicUsageOf(usage) })
        out.push(...accumulator.flush(), { type: 'finish', reason: anthropicFinishReasonOf(chunk.delta?.stop_reason) })
        break
      }
      default:
        break
    }
    return out
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function diagnosticOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}
