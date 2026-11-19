/** Rock tool inventory panel copy, owned by the Rock workbench. */

export const NS = 'rock-tool-inventory'

/** English dictionary. */
export const en = {
  nav: 'Runners',
  empty: 'No tool probes configured.',
  'action.install': 'Install docs',
  'status.running': 'Running',
  'status.installed': 'Installed',
  'status.missing': 'Not installed',
  'detect.action': 'Detect',
  'detect.running': 'Detecting…',
  'load.failed': 'Could not load runners.',
  'load.retry': 'Retry',
  'progress.running': 'Detecting',
  'progress.done': 'Done',
  'progress.current': 'Current: {command}',
  'progress.steps': '{n} commands run',
  'progress.viewSession': 'View session',
} as const

/** Locale keys. */
export type RockToolInventoryKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockToolInventoryKey, string> = {
  nav: '执行器管理',
  empty: '未配置工具探测。',
  'action.install': '安装文档',
  'status.running': '运行中',
  'status.installed': '已安装',
  'status.missing': '未安装',
  'detect.action': '检测',
  'detect.running': '检测中…',
  'load.failed': '加载执行器失败',
  'load.retry': '重试',
  'progress.running': '检测中',
  'progress.done': '已完成',
  'progress.current': '当前：{command}',
  'progress.steps': '已运行 {n} 个命令',
  'progress.viewSession': '查看会话详情',
}
