/** Rock onboarding wizard copy, owned by the Rock workbench. */

export const NS = 'rock-onboarding'

/** English dictionary. */
export const en = {
  title: 'Add your connector key',
  description: 'Connect this workbench to Seagull with the key from your personal center.',
  'baseUrl.label': 'Seagull base URL',
  'key.label': 'Connector key',
  placeholder: 'sk-connector-...',
  submit: 'Connect',
  'submit.pending': 'Connecting…',
  cancel: 'Cancel',
  'error.invalid': 'Invalid connector key',
  'error.generic': 'Something went wrong, please try again',
  'workspace.title': 'Set your workspace',
  'workspace.description': 'Choose a local directory as the default working directory and archive root for all Rock tasks.',
  'workspace.label': 'Workspace directory',
  'workspace.browse': 'Browse',
  'workspace.submit': 'Confirm',
  'workspace.pending': 'Initializing…',
  'workspace.useDefault': 'Use default',
  'workspace.error': 'Failed to initialize workspace',
  'workspace.errorEmpty': 'Enter a workspace directory',
} as const

/** Locale keys. */
export type RockOnboardingKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockOnboardingKey, string> = {
  title: '添加你的 Connector Key',
  description: '用个人中心的 key 连接本工作台到 Seagull',
  'baseUrl.label': 'Seagull 基础 URL',
  'key.label': 'Connector Key',
  placeholder: 'sk-connector-...',
  submit: '连接',
  'submit.pending': '连接中…',
  cancel: '取消',
  'error.invalid': 'Connector Key 无效',
  'error.generic': '操作失败，请稍后重试',
  'workspace.title': '设置全局工作空间',
  'workspace.description': '选择一个本地目录，作为所有 Rock 任务的默认工作目录与归档根',
  'workspace.label': '工作空间目录',
  'workspace.browse': '选择目录',
  'workspace.submit': '确认',
  'workspace.pending': '初始化中…',
  'workspace.useDefault': '使用默认',
  'workspace.error': '工作空间初始化失败',
  'workspace.errorEmpty': '请输入工作空间目录',
}
