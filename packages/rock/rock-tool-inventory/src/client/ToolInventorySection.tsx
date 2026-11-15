/** Rock tool inventory panel: read-only list of detected agent tools. */
import { useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ToolStatus } from '@rock/rock-tool-inventory/types'
import css from './rock-tool-inventory.module.css'

/** Host operations injected into the Cordis-free read-only component. */
export interface ToolInventorySectionInjected {
  remote: {
    listTools(): Promise<RemoteResult<ToolStatus[]>>
  }
}

export type ToolInventorySectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tool-inventory'> & InjectFace<ToolInventorySectionInjected>

/** Render the detected agent tools and their versions. */
export function ToolInventorySection({ t, remote }: ToolInventorySectionProps): ReactElement {
  const [tools, setTools] = useState<ToolStatus[]>([])
  useEffect(() => {
    let cancelled = false
    void remote.listTools().then((result) => {
      if (!cancelled && result.ok) setTools(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  if (tools.length === 0) {
    return <p className={css.empty}>{t('empty')}</p>
  }
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th scope="col">{t('column.tool')}</th>
          <th scope="col">{t('column.status')}</th>
          <th scope="col">{t('column.version')}</th>
          <th scope="col">{t('column.install')}</th>
        </tr>
      </thead>
      <tbody>
        {tools.map(tool => (
          <tr key={tool.id}>
            <td>{tool.id}</td>
            <td>{tool.installed ? t('status.installed') : t('status.missing')}</td>
            <td>{tool.version ?? '—'}</td>
            <td>
              {!tool.installed && tool.installDocUrl !== undefined
                ? <a href={tool.installDocUrl} target="_blank" rel="noreferrer">{t('action.install')}</a>
                : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
