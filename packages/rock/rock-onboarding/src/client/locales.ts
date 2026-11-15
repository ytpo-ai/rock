/** Rock onboarding section copy, owned by the Rock workbench. */

export const NS = 'rock-onboarding'

/** English dictionary. */
export const en = {
  nav: 'Add connector key',
  title: 'Add your connector key',
  description: 'Paste the sk-connector key from your personal center to connect this workbench.',
  placeholder: 'sk-connector-...',
  submit: 'Connect',
  'toast.added': 'Connector key added',
  'error.invalid': 'Invalid connector key',
} as const

/** Locale keys. */
export type RockOnboardingKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockOnboardingKey, string> = {
  nav: '添加 Connector Key',
  title: '添加你的 Connector Key',
  description: '从个人中心粘贴 sk-connector key，连接本工作台',
  placeholder: 'sk-connector-...',
  submit: '连接',
  'toast.added': 'Connector Key 已添加',
  'error.invalid': 'Connector Key 无效',
}
