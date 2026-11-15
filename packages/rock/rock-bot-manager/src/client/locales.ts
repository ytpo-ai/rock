/** Rock bot manager section copy, owned by the Rock workbench. */

export const NS = 'rock-bot-manager'

/** English dictionary. */
export const en = {
  nav: 'Agent bots',
  empty: 'No bots yet. Add one below.',
  add: 'Add bot',
  'form.name': 'Name',
  'form.provider': 'LLM provider',
  'form.model': 'Model',
  'form.toolType': 'Tool',
  'form.submit': 'Add',
  delete: 'Delete',
  'source.local': 'Local',
  'source.claimed': 'Claimed',
  'source.assistant': 'Assistant',
  cloudManaged: 'Cloud managed',
  notInstalled: 'not installed',
  'deleteConfirm.title': 'Delete bot',
  'deleteConfirm.description': 'This cannot be undone.',
  'deleteConfirm.confirm': 'Delete',
  'deleteConfirm.cancel': 'Cancel',
  'toast.created': 'Bot added',
  'toast.rebound': 'Binding updated',
  'toast.deleted': 'Bot deleted',
} as const

/** Locale keys. */
export type RockBotManagerKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockBotManagerKey, string> = {
  nav: 'Agent Bot 管理',
  empty: '暂无 bot，请在下方添加',
  add: '添加 bot',
  'form.name': '名称',
  'form.provider': 'LLM provider',
  'form.model': '模型',
  'form.toolType': '工具',
  'form.submit': '添加',
  delete: '删除',
  'source.local': '本地',
  'source.claimed': '认领',
  'source.assistant': '专属助理',
  cloudManaged: '云端管理',
  notInstalled: '未安装',
  'deleteConfirm.title': '删除 Bot',
  'deleteConfirm.description': '删除后不可恢复',
  'deleteConfirm.confirm': '删除',
  'deleteConfirm.cancel': '取消',
  'toast.created': '已添加 bot',
  'toast.rebound': '已更新绑定',
  'toast.deleted': '已删除 bot',
}
