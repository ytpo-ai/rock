/** Rock onboarding client: register the connector-key panel and first-run landing. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import remote from '@rock/rock-onboarding/remote'
import { NS, en, zh } from './locales.ts'
import type { RockOnboardingKey } from './locales.ts'
import { AddKeySection, type AddKeySectionInjected } from './AddKeySection.tsx'
import { AddKeyPanelIcon } from './AddKeyPanelIcon.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-onboarding': RockOnboardingKey }
}

/** The panel id the first-run onboarding opens on. */
export const PANEL_ID = 'rock-add-key' as MainPanelId

/** Services required before the Remote namespace mounts and the panel registers. */
export const inject = ['remote', 'slots', 'locale', 'layout']

/** Mount the Remote namespace, then register the locale dictionary and the panel. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockOnboarding', 'slots', 'locale', 'layout'], registerPanel)
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

/** Register the locale dictionary, the add-key panel, and the first-run landing. */
function registerPanel(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-onboarding: dictionaries')
  const inject = (): AddKeySectionInjected => ({ remote: ctx.remote.rockOnboarding, layout: ctx.layout })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS, inject,
  }, AddKeySection))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: () => t('nav'), locale: NS,
  }, AddKeyPanelIcon))

  // First run: land on the add-key panel instead of the overview panel.
  ctx.effect(() => {
    let landed = false
    const selectDefault = (): void => {
      if (landed) return
      if (!ctx.slots.entries('main').some(entry => entry.options.key === PANEL_ID)) return
      void ctx.remote.rockOnboarding.hasKey().then((result) => {
        if (landed || !result.ok || result.value) return
        landed = true
        ctx.layout.selectPanel(PANEL_ID)
      })
    }
    selectDefault()
    return ctx.slots.subscribe('main', selectDefault)
  }, 'rock-onboarding: first-run landing')
}
