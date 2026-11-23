/** LLM proxy checklist content: the provider and model fields a user pastes into DSH's custom model API. */
import type { ReactElement, ReactNode } from 'react'
import { Button, useClipboardCopy } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmProxyChecklist } from '@rock/rock-bot-manager/types'
import type { RockBotManagerKey } from './locales.ts'
import css from './rock-bot-manager.module.css'

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

/** Props for the proxy checklist content. */
export interface LlmProxyFieldsProps {
  /** Namespace-bound translate. */
  t: (key: RockBotManagerKey) => string
  /** The checklist to render and copy. */
  checklist: LlmProxyChecklist
  /** Rendered above the fields, such as the DSH custom-model-API instruction. */
  intro?: ReactNode
}

/** Render the proxy checklist as provider and model sections of copyable fields. */
export function LlmProxyFields({ t, checklist, intro }: LlmProxyFieldsProps): ReactElement {
  const copyLabel = t('proxy.copy')
  const copiedLabel = t('proxy.copied')
  return (
    <div className={css.proxyBody}>
      {intro}
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
        <CopyRow label={t('proxy.modelName')} value={checklist.modelName} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        <div className={css.proxyField}>
          <div className={css.proxyFieldMeta}>
            <span className={css.proxyFieldLabel}>{t('proxy.inputTypes')}</span>
            <span className={css.proxyFieldValue}>{t('proxy.inputTypes.value')}</span>
          </div>
        </div>
      </section>
      <p className={css.proxyNote}>{t('proxy.note')}</p>
    </div>
  )
}
