/**
 * Maps one harness session event into the M3 outbound event vocabulary
 * (`session.*` / `llm.*` / `tool.*` / `step.*`, per AGENT_CONNECTOR_PROTOCOL.MD
 * §6.2) that the Seagull ConnectorGateway understands. Unknown event types pass
 * through unchanged, so the durable log never silently drops a required event.
 *
 * @module @rock/gateway-reporter/m3
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One M3-mapped event: a stable type plus a JSON payload. */
export interface M3Event {
  type: string
  payload: Record<string, unknown>
}

/** Parse a raw JSON string, falling back to the raw text when it is not valid JSON. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Map one harness session event to its M3 outbound form. */
export function mapToM3(event: SessionEvent): M3Event {
  switch (event.type) {
    case 'tool/call':
      return {
        type: 'tool.call',
        payload: {
          toolId: event.data.name,
          args: safeJsonParse(event.data.arguments),
          stepId: event.data.step,
        },
      }
    case 'tool/result':
      return {
        type: 'tool.result',
        payload: {
          toolId: String(event.data.message.toolCallId),
          ok: event.data.message.isError !== true,
          ...event.data.error?.reason === undefined ? {} : { error: event.data.error.reason },
          stepId: event.data.step,
        },
      }
    case 'assistant/message': {
      const usage = event.data.usage
      const payload: Record<string, unknown> = {}
      if (usage !== undefined) {
        payload.tokens = {
          input: usage.inputTokens,
          output: usage.outputTokens,
          ...usage.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens },
          ...usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens },
        }
      }
      return { type: 'llm.usage', payload }
    }
    case 'step/start':
      return { type: 'step.start', payload: { stepId: event.data.step } }
    case 'step/end':
      return { type: 'step.complete', payload: { stepId: event.data.step, outcome: 'success' } }
    case 'turn/start':
      return { type: 'session.start', payload: {} }
    case 'turn/end':
      return { type: 'run.complete', payload: { outcome: String(event.data.reason) } }
    default:
      return { type: event.type, payload: (event.data ?? {}) as Record<string, unknown> }
  }
}
