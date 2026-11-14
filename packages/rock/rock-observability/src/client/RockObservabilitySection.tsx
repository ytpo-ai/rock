/** Read-only Rock observability table contributed to the Settings page. */
import { useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservabilityRow } from '@rock/rock-observability/types'
import css from './rock-observability.module.css'

/** Host operations injected into the Cordis-free table component. */
export interface RockObservabilitySectionInjected {
  /** The Remote fold: reads the aggregated local session rows. */
  remote: {
    rows(): Promise<RemoteResult<ObservabilityRow[]>>
  }
}

export type RockObservabilitySectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'rock-observability'> & InjectFace<RockObservabilitySectionInjected>

/** Render the local sessions and their turns/steps/output-token figures. */
export function RockObservabilitySection({ t, remote }: RockObservabilitySectionProps): ReactElement {
  const [rows, setRows] = useState<ObservabilityRow[]>([])
  useEffect(() => {
    let cancelled = false
    void remote.rows().then((result) => {
      if (!cancelled && result.ok) setRows(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  if (rows.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th scope="col">{t('column.session')}</th>
          <th scope="col">{t('column.turns')}</th>
          <th scope="col">{t('column.steps')}</th>
          <th scope="col">{t('column.tokens')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.sessionId}>
            <td>{row.sessionId}</td>
            <td>{row.turns}</td>
            <td>{row.steps}</td>
            <td>{row.outputTokens}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
