/** Rock bot manager Settings section: register locale and the section entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@rock/rock-bot-manager/remote'
import { NS, en, zh } from './locales.ts'
import type { RockBotManagerKey } from './locales.ts'
import { RockBotManagerSection, type RockBotManagerSectionInjected } from './RockBotManagerSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-bot-manager': RockBotManagerKey }
}

/** Services required before the Settings section mounts. */
export const inject = ['slots', 'locale', 'remote']

/** Register the locale dictionary and the Settings section entry. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-bot-manager: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'rock-bot-manager',
    order: 10,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: (): RockBotManagerSectionInjected => ({ remote: ctx.remote.rockBots }),
  }, RockBotManagerSection))
}
