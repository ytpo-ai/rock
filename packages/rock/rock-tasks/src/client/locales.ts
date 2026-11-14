/** Rock task console copy, owned by the Rock workbench. */

export const NS = 'rock-tasks'

/** English dictionary. */
export const en = {
  'overview.nav': 'Overview',
  'overview.empty': 'No tasks for the claimed bots yet.',
  'overview.running': 'running',
  'overview.idle': 'idle',
  'tasks.nav': 'Tasks',
  'tasks.empty': 'No tasks in the queue yet.',
  'tasks.column.title': 'Title',
  'tasks.column.type': 'Type',
  'tasks.column.status': 'Status',
  'tasks.column.owner': 'Bot',
} as const

/** Locale keys. */
export type RockTasksKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockTasksKey, string> = {
  'overview.nav': '概览',
  'overview.empty': '认领的 bot 暂无任务。',
  'overview.running': '执行中',
  'overview.idle': '空闲',
  'tasks.nav': '任务管理',
  'tasks.empty': '队列中暂无任务。',
  'tasks.column.title': '标题',
  'tasks.column.type': '类型',
  'tasks.column.status': '状态',
  'tasks.column.owner': 'Bot',
}
