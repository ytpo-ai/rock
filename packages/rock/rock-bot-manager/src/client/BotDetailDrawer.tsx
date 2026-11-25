/** Bot detail drawer: read-only basics plus every action the card does not carry. */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  Button, IconCloseOutlineRegular, IconEditOutlineRegular, IconLinkOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, IconTrashOutlineRegular, IconUploadOutlineRegular,
  Modal, SegmentedTabs, StateDot, Tag, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotDebugState, BotDeploymentRow, BotRow, BotSource, LlmProxyChecklist } from '@rock/rock-bot-manager/types'
import { bindLockedReason, boundToolType, currentModelId, detailActions, modelChanged, supportsTools, type BotDeployStatus } from './bot-card-state.ts'
import { LlmProxyFields } from './LlmProxyFields.tsx'
import type { RockBotManagerKey } from './locales.ts'
import { wireProtocolLabel } from './wire-protocol.ts'
import css from './rock-bot-manager.module.css'

/** Drawer views: the bot's own facts, or the LLM proxy checklist for a cloud bot. */
type DetailTab = 'basic' | 'proxy'

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
  /** Latest debug state; shown only when it belongs to the bot. */
  debug: BotDebugState | null
  /** Whether a deployment batch is running. */
  deployLocked: boolean
  /** Whether this bot's own deployment request is in flight. */
  deployBusy: boolean
  /** Whether this bot's debug run is starting. */
  debugBusy: boolean
  /**
   * Read the bot's LLM proxy checklist; absent when the bot has no proxy tab.
   * @returns the checklist, or null when the bot has none.
   */
  loadProxy: (() => Promise<LlmProxyChecklist | null>) | undefined
  /** Open the bind-tool dialog. */
  onBind: () => void
  /** Ask for this bot's deployment confirmation. */
  onDeploy: () => void
  /** Run one debug pass through the bound backend. */
  onDebug: () => void
  /** Open the edit form (local bots). */
  onEdit: () => void
  /** Ask for deletion confirmation. */
  onDelete: () => void
  /** Close the drawer. */
  onClose: () => void
}

/** One labeled field of the drawer's read-only information. */
function Field(props: { label: string; children: ReactNode; wide?: boolean }): ReactElement {
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
    t, bot, deployment, status, debug, deployLocked, deployBusy, debugBusy, loadProxy,
    onBind, onDeploy, onDebug, onEdit, onDelete, onClose,
  } = props
  const [tab, setTab] = useState<DetailTab>('basic')
  const [checklist, setChecklist] = useState<LlmProxyChecklist | null>(null)
  const [proxyLoading, setProxyLoading] = useState(false)
  const [proxyFailed, setProxyFailed] = useState(false)
  const actions = detailActions(bot, deployment?.deployable === true)
  const bound = boundToolType(bot)
  const modelChangedFlag = modelChanged(bot, deployment)
  const debugState = debug?.botId === bot.id ? debug : undefined
  const llm = bot.llm
  const rebindReason = bindLockedReason(bot, t('status.active'), t('rebind.locked'))
  const hasProxyTab = loadProxy !== undefined && actions.includes('proxy')

  const loadChecklist = (): void => {
    if (loadProxy === undefined) return
    setProxyLoading(true)
    setProxyFailed(false)
    void loadProxy().then((result) => {
      setProxyLoading(false)
      if (result === null) setProxyFailed(true)
      else setChecklist(result)
    }, () => {
      setProxyLoading(false)
      setProxyFailed(true)
    })
  }

  // The checklist is read only when its tab is opened, and once per opening.
  useEffect(() => {
    if (tab !== 'proxy' || checklist !== null || proxyLoading) return
    loadChecklist()
  }, [tab, checklist, proxyLoading])

  const tabs = (
    <SegmentedTabs
      size="sm"
      label={t('detail.tabs')}
      value={tab}
      onChange={setTab}
      items={hasProxyTab
        ? [
          { value: 'basic', label: t('detail.tab.basic'), id: 'bot-detail-tab-basic', panelId: 'bot-detail-panel-basic' },
          { value: 'proxy', label: t('proxy.tab'), id: 'bot-detail-tab-proxy', panelId: 'bot-detail-panel-proxy' },
        ]
        : [{ value: 'basic', label: t('detail.tab.basic'), id: 'bot-detail-tab-basic', panelId: 'bot-detail-panel-basic' }]}
    />
  )

  return (
    <Modal open onClose={onClose} title={bot.name} headless className={css.detailDrawer ?? ''}>
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
        <Button
          size="sm"
          variant="ghost"
          icon={<IconCloseOutlineRegular size={14} />}
          onClick={onClose}
          aria-label={t('detail.close')}
        >
          {t('detail.close')}
        </Button>
      </header>

      {hasProxyTab && <div className={css.drawerTabs}>{tabs}</div>}

      <div className={css.drawerBody}>
        {tab === 'basic' ? (
          <>
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
                <Field label={t('detail.modelId')}>{currentModelId(bot)}</Field>
                <Field label={t('detail.protocol')}>
                  {llm?.protocol === undefined ? undefined : t(`form.protocol.${llm.protocol}`)}
                </Field>
                <Field label={t('detail.supportedProtocols')}>
                  {bot.supportedProtocols === undefined || bot.supportedProtocols.length === 0
                    ? undefined
                    : bot.supportedProtocols.map(protocol => wireProtocolLabel(t, protocol)).join(' / ')}
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
                  <Field label={t('detail.tool')}>
                    <span className={css.detailFieldInline}>
                      <span className={bound === undefined ? css.cardChipMuted : undefined}>
                        {bound ?? t('bind.pending')}
                      </span>
                      {actions.includes('bind') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<IconLinkOutlineRegular size={14} />}
                          disabled={rebindReason !== undefined}
                          title={rebindReason}
                          onClick={onBind}
                        >
                          {bound === undefined ? t('bind.action') : t('detail.rebind')}
                        </Button>
                      )}
                    </span>
                  </Field>
                  <Field label={t('detail.deployStatus')}>
                    <span className={css.detailFieldInline}>
                      <Tag tone={deploymentTone(status)}>{t(`deploy.status.${status}`)}</Tag>
                      {modelChangedFlag && <Tag tone="warning">{t('modelChanged')}</Tag>}
                    </span>
                  </Field>
                  <Field label={t('detail.deployedModel')}>{deployment?.deployedModel}</Field>
                  <Field label={t('detail.deployedProtocol')}>
                    {deployment?.deployedProtocol === undefined ? undefined : wireProtocolLabel(t, deployment.deployedProtocol)}
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
          </>
        ) : (
          <>
            {proxyLoading && <p className={css.detailHint}>{t('proxy.loading')}</p>}
            {!proxyLoading && proxyFailed && (
              <div className={css.testError} role="alert">
                <span>{t('proxy.loadFailed')}</span>
                <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={loadChecklist}>
                  {t('load.retry')}
                </Button>
              </div>
            )}
            {!proxyLoading && !proxyFailed && checklist !== null && (
              <LlmProxyFields t={t} checklist={checklist} intro={<p className={css.drawerDescription}>{t('proxy.description')}</p>} />
            )}
          </>
        )}
      </div>

      {actions.length > 0 && (
        <footer className={css.drawerFooter}>
          {actions.includes('deploy') && (
            <Button
              size="sm"
              variant="primary"
              icon={status === 'deploying' || deployBusy
                ? <StateDot state="ongoing" />
                : <IconUploadOutlineRegular size={14} />}
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
              icon={debugState?.running === true
                ? <StateDot state="ongoing" />
                : <IconPlayOutlineRegular size={14} />}
              disabled={debugBusy || debug?.running === true}
              title={bound === undefined ? t('debug.unbound') : undefined}
              onClick={onDebug}
            >
              {t('debug')}
            </Button>
          )}
          {actions.includes('edit') && (
            <Button size="sm" variant="outline" icon={<IconEditOutlineRegular size={14} />} onClick={onEdit}>{t('edit')}</Button>
          )}
          {actions.includes('delete') && (
            <Button
              className={css.deleteAction}
              size="sm"
              variant="outline"
              icon={<IconTrashOutlineRegular size={14} />}
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
