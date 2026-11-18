/** Rock observability panel: mount the Remote and register the sidebar entry + main panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import remote from '@rock/rock-observability/remote'
import { NS, en, zh } from './locales.ts'
import type { RockObservabilityKey } from './locales.ts'
import { RockObservabilitySection, type RockObservabilitySectionInjected } from './RockObservabilitySection.tsx'
import { ObservabilityPanelIcon } from './ObservabilityPanelIcon.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-observability': RockObservabilityKey }
}

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'rock-observability' as MainPanelId

/** Services required before the Remote namespace mounts. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the Remote namespace, then register the locale dictionary and the console panel in a child context. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockObservability', 'slots', 'locale'], registerPanel)
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

/** Register the locale dictionary, the main panel, and the sidebar entry. */
function registerPanel(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-observability: dictionaries')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): RockObservabilitySectionInjected => ({ remote: ctx.remote.rockObservability }),
  }, RockObservabilitySection))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: -20,
    label: () => t('nav'),
    locale: NS,
  }, ObservabilityPanelIcon))
}
