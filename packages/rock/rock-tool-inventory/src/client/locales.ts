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
  'transcript.title': 'Detection',
  'transcript.openSession': 'Open in session',
  'transcript.toolCall': 'Run:',
  'transcript.toolResult': 'Done:',
  'transcript.failed': 'Failed:',
  'transcript.ongoing': 'Detecting…',
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
  'transcript.title': '探测过程',
  'transcript.openSession': '在会话中查看',
  'transcript.toolCall': '运行：',
  'transcript.toolResult': '完成：',
  'transcript.failed': '失败：',
  'transcript.ongoing': '正在检测…',
}
