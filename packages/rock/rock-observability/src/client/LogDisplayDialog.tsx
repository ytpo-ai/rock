/**
 * The console's log display setting: how many entries one log page shows. The
 * dialog offers a few recommended page sizes plus one manual entry.
 *
 * @module @rock/rock-observability/client/LogDisplayDialog
 */
import { useState, type ReactElement } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RockObservabilityKey } from './locales.ts'
import { MAX_PAGE_SIZE, PAGE_SIZE_PRESETS } from './paged-logs.ts'
import css from './rock-observability.module.css'

/** The narrow translate seat the console sections share. */
type Translate = (key: RockObservabilityKey) => string

/** Props for the log display settings dialog. */
export interface LogDisplayDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** The page size currently in effect. */
  pageSize: number
  /** Localized copy. */
  t: Translate
  /** Apply one page size and close the dialog. */
  onApply: (pageSize: number) => void
  /** Close without applying. */
  onClose: () => void
}

/**
 * Read one manual page size, or `undefined` when the draft is not a usable count.
 * @param draft - the raw field text.
 * @returns the parsed page size within 1…{@link MAX_PAGE_SIZE}, or undefined.
 */
export function parsePageSize(draft: string): number | undefined {
  const text = draft.trim()
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  return value >= 1 && value <= MAX_PAGE_SIZE ? value : undefined
}

/**
 * Render the log display settings dialog.
 * @param props - the page size in effect, copy, and apply/close callbacks.
 * @returns the dialog element.
 */
export function LogDisplayDialog({ open, pageSize, t, onApply, onClose }: LogDisplayDialogProps): ReactElement | null {
  const [draft, setDraft] = useState(String(pageSize))
  const manual = parsePageSize(draft)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('display.title')}
      closeLabel={t('display.cancel')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('display.cancel')}</Button>
          <Button
            variant="primary"
            disabled={manual === undefined}
            onClick={() => { if (manual !== undefined) onApply(manual) }}
          >
            {t('display.apply')}
          </Button>
        </>
      )}
    >
      <div className={css.displayDialog}>
        <p className={css.displayHint}>{t('display.hint')}</p>
        <div className={css.displayPresets} role="group" aria-label={t('display.presets')}>
          {PAGE_SIZE_PRESETS.map(preset => (
            <Pill
              key={preset}
              active={pageSize === preset}
              onClick={() => { setDraft(String(preset)) }}
            >
              {String(preset)}
            </Pill>
          ))}
        </div>
        <label className={css.displayField}>
          <span className={css.displayLabel}>{t('display.manual')}</span>
          <Input
            type="number"
            min={1}
            max={MAX_PAGE_SIZE}
            value={draft}
            aria-label={t('display.manual')}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </label>
        {manual === undefined && <p className={css.displayError}>{t('display.invalid')}</p>}
      </div>
    </Modal>
  )
}
