/** Rock task console panels: mount the Remote and register the overview + task-management entries. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import remote from '@rock/rock-tasks/remote'
import { NS, en, zh } from './locales.ts'
import type { RockTasksKey } from './locales.ts'
import { OverviewSection, type OverviewSectionInjected } from './OverviewSection.tsx'
import { TasksSection, type TasksSectionInjected } from './TasksSection.tsx'
import { OverviewPanelIcon } from './OverviewPanelIcon.tsx'
import { TasksPanelIcon } from './TasksPanelIcon.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-tasks': RockTasksKey }
}

/** The overview panel id (also the console's default landing panel). */
export const OVERVIEW_PANEL_ID = 'rock-overview' as MainPanelId
/** The task-management panel id. */
export const TASKS_PANEL_ID = 'rock-tasks' as MainPanelId

/** Services required before the Remote namespace mounts. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the Remote namespace, then register the locale dictionary and both console panels. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockTasks', 'slots', 'locale'], registerPanels)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

/** Register the locale dictionary, both main panels, and both sidebar entries. */
function registerPanels(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-tasks: dictionaries')
  const inject = (): OverviewSectionInjected => ({ remote: ctx.remote.rockTasks })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: OVERVIEW_PANEL_ID, locale: NS, inject,
  }, OverviewSection))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: OVERVIEW_PANEL_ID, order: -50, label: () => t('overview.nav'), locale: NS,
  }, OverviewPanelIcon))

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: TASKS_PANEL_ID, locale: NS, inject: (): TasksSectionInjected => ({ remote: ctx.remote.rockTasks }),
  }, TasksSection))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: TASKS_PANEL_ID, order: -40, label: () => t('tasks.nav'), locale: NS,
  }, TasksPanelIcon))
}
