/** The Rock brand name occupant; "Rock" is a product proper noun. */
import type { ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the Rock brand name the sidebar shows beside the mark.
 * @param _props - the sidebar's brand-name share (unused).
 * @returns the brand-name element.
 */
export function RockBrandName(_props: PropsRuntime<'sidebar.brand.name'>): ReactElement {
  return <span>Rock</span>
}
