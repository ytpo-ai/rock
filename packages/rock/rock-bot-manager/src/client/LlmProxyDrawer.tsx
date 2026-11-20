/** Right-side drawer listing the DSH custom-model-API fields for one cloud bot, each with a copy button. */
import type { ReactElement } from 'react'
import { Button, Modal, useClipboardCopy } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmProxyChecklist } from '@rock/rock-bot-manager/types'
import type { RockBotManagerKey } from './locales.ts'
import css from './rock-bot-manager.module.css'

/** Props for the LLM proxy drawer. */
export interface LlmProxyDrawerProps {
  /** Namespace-bound translate. */
  t: (key: RockBotManagerKey) => string
  /** The checklist to render and copy. */
  checklist: LlmProxyChecklist
  /** Close the drawer. */
  onClose: () => void
}

/** One field row: localized label, copyable value, and a copy button. */
function CopyRow({ label, value, copyLabel, copiedLabel }: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}): ReactElement {
  const { copied, onCopy } = useClipboardCopy(value)
  return (
    <div className={css.proxyField}>
      <div className={css.proxyFieldMeta}>
        <span className={css.proxyFieldLabel}>{label}</span>
        <span className={css.proxyFieldValue}>{value}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={onCopy}>
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}

/** Render the LLM proxy checklist drawer. */
export function LlmProxyDrawer({ t, checklist, onClose }: LlmProxyDrawerProps): ReactElement {
  const copyLabel = t('proxy.copy')
  const copiedLabel = t('proxy.copied')
  return (
    <Modal open onClose={onClose} title={t('proxy.title')} headless className={css.proxyDrawer ?? ''}>
      <header className={css.proxyHeader}>
        <h2 className={css.proxyTitle}>{t('proxy.title')}</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('proxy.close')}>{t('proxy.close')}</Button>
      </header>
      <div className={css.proxyBody}>
        <p className={css.proxyDescription}>{t('proxy.description')}</p>
        <section className={css.proxySection}>
          <h3 className={css.proxySectionTitle}>{t('proxy.section.provider')}</h3>
          <CopyRow label={t('proxy.providerId')} value={checklist.providerId} copyLabel={copyLabel} copiedLabel={copiedLabel} />
          <CopyRow label={t('proxy.displayName')} value={checklist.displayName} copyLabel={copyLabel} copiedLabel={copiedLabel} />
          <CopyRow label={t('proxy.baseUrl')} value={checklist.baseUrl} copyLabel={copyLabel} copiedLabel={copiedLabel} />
          <CopyRow label={t('proxy.protocol')} value={checklist.protocol} copyLabel={copyLabel} copiedLabel={copiedLabel} />
          <CopyRow label={t('proxy.apiKey')} value={checklist.apiKey} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </section>
        <section className={css.proxySection}>
          <h3 className={css.proxySectionTitle}>{t('proxy.section.model')}</h3>
          <CopyRow label={t('proxy.modelId')} value={checklist.modelId} copyLabel={copyLabel} copiedLabel={copiedLabel} />
          <div className={css.proxyField}>
            <div className={css.proxyFieldMeta}>
              <span className={css.proxyFieldLabel}>{t('proxy.inputTypes')}</span>
              <span className={css.proxyFieldValue}>{t('proxy.inputTypes.value')}</span>
            </div>
          </div>
        </section>
        <p className={css.proxyNote}>{t('proxy.note')}</p>
      </div>
      <footer className={css.proxyFooter}>
        <Button variant="primary" onClick={onClose}>{t('proxy.close')}</Button>
      </footer>
    </Modal>
  )
}
