/**
 * Pure assembly of the DSH custom-model-API checklist for one cloud bot: derive
 * the provider id, relay base URL, protocol, model id, and local key from the
 * relay facts. Kept synchronous and free of the controller so it stays unit-testable.
 *
 * @module @rock/rock-bot-manager/proxy
 */
import type { LlmProxyChecklist } from './types.ts'

/** The DSH provider protocol the relay exposes (OpenAI-compatible chat completions). */
export const RELAY_PROTOCOL = 'OpenAI Chat Completions'

/** The model id the relay sends upstream; Seagull treats it as "route by bot binding". */
export const RELAY_MODEL = 'seagull-relay'

/** Relay facts needed to build a checklist (structurally minimal). */
export interface RelayFacts {
  /** Loopback relay origin, e.g. `http://127.0.0.1:4090`. */
  baseUrl: string
  /** Local inbound bearer key. */
  apiKey: string
}

/** Build the DSH custom-model-API checklist for one cloud bot. */
export function buildLlmProxyChecklist(id: string, name: string, facts: RelayFacts): LlmProxyChecklist {
  return {
    botId: id,
    providerId: providerIdFor(id),
    displayName: name,
    baseUrl: `${facts.baseUrl.replace(/\/$/, '')}/v1/bots/${encodeURIComponent(id)}`,
    protocol: RELAY_PROTOCOL,
    apiKey: facts.apiKey,
    modelId: RELAY_MODEL,
  }
}

/** Derive a DSH provider id from an agent bot id (lowercase letters/digits/hyphens only). */
export function providerIdFor(agentBotId: string): string {
  const slug = agentBotId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return `rock-${slug === '' ? 'bot' : slug}`
}
