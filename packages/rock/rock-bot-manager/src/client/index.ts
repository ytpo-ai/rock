/** Rock bot manager Settings section: mount the Remote and register the section entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import remote from '@rock/rock-bot-manager/remote'
import { NS, en, zh } from './locales.ts'
import type { RockBotManagerKey } from './locales.ts'
import { RockBotManagerSection, type RockBotManagerSectionInjected } from './RockBotManagerSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-bot-manager': RockBotManagerKey }
}

/** Services required before the Remote namespace mounts. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the Remote namespace, then register the locale dictionary and Settings section in a child context. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockBots', 'slots', 'locale'], registerSection)
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-bot-manager: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'rock-bot-manager',
    order: 10,
    label: () => t('nav'),
    locale: NS,
    inject: (): RockBotManagerSectionInjected => ({ remote: ctx.remote.rockBots }),
  }, RockBotManagerSection))
}
