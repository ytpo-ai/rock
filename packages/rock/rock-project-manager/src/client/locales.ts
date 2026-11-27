/** Rock project manager section copy, owned by the Rock workbench. */

export const NS = 'rock-project-manager'

/** English dictionary. */
export const en = {
  nav: 'Projects',
  'page.title': 'Projects',
  'page.description': 'Projects you participate in, synced to this workbench.',
  refresh: 'Sync',
  'refresh.title': 'Sync the project list',
  'sync.syncing': 'Syncing…',
  'search.placeholder': 'Search projects',
  empty: 'No projects yet. Projects you participate in appear here after sync.',
  'empty.filtered': 'No projects match the current search.',
  'load.failed': 'Could not load projects.',
  'load.retry': 'Retry',
  'dir.current': 'Directory',
  'dir.default': 'Default',
  'dir.custom': 'Custom',
  'dir.set': 'Set directory',
  'dir.title': 'Project directory',
  'dir.description': 'Choose where this project runs on this workbench.',
  'dir.input': 'Working directory',
  'dir.hint': 'Leave empty to use the default directory.',
  'dir.defaultValue': 'Default directory',
  'dir.save': 'Save',
  'dir.cancel': 'Cancel',
  'dir.reset': 'Reset to default',
  'toast.saved': 'Directory saved',
  'toast.reset': 'Reset to default',
} as const

export type RockProjectManagerKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<RockProjectManagerKey, string> = {
  nav: '项目',
  'page.title': '项目管理',
  'page.description': '你参与的项目，已同步到本工作台',
  refresh: '同步',
  'refresh.title': '同步项目列表',
  'sync.syncing': '同步中…',
  'search.placeholder': '搜索项目',
  empty: '暂无项目，你参与的项目同步后会显示在这里',
  'empty.filtered': '当前搜索条件下暂无项目',
  'load.failed': '加载项目失败',
  'load.retry': '重试',
  'dir.current': '目录',
  'dir.default': '默认',
  'dir.custom': '自定义',
  'dir.set': '设置目录',
  'dir.title': '项目目录',
  'dir.description': '选择该项目在本工作台上的工作目录',
  'dir.input': '工作目录',
  'dir.hint': '留空则使用默认目录',
  'dir.defaultValue': '默认目录',
  'dir.save': '保存',
  'dir.cancel': '取消',
  'dir.reset': '重置为默认',
  'toast.saved': '目录已保存',
  'toast.reset': '已重置为默认',
}
