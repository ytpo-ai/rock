/** Rock tool inventory panel copy, owned by the Rock workbench. */

export const NS = 'rock-tool-inventory'

/** English dictionary. */
export const en = {
  nav: 'Tools',
  'column.tool': 'Tool',
  'column.status': 'Status',
  'column.version': 'Version',
  'column.install': 'Install',
  'status.installed': 'Installed',
  'status.missing': 'Not installed',
  'action.install': 'Install docs',
  empty: 'No tool probes configured.',
} as const

/** Locale keys. */
export type RockToolInventoryKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockToolInventoryKey, string> = {
  nav: '工具识别',
  'column.tool': '工具',
  'column.status': '状态',
  'column.version': '版本',
  'column.install': '安装',
  'status.installed': '已安装',
  'status.missing': '未安装',
  'action.install': '安装文档',
  empty: '未配置工具探测。',
}
