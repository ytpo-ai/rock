/** Rock onboarding wizard: two-step first-run flow (connector key → workspace) before the assistant. */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorIdentity } from '@rock/rock-onboarding/types'
import css from './rock-onboarding.module.css'

const DEFAULT_BASE_URL = 'http://localhost:3100'

/** Which onboarding step the dialog is currently showing. */
type Step = 'key' | 'workspace'

/** Host operations injected into the Cordis-free onboarding wizard. */
export interface OnboardingWizardInjected {
  remote: {
    hasKey(): Promise<RemoteResult<boolean>>
    addKey(baseUrl: string, key: string): Promise<RemoteResult<ConnectorIdentity>>
    getOnboardingStatus(): Promise<RemoteResult<string | undefined>>
    getWorkspaceRoot(): Promise<RemoteResult<string | null>>
    getDefaultWorkspaceRoot(): Promise<RemoteResult<string>>
    initializeWorkspace(rootPath: string): Promise<RemoteResult<string>>
  }
  /** Open the assistant session once the key is connected and the workspace is set. */
  onConnected: () => void
  /** Open the host directory chooser, resolving null on cancel (absent choosers fall back to the input). */
  pickDirectory: () => Promise<string | null>
}

export type OnboardingWizardProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<'rock-onboarding'> & InjectFace<OnboardingWizardInjected>

/** Render the first-run wizard on demand; nothing once a key + workspace exist. */
export function OnboardingWizard({ t, remote, onConnected, pickDirectory }: OnboardingWizardProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('key')
  const [submitting, setSubmitting] = useState(false)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [key, setKey] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const defaultWorkspace = useRef('')

  useEffect(() => {
    void (async () => {
      const hasKey = await remote.hasKey()
      if (!hasKey.ok) return
      if (!hasKey.value) {
        setStep('key')
        setOpen(true)
        return
      }
      // Has key: ensure the local workspace first (independent of cloud onboarding status).
      const root = await remote.getWorkspaceRoot()
      if (!root.ok) return
      if (root.value === null || root.value === '') {
        const def = await remote.getDefaultWorkspaceRoot()
        if (def.ok) {
          defaultWorkspace.current = def.value
          setWorkspacePath(def.value)
        }
        setStep('workspace')
        setOpen(true)
        return
      }
      // Workspace ready: open the assistant only while onboarding is still pending.
      const status = await remote.getOnboardingStatus()
      if (!status.ok) return
      if (status.value === 'pending' || status.value === 'in-progress') {
        onConnected()
      }
    })()
  }, [remote, onConnected])

  const submitKey = (): void => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    void remote.addKey(baseUrl, key).then(async (result) => {
      if (!result.ok) {
        setSubmitting(false)
        setError(t('error.invalid'))
        return
      }
      const root = await remote.getWorkspaceRoot()
      if (root.ok && root.value !== null && root.value !== '') {
        setSubmitting(false)
        setOpen(false)
        onConnected()
        return
      }
      const def = await remote.getDefaultWorkspaceRoot()
      if (def.ok && def.value !== '') {
        defaultWorkspace.current = def.value
        setWorkspacePath(def.value)
      }
      setSubmitting(false)
      setStep('workspace')
    }).catch(() => {
      setSubmitting(false)
      setError(t('error.generic'))
    })
  }

  const submitWorkspace = (path: string): void => {
    if (submitting) return
    const trimmed = path.trim()
    if (trimmed === '') {
      setError(t('workspace.errorEmpty'))
      return
    }
    setSubmitting(true)
    setError(null)
    void remote.initializeWorkspace(trimmed).then((result) => {
      setSubmitting(false)
      if (result.ok) {
        setOpen(false)
        onConnected()
      } else {
        setError(t('workspace.error'))
      }
    }).catch(() => {
      setSubmitting(false)
      setError(t('workspace.error'))
    })
  }

  const browse = (): void => {
    void pickDirectory().then((path) => {
      if (path !== null && path.trim() !== '') setWorkspacePath(path)
    }).catch(() => {
      // No native chooser: keep the editable default input.
    })
  }

  const isWorkspace = step === 'workspace'

  return (
    <Modal
      open={open}
      title={isWorkspace ? t('workspace.title') : t('title')}
      description={isWorkspace ? t('workspace.description') : t('description')}
      closeLabel={t('cancel')}
      onClose={() => {
        if (isWorkspace) submitWorkspace(defaultWorkspace.current || workspacePath)
        else setOpen(false)
      }}
      footer={
        isWorkspace
          ? (
            <>
              <Button variant="outline" onClick={() => { submitWorkspace(defaultWorkspace.current || workspacePath) }} disabled={submitting}>
                {t('workspace.useDefault')}
              </Button>
              <Button variant="primary" data-modal-autofocus onClick={() => { submitWorkspace(workspacePath) }} disabled={submitting}>
                {submitting ? t('workspace.pending') : t('workspace.submit')}
              </Button>
            </>
          )
          : (
            <>
              <Button variant="outline" onClick={() => { setOpen(false) }} disabled={submitting}>{t('cancel')}</Button>
              <Button variant="primary" data-modal-autofocus onClick={submitKey} disabled={submitting}>
                {submitting ? t('submit.pending') : t('submit')}
              </Button>
            </>
          )
      }
    >
      {isWorkspace
        ? (
          <div className={css.body}>
            <span className={css.label}>{t('workspace.label')}</span>
            <div className={css.pathRow}>
              <Input
                value={workspacePath}
                onChange={(event) => { setWorkspacePath(event.target.value) }}
                placeholder={defaultWorkspace.current}
                aria-label={t('workspace.label')}
                disabled={submitting}
              />
              <Button variant="outline" onClick={browse} disabled={submitting}>{t('workspace.browse')}</Button>
            </div>
            {error !== null && <p role="alert" className={css.error}>{error}</p>}
          </div>
        )
        : (
          <div className={css.body}>
            <Input
              value={baseUrl}
              onChange={(event) => { setBaseUrl(event.target.value) }}
              placeholder={DEFAULT_BASE_URL}
              aria-label={t('baseUrl.label')}
              disabled={submitting}
            />
            <Input
              value={key}
              onChange={(event) => { setKey(event.target.value) }}
              placeholder={t('placeholder')}
              aria-label={t('key.label')}
              disabled={submitting}
            />
            {error !== null && <p role="alert" className={css.error}>{error}</p>}
          </div>
        )}
    </Modal>
  )
}
