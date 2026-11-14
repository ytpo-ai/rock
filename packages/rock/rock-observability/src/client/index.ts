/** Rock observability Settings section: register locale and the section entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@rock/rock-observability/remote'
import { NS, en, zh } from './locales.ts'
import type { RockObservabilityKey } from './locales.ts'
import { RockObservabilitySection, type RockObservabilitySectionInjected } from './RockObservabilitySection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-observability': RockObservabilityKey }
}

/** Services required before the Settings section mounts. */
export const inject = ['slots', 'locale', 'remote']

/** Register the locale dictionary and the Settings section entry. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-observability: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'rock-observability',
    order: 20,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: (): RockObservabilitySectionInjected => ({ remote: ctx.remote.rockObservability }),
  }, RockObservabilitySection))
}
