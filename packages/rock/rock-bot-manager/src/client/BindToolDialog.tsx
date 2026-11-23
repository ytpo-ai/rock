/** Bind-execution-tool dialog: pick the backend one bot delegates to and confirm the change. */
import { useState, type ReactElement } from 'react'
import { Button, IconLinkOutlineRegular, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RockBotManagerKey } from './locales.ts'
import css from './rock-bot-manager.module.css'

/** Props for the bind-tool dialog. */
export interface BindToolDialogProps {
  /** Namespace-bound translate. */
  t: (key: RockBotManagerKey) => string
  /** Display name of the bot being bound. */
  botName: string
  /** Tool types the selector offers. */
  toolTypes: readonly string[]
  /** Tool types detected as installed on this machine. */
  installed: ReadonlySet<string>
  /** The bot's current binding; selected first. */
  current: string | undefined
  /** Persist the chosen backend. */
  onConfirm: (toolType: string) => void
  /** Close without changing the binding. */
  onClose: () => void
}

/**
 * Render the bind dialog: one row per tool type with its install state, the
 * current binding preselected, and an explicit confirm step.
 * @param props - localized copy, the offered tools, the current binding, and the confirm/close actions.
 * @returns the confirmation dialog.
 */
export function BindToolDialog({ t, botName, toolTypes, installed, current, onConfirm, onClose }: BindToolDialogProps): ReactElement {
  const [selected, setSelected] = useState<string | undefined>(current)
  const canConfirm = selected !== undefined && selected !== current
  return (
    <Modal
      open
      onClose={onClose}
      title={t('bind.title')}
      description={t('bind.description')}
      closeLabel={t('bind.cancel')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('bind.cancel')}</Button>
          <Button
            variant="primary"
            icon={<IconLinkOutlineRegular size={14} />}
            disabled={!canConfirm}
            onClick={() => { if (selected !== undefined) onConfirm(selected) }}
          >
            {t('bind.confirm')}
          </Button>
        </>
      )}
    >
      <div className={css.bindBody}>
        <p className={css.bindBot}>{botName}</p>
        <ul className={css.bindList} role="radiogroup" aria-label={t('bind.title')}>
          {toolTypes.map((tool) => {
            const isInstalled = installed.has(tool)
            const isCurrent = tool === current
            const isSelected = tool === selected
            return (
              <li key={tool}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!isInstalled && !isCurrent}
                  className={isSelected ? css.bindRowActive : css.bindRow}
                  onClick={() => { setSelected(tool) }}
                >
                  <span className={css.bindRowTool}>{tool}</span>
                  {isCurrent && <Tag tone="info">{t('bind.current')}</Tag>}
                  <Tag tone={isInstalled ? 'success' : 'neutral'}>
                    {isInstalled ? t('bind.installed') : t('notInstalled')}
                  </Tag>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
