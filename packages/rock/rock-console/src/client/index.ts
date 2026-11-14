/** Rock workbench console shell, browser half: default landing panel selection. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

/** The panel the console opens on: the Rock overview panel. */
const DEFAULT_PANEL = 'rock-overview' as MainPanelId

/** Services required before the console shell runs. */
export const inject = ['slots', 'layout']

/**
 * Select the default panel once its main-slot occupant registers, so a Rock
 * console without the chat surface still opens on a panel instead of the
 * empty conversation area. Selection happens once; later navigation is the
 * user's own.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    let landed = false
    const selectDefault = (): void => {
      if (landed) return
      if (ctx.slots.entries('main').some(entry => entry.options.key === DEFAULT_PANEL)) {
        landed = true
        ctx.layout.selectPanel(DEFAULT_PANEL)
      }
    }
    selectDefault()
    return ctx.slots.subscribe('main', selectDefault)
  }, 'rock-console: default landing')
}
