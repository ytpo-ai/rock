/** Rock observability section copy, owned by the Rock workbench. */

export const NS = 'rock-observability'

/** English dictionary. */
export const en = {
  nav: 'Log',
  'tab.label': 'Rock logs',
  'tab.relay': 'Relay forwards',
  'tab.adapter': 'Adapter requests',
  'toolbar.refresh': 'Refresh',
  'filter.bot': 'Bot',
  'filter.all': 'All bots',
  'display.button': 'Rows',
  'display.title': 'Log display',
  'display.hint': 'How many entries each log page loads',
  'display.presets': 'Recommended',
  'display.manual': 'Custom count',
  'display.invalid': 'Enter a whole number from 1 to 500',
  'display.cancel': 'Cancel',
  'display.apply': 'Apply',
  'relay.empty': 'No relay forwards yet.',
  'relay.column.time': 'Time',
  'relay.column.bot': 'Bot',
  'relay.column.tool': 'Tool',
  'relay.column.session': 'Session',
  'relay.column.path': 'Path',
  'relay.column.model': 'Model',
  'relay.column.status': 'Status',
  'relay.column.duration': 'Duration',
  'adapter.empty': 'No adapter requests yet.',
  'adapter.column.time': 'Time',
  'adapter.column.bot': 'Bot',
  'adapter.column.provider': 'Provider',
  'adapter.column.session': 'Session',
  'adapter.column.model': 'Model',
  'adapter.column.tokens': 'Tokens in → out',
  'adapter.column.status': 'Status',
  'adapter.column.duration': 'Duration',
  'loadOlder.loading': 'Loading earlier logs…',
  'loadOlder.done': 'Already at the earliest record',
  'loadOlder.failed': 'Failed to load earlier logs',
  'loadOlder.retry': 'Retry',
} as const

/** Locale keys. */
export type RockObservabilityKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockObservabilityKey, string> = {
  nav: '日志',
  'tab.label': 'Rock 日志',
  'tab.relay': '转发日志',
  'tab.adapter': 'Adapter 请求',
  'toolbar.refresh': '刷新',
  'filter.bot': 'Bot',
  'filter.all': '全部 Bot',
  'display.button': '每页条数',
  'display.title': '日志显示设置',
  'display.hint': '每个日志页加载的条目数',
  'display.presets': '推荐',
  'display.manual': '手动填写',
  'display.invalid': '请填写 1 到 500 的整数',
  'display.cancel': '取消',
  'display.apply': '应用',
  'relay.empty': '暂无转发日志',
  'relay.column.time': '时间',
  'relay.column.bot': 'Bot',
  'relay.column.tool': '工具',
  'relay.column.session': '会话',
  'relay.column.path': '路径',
  'relay.column.model': '模型',
  'relay.column.status': '状态',
  'relay.column.duration': '用时',
  'adapter.empty': '暂无 Adapter 请求日志',
  'adapter.column.time': '时间',
  'adapter.column.bot': 'Bot',
  'adapter.column.provider': 'Provider',
  'adapter.column.session': '会话',
  'adapter.column.model': '模型',
  'adapter.column.tokens': '输入 → 输出',
  'adapter.column.status': '状态',
  'adapter.column.duration': '用时',
  'loadOlder.loading': '加载更早日志…',
  'loadOlder.done': '已经是最早的记录',
  'loadOlder.failed': '加载更早日志失败',
  'loadOlder.retry': '重试',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-observability': RockObservabilityKey }
}
