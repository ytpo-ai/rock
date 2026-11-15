/** Rock onboarding dialog: paste the employee connector key and Seagull base URL. */
import { useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorIdentity } from '@rock/rock-onboarding/types'
import css from './rock-onboarding.module.css'

const DEFAULT_BASE_URL = 'http://localhost:3100'

/** Host operations injected into the Cordis-free onboarding dialog. */
export interface AddKeyDialogInjected {
  remote: {
    hasKey(): Promise<RemoteResult<boolean>>
    addKey(baseUrl: string, key: string): Promise<RemoteResult<ConnectorIdentity>>
  }
}

export type AddKeyDialogProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<'rock-onboarding'> & InjectFace<AddKeyDialogInjected>

/** Render the add-key dialog on first run; nothing once a key exists. */
export function AddKeyDialog({ t, remote }: AddKeyDialogProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void remote.hasKey().then((result) => { if (!cancelled && result.ok && !result.value) setOpen(true) })
    return () => { cancelled = true }
  }, [remote])

  const submit = (): void => {
    void remote.addKey(baseUrl, key).then((result) => {
      if (result.ok) {
        setError(null)
        setOpen(false)
      } else {
        setError(t('error.invalid'))
      }
    })
  }

  return (
    <Modal
      open={open}
      title={t('title')}
      description={t('description')}
      closeLabel={t('cancel')}
      onClose={() => { setOpen(false) }}
      footer={(
        <>
          <Button variant="outline" onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
          <Button variant="primary" data-modal-autofocus onClick={submit}>{t('submit')}</Button>
        </>
      )}
    >
      <div className={css.body}>
        <Input
          value={baseUrl}
          onChange={(event) => { setBaseUrl(event.target.value) }}
          placeholder={DEFAULT_BASE_URL}
          aria-label={t('baseUrl.label')}
        />
        <Input
          value={key}
          onChange={(event) => { setKey(event.target.value) }}
          placeholder={t('placeholder')}
          aria-label={t('key.label')}
        />
        {error !== null && <p role="alert" className={css.error}>{error}</p>}
      </div>
    </Modal>
  )
}
