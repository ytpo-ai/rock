/** Rock observability section copy, owned by the Rock workbench. */

export const NS = 'rock-observability'

/** English dictionary. */
export const en = {
  nav: 'Log',
  'tab.label': 'Rock logs',
  'tab.relay': 'Relay forwards',
  'tab.sessions': 'Sessions',
  'relay.empty': 'No relay forwards yet.',
  'relay.column.time': 'Time',
  'relay.column.bot': 'Bot',
  'relay.column.tool': 'Tool',
  'relay.column.session': 'Session',
  'relay.column.path': 'Path',
  'relay.column.model': 'Model',
  'relay.column.status': 'Status',
  'relay.column.duration': 'Duration',
  'loadOlder.loading': 'Loading earlier logs…',
  'loadOlder.done': 'Already at the earliest record',
  'loadOlder.failed': 'Failed to load earlier logs',
  'loadOlder.retry': 'Retry',
  'session.empty': 'No local sessions observed yet.',
  'session.column.session': 'Session',
  'session.column.turns': 'Turns',
  'session.column.steps': 'Steps',
  'session.column.tokens': 'Output tokens',
} as const

/** Locale keys. */
export type RockObservabilityKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockObservabilityKey, string> = {
  nav: '日志',
  'tab.label': 'Rock 日志',
  'tab.relay': '转发日志',
  'tab.sessions': '会话',
  'relay.empty': '暂无转发日志',
  'relay.column.time': '时间',
  'relay.column.bot': 'Bot',
  'relay.column.tool': '工具',
  'relay.column.session': '会话',
  'relay.column.path': '路径',
  'relay.column.model': '模型',
  'relay.column.status': '状态',
  'relay.column.duration': '用时',
  'loadOlder.loading': '加载更早日志…',
  'loadOlder.done': '已经是最早的记录',
  'loadOlder.failed': '加载更早日志失败',
  'loadOlder.retry': '重试',
  'session.empty': '尚未观测到本地会话',
  'session.column.session': '会话',
  'session.column.turns': '轮数',
  'session.column.steps': '步数',
  'session.column.tokens': '输出 token',
}
