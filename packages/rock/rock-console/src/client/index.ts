/** Rock workbench console shell, browser half: default landing panel + Rock brand. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { RockBrandName } from './RockBrandName.tsx'

/** The panel the console opens on: the Rock overview panel. */
const DEFAULT_PANEL = 'rock-overview' as MainPanelId

/** Services required before the console shell runs. */
export const inject = ['slots', 'layout']

/**
 * Rock is text-only: the sidebar brand mark seat stays empty so the DSH whale
 * logo fallback never renders beside the "Rock" name.
 * @param _props - the sidebar's brand-mark share (unused).
 * @returns null (render nothing).
 */
function RockBrandMark(_props: PropsRuntime<'sidebar.brand.mark'>): null {
  return null
}

/**
 * Select the default panel once its main-slot occupant registers, and fill the
 * Rock brand (no mark, "Rock" name). Selection happens once; later navigation
 * is the user's own.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
  }, RockBrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
  }, RockBrandName))
  // Browser/window product title; "Rock" is a product proper noun.
  ctx.slots.inject('shell.productTitle', () => ctx.slots.register({
    name: 'shell.productTitle',
    id: 'rock',
    label: 'Rock',
  }, () => null))
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
