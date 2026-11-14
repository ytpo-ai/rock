/** The sidebar's Rock overview entry icon; the sidebar owns the button and label around it. */
import type { ReactNode } from 'react'
import { IconLayersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the layers glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function OverviewPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLayersOutlineRegular size={size} />
}
