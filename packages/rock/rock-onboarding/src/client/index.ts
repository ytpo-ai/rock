/** Rock onboarding client: register the connector-key dialog as a shell overlay. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import remote from '@rock/rock-onboarding/remote'
import { NS, en, zh } from './locales.ts'
import type { RockOnboardingKey } from './locales.ts'
import { AddKeyDialog, type AddKeyDialogInjected } from './AddKeyDialog.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rock-onboarding': RockOnboardingKey }
}

/** Services required before the Remote namespace mounts and the overlay registers. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the Remote namespace, then register the locale dictionary and the overlay dialog. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.rockOnboarding', 'slots', 'locale'], registerOverlay)
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

/** Register the locale dictionary and the add-key dialog overlay. */
function registerOverlay(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rock-onboarding: dictionaries')
  const inject = (): AddKeyDialogInjected => ({ remote: ctx.remote.rockOnboarding })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'rock-onboarding.add-key', locale: NS, inject,
  }, AddKeyDialog))
}
