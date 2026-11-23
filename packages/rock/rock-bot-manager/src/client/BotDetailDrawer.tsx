/** Bot detail drawer: read-only basics plus every action the card does not carry. */
import { useState, type ReactElement } from 'react'
import { Button, Menu, Modal, StateDot, Tag, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotDebugState, BotDeploymentRow, BotRow, BotSource } from '@rock/rock-bot-manager/types'
import { bindLockedReason, boundToolType, detailActions, supportsTools, type BotDeployStatus } from './bot-card-state.ts'
import type { RockBotManagerKey } from './locales.ts'
import css from './rock-bot-manager.module.css'

/** Tag tone for each bot source. */
function sourceTone(source: BotSource): TagTone {
  switch (source) {
    case 'claimed': return 'info'
    case 'assistant': return 'success'
    case 'local': return 'neutral'
  }
}

/** Tag tone for each deployment status. */
function deploymentTone(status: BotDeployStatus): TagTone {
  switch (status) {
    case 'deployed': return 'success'
    case 'deploying': return 'info'
    case 'failed': return 'danger'
    case 'undeployed': return 'neutral'
  }
}

/** Props for the bot detail drawer. */
export interface BotDetailDrawerProps {
  /** Namespace-bound translate. */
  t: (key: RockBotManagerKey) => string
  /** The bot shown in the drawer. */
  bot: BotRow
  /** Deployment row for the bot, when Rock holds a record or the bot is deployable. */
  deployment: BotDeploymentRow | undefined
  /** The bot's current deployment status. */
  status: BotDeployStatus
  /** Tool types the binding menu offers. */
  toolTypes: readonly string[]
  /** Tool types detected as installed. */
  installed: ReadonlySet<string>
  /** Latest debug state; shown only when it belongs to the bot. */
  debug: BotDebugState | null
  /** Whether a deployment batch is running. */
  deployLocked: boolean
  /** Whether this bot's own deployment request is in flight. */
  deployBusy: boolean
  /** Whether this bot's debug run is starting. */
  debugBusy: boolean
  /** Rebind the bot to one execution backend. */
  onBind: (toolType: string) => void
  /** Deploy (or redeploy) this bot. */
  onDeploy: () => void
  /** Run one debug pass through the bound backend. */
  onDebug: () => void
  /** Open the LLM proxy checklist. */
  onProxy: () => void
  /** Open the edit form (local bots). */
  onEdit: () => void
  /** Ask for deletion confirmation. */
  onDelete: () => void
  /** Close the drawer. */
  onClose: () => void
}

/** One labeled field of the drawer's read-only information. */
function Field(props: { label: string; children: React.ReactNode; wide?: boolean }): ReactElement {
  const { label, children, wide } = props
  const empty = children === undefined || children === null || children === ''
  return (
    <div className={wide === true ? css.detailFieldWide : css.detailField}>
      <span className={css.detailFieldLabel}>{label}</span>
      <span className={css.detailFieldValue}>{empty ? '—' : children}</span>
    </div>
  )
}

/** Render one bot's detail: basics, model route, execution and deployment state, and its actions. */
export function BotDetailDrawer(props: BotDetailDrawerProps): ReactElement {
  const {
    t, bot, deployment, status, toolTypes, installed, debug, deployLocked, deployBusy, debugBusy,
    onBind, onDeploy, onDebug, onProxy, onEdit, onDelete, onClose,
  } = props
  const [bindMenu, setBindMenu] = useState(false)
  const actions = detailActions(bot, deployment?.deployable === true)
  const bound = boundToolType(bot)
  const deployStatusLabel = t(`deploy.status.${status}`)
  const debugState = debug?.botId === bot.id ? debug : undefined
  const llm = bot.llm
  const rebindReason = bindLockedReason(bot, t('status.active'), t('rebind.locked'))
  const toolOptions = toolTypes.map(tool => ({
    id: tool,
    label: installed.has(tool) ? tool : `${tool} · ${t('notInstalled')}`,
    ...tool !== bound && !installed.has(tool) ? { disabled: true } : {},
  }))

  return (
    <Modal open onClose={onClose} title={bot.name} headless className={css.drawer ?? ''}>
      <header className={css.drawerHeader}>
        <div className={css.drawerHeading}>
          <h2 className={css.drawerTitle}>{bot.name}</h2>
          <span className={css.drawerSubtitle}>
            <Tag tone={sourceTone(bot.source)}>{t(`source.${bot.source}`)}</Tag>
            <span className={css.status}>
              <StateDot state={bot.active ? 'ongoing' : 'idle'} />
              {bot.active ? t('status.active') : t('status.idle')}
            </span>
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('detail.close')}>{t('detail.close')}</Button>
      </header>

      <div className={css.drawerBody}>
        <section className={css.detailSection}>
          <h3 className={css.detailSectionTitle}>{t('detail.section.basic')}</h3>
          <div className={css.detailGrid}>
            <Field label={t('detail.name')}>{bot.name}</Field>
            <Field label={t('detail.role')}>{bot.role}</Field>
            <Field label={t('detail.source')}>{t(`source.${bot.source}`)}</Field>
            <Field label={t('detail.project')}>{bot.projectName ?? t('project.global')}</Field>
            <Field label={t('detail.status')}>{bot.active ? t('status.active') : t('status.idle')}</Field>
          </div>
        </section>

        <section className={css.detailSection}>
          <h3 className={css.detailSectionTitle}>{t('detail.section.model')}</h3>
          <div className={css.detailGrid}>
            <Field label={t('detail.provider')}>{llm === undefined ? t('cloudManaged') : llm.provider}</Field>
            <Field label={t('detail.model')}>{llm?.modelName ?? llm?.model}</Field>
            <Field label={t('detail.protocol')}>
              {llm?.protocol === undefined ? undefined : t(`form.protocol.${llm.protocol}`)}
            </Field>
            <Field label={t('form.contextWindow')}>{llm?.contextWindow}</Field>
            <Field label={t('form.maxOutputTokens')}>{llm?.maxOutputTokens}</Field>
            <Field label={t('form.inputTypes')}>
              {llm?.inputTypes === undefined ? undefined : llm.inputTypes.map(type => t(`form.inputTypes.${type}`)).join(' / ')}
            </Field>
            <Field label={t('form.reasoning')} wide>
              {llm?.reasoning?.enabled === true
                ? llm.reasoning.levels.map(row => `${row.level}=${String(row.value)}`).join('，')
                : undefined}
            </Field>
          </div>
        </section>

        {supportsTools(bot) && (
          <section className={css.detailSection}>
            <h3 className={css.detailSectionTitle}>{t('detail.section.execution')}</h3>
            <div className={css.detailGrid}>
              <Field label={t('detail.tool')}>{bound ?? t('bind.pending')}</Field>
              <Field label={t('detail.deployStatus')}>
                <Tag tone={deploymentTone(status)}>{deployStatusLabel}</Tag>
              </Field>
              <Field label={t('detail.deployUpdatedAt')}>
                {deployment?.updatedAt === undefined ? undefined : new Date(deployment.updatedAt).toLocaleString('zh-CN')}
              </Field>
              <Field label={t('detail.deployError')} wide>{deployment?.error}</Field>
              <Field label={t('detail.debugState')} wide>
                {debugState === undefined
                  ? undefined
                  : debugState.running
                    ? t('debug.running')
                    : debugState.result === undefined
                      ? debugState.error
                      : `${debugState.result.ok ? t('debug.pass') : t('debug.fail')} · ${debugState.result.ok ? debugState.result.answer : debugState.result.error}`}
              </Field>
            </div>
            {debugState?.sessionId !== undefined && !debugState.running && (
              <p className={css.detailHint}>{debugState.sessionId}</p>
            )}
          </section>
        )}

        {!supportsTools(bot) && (
          <p className={css.detailHint}>{t('detail.assistantHint')}</p>
        )}
      </div>

      {actions.length > 0 && (
        <footer className={css.drawerFooter}>
          {actions.includes('bind') && (
            <span className={css.drawerAction}>
              <Menu
                open={bindMenu}
                anchor={(
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rebindReason !== undefined}
                    title={rebindReason}
                    onClick={() => { setBindMenu(!bindMenu) }}
                  >
                    {bound === undefined ? t('bind.pending') : t('detail.rebind')}
                  </Button>
                )}
                items={toolOptions}
                selectedId={bound}
                onSelect={(id) => { onBind(id); setBindMenu(false) }}
                onClose={() => { setBindMenu(false) }}
              />
            </span>
          )}
          {actions.includes('deploy') && (
            <Button
              size="sm"
              variant="primary"
              icon={status === 'deploying' || deployBusy ? <StateDot state="ongoing" /> : undefined}
              disabled={deployLocked || status === 'deploying' || deployBusy}
              title={deployLocked && status !== 'deploying' ? t('deploy.running') : undefined}
              onClick={onDeploy}
            >
              {status === 'deploying' || deployBusy
                ? t('deploy.status.deploying')
                : status === 'deployed' || status === 'failed' ? t('deploy.redeploy') : t('deploy.action')}
            </Button>
          )}
          {actions.includes('debug') && (
            <Button
              size="sm"
              variant="outline"
              icon={<StateDot state={debugState?.running === true ? 'ongoing' : 'idle'} />}
              disabled={debugBusy || debug?.running === true}
              title={bound === undefined ? t('debug.unbound') : undefined}
              onClick={onDebug}
            >
              {t('debug')}
            </Button>
          )}
          {actions.includes('proxy') && (
            <Button size="sm" variant="outline" onClick={onProxy}>{t('proxy.button')}</Button>
          )}
          {actions.includes('edit') && (
            <Button size="sm" variant="outline" onClick={onEdit}>{t('edit')}</Button>
          )}
          {actions.includes('delete') && (
            <Button
              className={css.deleteAction}
              size="sm"
              variant="outline"
              disabled={bot.active}
              title={bot.active ? t('status.active') : undefined}
              onClick={onDelete}
            >
              {t('delete')}
            </Button>
          )}
        </footer>
      )}
    </Modal>
  )
}
