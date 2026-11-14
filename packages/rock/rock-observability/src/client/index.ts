/** Rock observability Settings section: mount the Remote and register the section entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import remote from '@rock/rock-observability/remote'
import { NS, en, zh } from './locales.ts'
import type { RockObservabilityKey } from './locales.ts'
import { RockObservabilitySection, type RockObservabilitySectionInjected } from './RockObservabilitySection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-observability': RockObservabilityKey }
}

/** Services required before the Remote namespace mounts. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the Remote namespace, then register the locale dictionary and Settings section in a child context. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockObservability', 'slots', 'locale'], registerSection)
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

/** Register the locale dictionary and the Settings section entry. */
function registerSection(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-observability: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'rock-observability',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: (): RockObservabilitySectionInjected => ({ remote: ctx.remote.rockObservability }),
  }, RockObservabilitySection))
}
