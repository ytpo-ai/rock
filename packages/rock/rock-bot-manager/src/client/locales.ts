/** Rock bot manager section copy, owned by the Rock workbench. */

export const NS = 'rock-bot-manager'

/** English dictionary. */
export const en = {
  nav: 'Rock Bots',
  empty: 'No local bots yet. Add one below.',
  add: 'Add bot',
  'form.id': 'Bot id',
  'form.name': 'Name',
  'form.provider': 'LLM provider',
  'form.model': 'Model',
  'form.toolType': 'Tool',
  'form.submit': 'Add',
  delete: 'Delete',
  'column.id': 'Bot',
  'column.provider': 'Provider',
  'column.model': 'Model',
  'column.tool': 'Tool',
} as const

/** Locale keys. */
export type RockBotManagerKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockBotManagerKey, string> = {
  nav: 'Rock Bot',
  empty: '尚未添加本地 bot，请在下方添加。',
  add: '添加 bot',
  'form.id': 'Bot id',
  'form.name': '名称',
  'form.provider': 'LLM provider',
  'form.model': '模型',
  'form.toolType': '工具',
  'form.submit': '添加',
  delete: '删除',
  'column.id': 'Bot',
  'column.provider': 'Provider',
  'column.model': '模型',
  'column.tool': '工具',
}
