/**
 * Pure assembly of the DSH custom-model-API checklist for one cloud bot: derive
 * the provider id, relay base URL, protocol, model id, and local key from the
 * relay facts. Kept synchronous and free of the controller so it stays unit-testable.
 *
 * @module @rock/rock-bot-manager/proxy
 */
import type { LlmProxyChecklist, WireProtocol } from './types.ts'

/** The DSH provider protocol the relay exposes for the default chat-completions wire protocol. */
export const RELAY_PROTOCOL = 'OpenAI Chat Completions'

/** The placeholder model id used when a bot's real model id is unavailable; Seagull routes by bot binding. */
export const RELAY_MODEL = 'seagull-relay'

/** DSH provider display protocol per wire protocol. */
const WIRE_PROTOCOL_DISPLAY: Readonly<Record<WireProtocol, string>> = {
  'chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}

/** Relay facts needed to build a checklist (structurally minimal). */
export interface RelayFacts {
  /** Loopback relay origin, e.g. `http://127.0.0.1:4090`. */
  baseUrl: string
  /** Local inbound bearer key. */
  apiKey: string
}

/** Whether a string is one of the three wire protocols the relay routes. */
export function isWireProtocol(value: string): value is WireProtocol {
  return value === 'chat-completions' || value === 'openai-responses' || value === 'anthropic-messages'
}

/**
 * The wire protocol to deploy by default: `chat-completions` when supported,
 * otherwise the first supported protocol, otherwise `chat-completions`.
 * @param supported - the bot's supported wire protocols, or undefined when unknown.
 * @returns the default wire protocol.
 */
export function defaultWireProtocol(supported: readonly string[] | undefined): WireProtocol {
  const candidates = (supported ?? []).filter(isWireProtocol)
  if (candidates.includes('chat-completions')) return 'chat-completions'
  return candidates[0] ?? 'chat-completions'
}

/** Build the DSH custom-model-API checklist for one cloud bot. */
export function buildLlmProxyChecklist(
  id: string,
  name: string,
  modelId: string,
  facts: RelayFacts,
  wireProtocol: WireProtocol,
  supportedProtocols?: string[],
): LlmProxyChecklist {
  return {
    botId: id,
    providerId: providerIdFor(id),
    displayName: name,
    baseUrl: `${facts.baseUrl.replace(/\/$/, '')}/v1/bots/${encodeURIComponent(id)}`,
    protocol: WIRE_PROTOCOL_DISPLAY[wireProtocol],
    wireProtocol,
    apiKey: facts.apiKey,
    modelId,
    modelName: `${modelId}/${name}`,
    ...supportedProtocols === undefined ? {} : { supportedProtocols },
  }
}

/** Derive a DSH provider id from an agent bot id (lowercase letters/digits/hyphens only). */
export function providerIdFor(agentBotId: string): string {
  const slug = agentBotId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return `rock-${slug === '' ? 'bot' : slug}`
}
