/** Rock observability section copy, owned by the Rock workbench. */

export const NS = 'rock-observability'

/** English dictionary. */
export const en = {
  nav: 'Logs',
  'column.session': 'Session',
  'column.turns': 'Turns',
  'column.steps': 'Steps',
  'column.tokens': 'Output tokens',
  empty: 'No local sessions observed yet.',
} as const

/** Locale keys. */
export type RockObservabilityKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockObservabilityKey, string> = {
  nav: 'Logs',
  'column.session': '会话',
  'column.turns': '轮数',
  'column.steps': '步数',
  'column.tokens': '输出 token',
  empty: '尚未观测到本地会话。',
}
