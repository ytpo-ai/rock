/** Rock onboarding dialog copy, owned by the Rock workbench. */

export const NS = 'rock-onboarding'

/** English dictionary. */
export const en = {
  title: 'Add your connector key',
  description: 'Connect this workbench to Seagull with the key from your personal center.',
  'baseUrl.label': 'Seagull base URL',
  'key.label': 'Connector key',
  placeholder: 'sk-connector-...',
  submit: 'Connect',
  cancel: 'Cancel',
  'error.invalid': 'Invalid connector key',
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
  cancel: '取消',
  'error.invalid': 'Connector Key 无效',
}
