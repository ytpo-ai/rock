import type { RockBotManagerKey } from './locales.ts'

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
