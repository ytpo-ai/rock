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
  'detect.lastRun': 'Last detected: {time}',
  'debug.action': 'Debug',
  'debug.running': 'Debugging…',
  'debug.pass': 'Debug passed',
  'debug.fail': 'Debug failed',
  'config.action': 'Configure',
  'config.title': 'Configure {tool}',
  'config.url': 'URL',
  'config.urlPlaceholder': 'Leave blank to auto-detect',
  'config.token': 'Token',
  'config.tokenPlaceholder': 'Secret token or password',
  'config.tokenRequired': 'Token is required',
  'config.cancel': 'Cancel',
  'config.save': 'Save',
  'load.failed': 'Could not load runners.',
  'load.retry': 'Retry',
  'progress.current': 'Running: {command}',
  'progress.done': 'Done',
  'progress.viewSession': 'View session',
} as const

/** Locale keys. */
export type RockToolInventoryKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockToolInventoryKey, string> = {
  nav: '执行器',
  empty: '未配置工具探测。',
  'action.install': '安装文档',
  'status.running': '运行中',
  'status.installed': '已安装',
  'status.missing': '未安装',
  'detect.action': '检测',
  'detect.running': '检测中…',
  'detect.lastRun': '上次检测：{time}',
  'debug.action': '调试',
  'debug.running': '调试中…',
  'debug.pass': '调试通过',
  'debug.fail': '调试未通过',
  'config.action': '配置',
  'config.title': '配置 {tool}',
  'config.url': '地址',
  'config.urlPlaceholder': '留空自动检测',
  'config.token': '令牌',
  'config.tokenPlaceholder': '密钥令牌或密码',
  'config.tokenRequired': '令牌必填',
  'config.cancel': '取消',
  'config.save': '保存',
  'load.failed': '加载执行器失败',
  'load.retry': '重试',
  'progress.current': '正在执行：{command}',
  'progress.done': '已完成',
  'progress.viewSession': '查看会话详情',
}
