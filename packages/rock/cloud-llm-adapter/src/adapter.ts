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

/** Constructor options owned by the plugin's `apply`. */
export interface CloudLlmAdapterOptions {
  /** Cloud LLM Proxy origin; the adapter appends `/v1/chat/completions`. */
  baseUrl: string
  /** Bearer agent API key presented to the cloud Proxy. */
  apiKey?: string
  /** Placeholder model id for catalog and omitted-request fallback. */
  defaultModel: string
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

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{
      provider,
      id: this.config.defaultModel,
      name: 'Seagull Cloud Relay',
      inputModalities: ['text'],
    }])
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
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    if (this.config.apiKey !== undefined) headers.set('authorization', `Bearer ${this.config.apiKey}`)

    const body = {
      model: options.model,
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

    yield* this.parseSse(response.body, options.signal)
  }

  private async * parseSse(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined): AsyncIterable<StreamChunk> {
    const decoder = new TextDecoder()
    const reader = body.getReader()
    let buffer = ''
    const accumulator = new BlockAccumulator()
    let finished = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (signal?.aborted) {
            throw new LlmError('cloud proxy stream aborted by caller', 'ABORTED')
          }
          for (const chunk of this.handleSseLine(line.trim(), accumulator)) {
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

  private handleSseLine(line: string, accumulator: BlockAccumulator): StreamChunk[] {
    if (!line.startsWith('data:')) return []
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') {
      return [...accumulator.flush(), { type: 'finish', reason: { kind: 'stop' } as FinishReason }]
    }
    const chunk: OpenAiChunk = JSON.parse(payload)
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
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function diagnosticOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}
