import type { WireProtocol } from '@rock/rock-bot-manager/types'
import type { RockBotManagerKey } from './locales.ts'

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

/**
 * Localize one wire-protocol value from a cloud bot's bound channel.
 * Unknown values fall back to the raw string so an unexpected upstream value
 * never crashes the panel.
 * @param t - namespace-bound translate.
 * @param protocol - wire protocol value (`anthropic-messages` / `openai-responses` / `chat-completions`).
 * @returns the localized label.
 */
export function wireProtocolLabel(t: (key: RockBotManagerKey) => string, protocol: string): string {
  switch (protocol) {
    case 'anthropic-messages': return t('wireProtocol.anthropic-messages')
    case 'openai-responses': return t('wireProtocol.openai-responses')
    case 'chat-completions': return t('wireProtocol.chat-completions')
    default: return protocol
  }
}
