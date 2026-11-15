/** Rock onboarding panel: paste the employee connector key to connect the workbench. */
import { useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorIdentity } from '@rock/rock-onboarding/types'
import css from './rock-onboarding.module.css'

/** Host operations injected into the Cordis-free onboarding component. */
export interface AddKeySectionInjected {
  remote: {
    addKey(key: string): Promise<RemoteResult<ConnectorIdentity>>
  }
  layout: {
    selectPanel(id: MainPanelId): void
  }
}

export type AddKeySectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-onboarding'> & InjectFace<AddKeySectionInjected>

/** Render the connector-key entry form. */
export function AddKeySection({ t, remote, layout }: AddKeySectionProps): ReactElement {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void remote.addKey(key).then((result) => {
      if (result.ok) {
        setError(null)
        setToast({ text: t('toast.added'), key: Date.now() })
        layout.selectPanel('rock-overview' as MainPanelId)
      } else {
        setError(t('error.invalid'))
      }
    })
  }

  return (
    <div className={css.root}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      <form className={css.form} onSubmit={submit}>
        <Input
          value={key}
          onChange={(event) => { setKey(event.target.value) }}
          placeholder={t('placeholder')}
          aria-label={t('title')}
        />
        <Button type="submit" variant="primary" size="sm">{t('submit')}</Button>
      </form>
      {error !== null && <p className={css.error}>{error}</p>}
      {toast !== null && <Toast key={toast.key} text={toast.text} tone="success" onDone={() => { setToast(null) }} />}
    </div>
  )
}
