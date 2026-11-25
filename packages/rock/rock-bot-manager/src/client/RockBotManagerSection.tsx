/** Rock bot manager panel: a bot card grid mirroring the Seagull bot list, the bot detail drawer, and the add/edit-bot form. */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button, IconAgentPresetOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular,
  IconInspectOutlineRegular, IconLinkOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular,
  IconUploadOutlineRegular,
  Input, Menu, MenuItemButton, Modal, Pill, StateDot, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BotDebugState, BotDefinition, BotDeployState, BotDeploymentRow, BotInput, BotLlm, BotReasoning, BotRow, BotSource,
  BotTestResult, LlmProxyChecklist, WireProtocol,
} from '@rock/rock-bot-manager/types'
import { BindToolDialog } from './BindToolDialog.tsx'
import { BotDetailDrawer } from './BotDetailDrawer.tsx'
import { BotFormDrawer } from './BotFormDrawer.tsx'
import { boundToolType, cardCtas, isDeployable, modelChanged, supportsTools, type BotDeployStatus } from './bot-card-state.ts'
import { defaultWireProtocol, isWireProtocol, wireProtocolLabel } from './wire-protocol.ts'
import css from './rock-bot-manager.module.css'

/** Empty create-form state: a new bot starts unbound. */
const EMPTY_FORM: BotInput = {
  name: '',
  role: '',
  llm: { provider: '', baseUrl: '', apiKey: '', model: '' },
}

/** Refresh interval while a deployment batch is running. */
const DEPLOY_POLL_MS = 1500

/** Batch deploy is temporarily hidden until it supports per-bot protocol selection. */
const SHOW_BATCH_DEPLOY: boolean = false

/** Clone one reasoning mapping so the form never aliases the persisted bot's state. */
function cloneReasoning(reasoning: BotReasoning): BotReasoning {
  return { enabled: reasoning.enabled, levels: reasoning.levels.map(row => ({ ...row })) }
}

/** Build the editable form's LLM route from a persisted route, blanking the secret. */
function toEditableLlm(llm: BotLlm | undefined): BotLlm {
  if (llm === undefined) return { provider: '', baseUrl: '', apiKey: '', model: '' }
  return {
    provider: llm.provider,
    ...llm.name === undefined ? {} : { name: llm.name },
    baseUrl: llm.baseUrl ?? '',
    ...llm.protocol === undefined ? {} : { protocol: llm.protocol },
    apiKey: '',
    model: llm.model,
    ...llm.modelName === undefined ? {} : { modelName: llm.modelName },
    ...llm.contextWindow === undefined ? {} : { contextWindow: llm.contextWindow },
    ...llm.maxOutputTokens === undefined ? {} : { maxOutputTokens: llm.maxOutputTokens },
    ...llm.inputTypes === undefined ? {} : { inputTypes: [...llm.inputTypes] },
    ...(llm.reasoning === undefined ? {} : { reasoning: cloneReasoning(llm.reasoning) }),
  }
}

/** Build the persisted reasoning mapping, dropping the disabled state and empty levels. */
function toPersistedReasoning(reasoning: BotReasoning | undefined): BotReasoning | undefined {
  if (reasoning?.enabled !== true) return undefined
  return {
    enabled: true,
    levels: reasoning.levels
      .filter(row => row.level.trim() !== '')
      .map(row => ({ level: row.level.trim(), value: row.value })),
  }
}

/** Source filter values: all three bot sources plus the "all" sentinel. */
type SourceFilter = 'all' | BotSource

/** Host operations injected into the Cordis-free management component. */
export interface RockBotManagerSectionInjected {
  remote: {
    listBotsUnified(): Promise<RemoteResult<BotRow[]>>
    createBot(input: BotInput): Promise<RemoteResult<BotDefinition>>
    updateBot(id: string, patch: Partial<Omit<BotDefinition, 'id'>>): Promise<RemoteResult<BotDefinition>>
    removeBot(id: string): Promise<RemoteResult<void>>
    rebindBot(id: string, toolType: string): Promise<RemoteResult<void>>
    toolTypes(): Promise<RemoteResult<string[]>>
    installedTools(): Promise<RemoteResult<string[]>>
    watchDetected(signal?: AbortSignal): AsyncIterable<number>
    testBot(id: string): Promise<RemoteResult<BotDebugState>>
    testState(): Promise<RemoteResult<BotDebugState>>
    getLlmProxy(id: string): Promise<RemoteResult<LlmProxyChecklist | null>>
    listDeployableBots(): Promise<RemoteResult<BotDeploymentRow[]>>
    deploymentState(): Promise<RemoteResult<BotDeployState>>
    deployBot(id: string, wireProtocol?: string): Promise<RemoteResult<void>>
    deployAll(): Promise<RemoteResult<void>>
  }
  openSession: (sessionId: string) => void
}

export type RockBotManagerSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-bot-manager'> & InjectFace<RockBotManagerSectionInjected>

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

/** Render the unified bot card grid, the bot detail drawer, the add/edit-bot drawer, and per-bot tool debugging. */
export function RockBotManagerSection({ t, remote, openSession }: RockBotManagerSectionProps): ReactElement {
  const [bots, setBots] = useState<BotRow[]>([])
  const [toolTypes, setToolTypes] = useState<string[]>([])
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; bot: BotRow } | null>(null)
  const [form, setForm] = useState<BotInput>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BotRow | null>(null)
  const [bindTarget, setBindTarget] = useState<BotRow | null>(null)
  const [cardMenu, setCardMenu] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [debug, setDebug] = useState<BotDebugState | null>(null)
  const [debugStarting, setDebugStarting] = useState<string | null>(null)
  const [debugDismissed, setDebugDismissed] = useState(false)
  const [toast, setToast] = useState<{ text: string; key: number; success: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [deployments, setDeployments] = useState<BotDeploymentRow[]>([])
  const [deployState, setDeployState] = useState<BotDeployState | null>(null)
  const [deploymentsFailed, setDeploymentsFailed] = useState(false)
  const [deployDialog, setDeployDialog] = useState(false)
  const [deployBatchIds, setDeployBatchIds] = useState<readonly string[]>([])
  const [deployConfirm, setDeployConfirm] = useState<BotRow | null>(null)
  const [deployProtocol, setDeployProtocol] = useState<WireProtocol>('chat-completions')
  const [protocolMenu, setProtocolMenu] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [pendingDeploy, setPendingDeploy] = useState<{ kind: 'all' } | { kind: 'bot'; id: string } | null>(null)
  const [deployError, setDeployError] = useState('')

  useEffect(() => {
    let cancelled = false
    void remote.listBotsUnified().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setBots(result.value)
      else setLoadFailed(true)
    })
    void remote.toolTypes().then((result) => { if (!cancelled && result.ok) setToolTypes(result.value) })
    void remote.installedTools().then((result) => { if (!cancelled && result.ok) setInstalled(new Set(result.value)) })
    void remote.listDeployableBots().then((result) => {
      if (cancelled) return
      if (result.ok) setDeployments(result.value)
      else setDeploymentsFailed(true)
    })
    void remote.deploymentState().then((result) => { if (!cancelled && result.ok) setDeployState(result.value) })
    return () => { cancelled = true }
  }, [remote])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const _revision of remote.watchDetected(controller.signal)) {
          void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
        }
      } catch (error) {
        // The refresh stream closed on unmount or carrier loss; a remount re-syncs installed tools.
        console.warn('[rock-bot-manager] detection stream closed:', error)
      }
    })()
    return () => { controller.abort() }
  }, [remote])

  // Poll the in-flight debug run so progress and the final result surface without a manual reload.
  useEffect(() => {
    if (debug?.running !== true) return
    const timer = setInterval(() => {
      void remote.testState().then((result) => { if (result.ok) setDebug(result.value) })
    }, 1000)
    return () => { clearInterval(timer) }
  }, [debug?.running, remote])

  // Poll the active deployment batch; the final read settles per-bot statuses and stops the timer.
  useEffect(() => {
    if (deployState?.running !== true) return
    const timer = setInterval(() => {
      void remote.listDeployableBots().then((result) => {
        if (!result.ok) return
        setDeployments(result.value)
        setDeploymentsFailed(false)
      })
      void remote.deploymentState().then((result) => {
        if (!result.ok) return
        setDeployState(result.value)
        if (!result.value.running) {
          void remote.listDeployableBots().then((next) => {
            if (!next.ok) return
            setDeployments(next.value)
            setDeploymentsFailed(false)
          })
        }
      })
    }, DEPLOY_POLL_MS)
    return () => { clearInterval(timer) }
  }, [deployState?.running, remote])

  const deploymentById = useMemo(() => new Map(deployments.map(row => [row.id, row])), [deployments])

  /** The batch's current bot reports `deploying` before its record is persisted. */
  const deploymentStatusOf = (id: string): BotDeployStatus => {
    if (deployState?.running === true && deployState.current === id) return 'deploying'
    return deploymentById.get(id)?.status ?? 'undeployed'
  }

  const deploymentNameOf = (id: string): string => deploymentById.get(id)?.name ?? id

  /** Rows offered by the deploy dialog: deployable undeployed bots plus the running batch's captured ids. */
  const deployDialogRows = useMemo(() => {
    const batch = new Set(deployBatchIds)
    return deployments.filter(row => row.deployable && (row.status === 'undeployed' || batch.has(row.id)))
  }, [deployments, deployBatchIds])

  /** Bots whose last deployment failed, reported in the page alert strip rather than on their cards. */
  const deployFailures = useMemo(
    () => deployments.filter(row => row.status === 'failed' && row.error !== undefined && row.error !== ''),
    [deployments],
  )

  /** Wire protocols the bot being confirmed offers, for the deploy protocol selector. */
  const deployProtocols = useMemo(
    () => (deployConfirm?.supportedProtocols ?? []).filter(isWireProtocol),
    [deployConfirm],
  )

  const retryLoad = (): void => {
    setLoading(true)
    setLoadFailed(false)
    void remote.listBotsUnified().then((result) => {
      setLoading(false)
      if (result.ok) setBots(result.value)
      else setLoadFailed(true)
    })
    void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
  }

  const refresh = (): void => {
    void remote.listBotsUnified().then((result) => { if (result.ok) setBots(result.value) })
    void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
  }

  const refreshDeployments = (): void => {
    void remote.listDeployableBots().then((result) => {
      if (!result.ok) {
        setDeploymentsFailed(true)
        return
      }
      setDeployments(result.value)
      setDeploymentsFailed(false)
    })
    void remote.deploymentState().then((result) => { if (result.ok) setDeployState(result.value) })
  }

  const syncAll = (): void => {
    if (syncing) return
    setSyncing(true)
    const tasks = [
      remote.listBotsUnified().then((result) => { if (result.ok) setBots(result.value); return result.ok }),
      remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)); return result.ok }),
      remote.listDeployableBots().then((result) => {
        if (!result.ok) {
          setDeploymentsFailed(true)
          return false
        }
        setDeployments(result.value)
        setDeploymentsFailed(false)
        return true
      }),
      remote.deploymentState().then((result) => { if (result.ok) setDeployState(result.value); return result.ok }),
    ]
    void Promise.all(tasks).then((results) => {
      setSyncing(false)
      const ok = results.every(Boolean)
      showToast(ok ? t('sync.done') : t('sync.failed'), ok)
    })
  }

  const showToast = (text: string, success: boolean): void => {
    setToast({ text, key: Date.now(), success })
  }

  const openAdd = (): void => {
    setForm(EMPTY_FORM)
    setFormError('')
    setModal({ mode: 'add' })
  }

  const openEdit = (bot: BotRow): void => {
    setForm({
      name: bot.name,
      role: bot.role ?? '',
      llm: toEditableLlm(bot.llm),
      ...boundToolType(bot) === undefined ? {} : { tool: { toolType: boundToolType(bot) as string } },
    })
    setFormError('')
    setModal({ mode: 'edit', bot })
  }

  const formInput = (): BotInput => {
    const role = (form.role ?? '').trim()
    const name = (form.llm.name ?? '').trim()
    const baseUrl = (form.llm.baseUrl ?? '').trim()
    const apiKey = (form.llm.apiKey ?? '').trim()
    const modelName = (form.llm.modelName ?? '').trim()
    const reasoning = toPersistedReasoning(form.llm.reasoning)
    const toolType = (form.tool?.toolType ?? '').trim()
    return {
      name: form.name.trim(),
      ...role === '' ? {} : { role },
      llm: {
        provider: form.llm.provider.trim(),
        ...name === '' ? {} : { name },
        ...baseUrl === '' ? {} : { baseUrl },
        protocol: form.llm.protocol ?? 'openai-chat',
        ...apiKey === '' ? {} : { apiKey },
        model: form.llm.model.trim(),
        ...modelName === '' ? {} : { modelName },
        ...form.llm.contextWindow === undefined ? {} : { contextWindow: form.llm.contextWindow },
        ...form.llm.maxOutputTokens === undefined ? {} : { maxOutputTokens: form.llm.maxOutputTokens },
        inputTypes: form.llm.inputTypes ?? ['text'],
        ...reasoning === undefined ? {} : { reasoning },
      },
      ...toolType === '' ? {} : { tool: { toolType } },
    }
  }

  const submit = (): void => {
    if (modal === null) return
    setSubmitting(true)
    if (modal.mode === 'add') {
      void remote.createBot(formInput()).then((result) => {
        setSubmitting(false)
        if (result.ok) {
          setModal(null)
          showToast(t('toast.created'), true)
          refresh()
        } else {
          setFormError(result.error.message)
        }
      })
    } else {
      const input = formInput()
      const llm = {
        ...input.llm,
        ...(input.llm.apiKey === undefined && modal.bot.llm?.apiKey !== undefined
          ? { apiKey: modal.bot.llm.apiKey }
          : {}),
      }
      void remote.updateBot(modal.bot.id, { ...input, llm }).then((result) => {
        setSubmitting(false)
        if (result.ok) {
          setModal(null)
          showToast(t('toast.updated'), true)
          refresh()
        } else {
          setFormError(result.error.message)
        }
      })
    }
  }

  const rebind = (bot: BotRow, toolType: string): void => {
    setBindTarget(null)
    void remote.rebindBot(bot.id, toolType).then((result) => {
      if (result.ok) {
        showToast(t('toast.rebound'), true)
        refresh()
      } else {
        showToast(result.error.message, false)
      }
    })
  }

  const runDebug = (id: string): void => {
    setDebugStarting(id)
    setDebugDismissed(false)
    void remote.testBot(id).then((result) => {
      setDebugStarting(null)
      if (result.ok) setDebug(result.value)
      else showToast(result.error.code === 'rockBots/unbound' ? t('debug.unbound') : result.error.message, false)
    })
  }

  const openDeployDialog = (): void => {
    setDeployDialog(true)
    setDeployBatchIds([])
    setDeployError('')
    refreshDeployments()
  }

  const closeDeployDialog = (): void => {
    setDeployDialog(false)
    setDeployBatchIds([])
    setDeployError('')
  }

  /** Open the single-bot deploy confirmation, pre-selecting the bot's default wire protocol. */
  const openDeployConfirm = (bot: BotRow): void => {
    setDeployProtocol(defaultWireProtocol(bot.supportedProtocols))
    setDeployConfirm(bot)
  }

  /** Run one bot's deployment after the confirmation dialog was accepted. */
  const deployOne = (bot: BotRow): void => {
    setDeployConfirm(null)
    setPendingDeploy({ kind: 'bot', id: bot.id })
    void remote.deployBot(bot.id, deployProtocol).then((result) => {
      setPendingDeploy(null)
      if (result.ok) {
        showToast(t('toast.deploy.started'), true)
      } else {
        showToast(result.error.message, false)
      }
      refreshDeployments()
    })
  }

  const deployAllBots = (): void => {
    // Capture the batch ids so their rows stay listed while their statuses advance.
    setDeployBatchIds(deployDialogRows
      .filter(row => row.status === 'undeployed' || row.status === 'failed')
      .map(row => row.id))
    setPendingDeploy({ kind: 'all' })
    setDeployError('')
    void remote.deployAll().then((result) => {
      setPendingDeploy(null)
      if (result.ok) {
        refreshDeployments()
      } else {
        setDeployError(result.error.message)
        showToast(result.error.message, false)
      }
    })
  }

  const confirmDelete = (): void => {
    if (deleteTarget === null) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    if (detailId === id) setDetailId(null)
    void remote.removeBot(id).then((result) => {
      if (result.ok) {
        showToast(t('toast.deleted'), true)
      } else {
        showToast(result.error.message, false)
      }
      refresh()
    })
  }

  const loadProxy = (id: string): Promise<LlmProxyChecklist | null> =>
    remote.getLlmProxy(id).then(result => (result.ok ? result.value : null))

  const deployLocked = pendingDeploy !== null || deployState?.running === true
  const deployAllAvailable = deployDialogRows.some(row => row.status === 'undeployed' || row.status === 'failed')
  const deploymentLabel = (status: BotDeployStatus): string => t(`deploy.status.${status}`)
  const sourceLabel = (source: BotSource): string => t(`source.${source}`)
  const llmLabel = (bot: BotRow): string => {
    if (bot.llm === undefined) return t('cloudManaged')
    return bot.llm.modelName ?? bot.llm.model
  }
  const projectLabel = (bot: BotRow): string => bot.projectName ?? t('project.global')

  const visibleBots = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return bots.filter((bot) => {
      if (sourceFilter !== 'all' && bot.source !== sourceFilter) return false
      if (keyword.length > 0 && !bot.name.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [bots, search, sourceFilter])

  const detailBot = detailId === null ? undefined : bots.find(bot => bot.id === detailId)
  const debugFailure = debug !== null && !debug.running && debug.result !== undefined && !debug.result.ok
  const alertsVisible = deployFailures.length > 0 || (debugFailure && !debugDismissed)

  return (
    <div className={css.root}>
      <header className={css.pageHeader}>
        <div className={css.pageHeading}>
          <h1 className={css.pageTitle}>{t('page.title')}</h1>
          <p className={css.pageDescription}>{t('page.description')}</p>
        </div>
        <div className={css.toolbarActions}>
          <Button
            size="sm"
            variant="ghost"
            icon={syncing ? <StateDot state="ongoing" /> : <IconRefreshOutlineRegular size={14} />}
            disabled={loading || syncing}
            title={t('refresh.title')}
            onClick={syncAll}
          >
            {t('refresh')}
          </Button>
          {SHOW_BATCH_DEPLOY && (
            <Button
              size="sm"
              variant="outline"
              icon={<IconUploadOutlineRegular size={14} />}
              disabled={loading || deployState?.running === true}
              title={deployState?.running === true ? t('deploy.running') : undefined}
              onClick={openDeployDialog}
            >
              {t('deploy.button')}
            </Button>
          )}
          <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={openAdd}>{t('add')}</Button>
        </div>
      </header>

      {alertsVisible && (
        <div className={css.alertStack}>
          {debugFailure && !debugDismissed && (
            <PageAlert
              title={t('alert.debug.title')}
              detail={`[${debug.botName ?? ''}] ${debug.result?.error ?? ''}`}
              onDismiss={() => { setDebugDismissed(true) }}
              dismissLabel={t('alert.dismiss')}
              onDismissIcon={<IconCloseOutlineRegular size={14} />}
              action={debug.sessionId === undefined
                ? undefined
                : {
                  label: t('progress.viewSession'),
                  icon: <IconRightUpOutlineRegular size={14} />,
                  onClick: () => { openSession(debug.sessionId as string) },
                }}
            />
          )}
          {deployFailures.map(row => (
            <PageAlert
              key={row.id}
              title={t('alert.deploy.title')}
              detail={`${row.name}${row.toolType === undefined ? '' : ` · ${row.toolType}`} — ${row.error ?? ''}`}
              action={{
                label: t('alert.deploy.retry'),
                icon: <IconRefreshOutlineRegular size={14} />,
                onClick: () => {
                  const bot = bots.find(candidate => candidate.id === row.id)
                  if (bot !== undefined) openDeployConfirm(bot)
                },
              }}
            />
          ))}
        </div>
      )}

      <div className={css.toolbar}>
        <div className={css.toolbarControls}>
          <span className={css.searchField}>
            <IconSearchOutlineRegular size={14} className={css.searchIcon} />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              className={css.search ?? ''}
            />
          </span>
          <div className={css.filters}>
            <Pill active={sourceFilter === 'all'} onClick={() => { setSourceFilter('all') }}>{t('filter.all')}</Pill>
            <Pill active={sourceFilter === 'claimed'} onClick={() => { setSourceFilter('claimed') }}>{t('source.claimed')}</Pill>
            <Pill active={sourceFilter === 'local'} onClick={() => { setSourceFilter('local') }}>{t('source.local')}</Pill>
            <Pill active={sourceFilter === 'assistant'} onClick={() => { setSourceFilter('assistant') }}>{t('source.assistant')}</Pill>
          </div>
        </div>
      </div>

      {syncing && (
        <div className={css.progressRow} role="status" aria-live="polite">
          <StateDot state="ongoing" />
          <span className={css.progressCurrent}>{t('sync.syncing')}</span>
        </div>
      )}
      {debug !== null && debug.running && (
        <DebugProgressRow debug={debug} t={t} openSession={openSession} />
      )}
      {debug !== null && !debug.running && debug.result?.ok === true && (
        <DebugResultRow result={debug.result} sessionId={debug.sessionId} t={t} openSession={openSession} />
      )}
      {deployState?.running === true && (
        <DeployProgress state={deployState} nameOf={deploymentNameOf} t={t} />
      )}

      {loading ? (
        <div className={css.cards}>
          <div className={css.skeletonCard} />
          <div className={css.skeletonCard} />
        </div>
      ) : loadFailed ? (
        <div className={css.testError} role="alert">
          <span>{t('load.failed')}</span>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={retryLoad}>{t('load.retry')}</Button>
        </div>
      ) : visibleBots.length === 0 ? (
        <p className={css.empty}>{bots.length === 0 ? t('empty') : t('empty.filtered')}</p>
      ) : (
        <ul className={css.cards}>
          {visibleBots.map((bot) => {
            const deployment = deploymentById.get(bot.id)
            const status = deploymentStatusOf(bot.id)
            const ctas = cardCtas(bot, status, deployment)
            const modelChangedFlag = modelChanged(bot, deployment)
            const bound = boundToolType(bot)
            const deployBusy = pendingDeploy?.kind === 'bot' && pendingDeploy.id === bot.id
            const rebindDisabled = !bot.canRebind || bot.active
            return (
              <li key={bot.id} className={css.card}>
                <div className={css.cardHeader}>
                  <span className={css.cardAvatar} aria-hidden="true">
                    <IconAgentPresetOutlineRegular size={20} />
                  </span>
                  <div className={css.cardIdentity}>
                    <span className={css.cardTitleRow}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={css.cardNameButton}
                        title={t('detail.open')}
                        onClick={() => { setDetailId(bot.id) }}
                      >
                        {bot.name}
                      </Button>
                      <span className={css.cardHeaderMeta}>
                        <Tag tone={sourceTone(bot.source)}>{sourceLabel(bot.source)}</Tag>
                        <span className={css.status}>
                          <StateDot state={bot.active ? 'ongoing' : 'idle'} />
                          {bot.active ? t('status.active') : t('status.idle')}
                        </span>
                      </span>
                    </span>
                    <span className={css.cardRole}>{bot.role === undefined || bot.role === '' ? t('role.none') : bot.role}</span>
                  </div>
                </div>

                <div className={css.cardChips}>
                  <span className={css.cardChip}>{llmLabel(bot)}</span>
                  {supportsTools(bot) && (
                    <span className={bound === undefined ? css.cardChipMuted : css.cardChip}>
                      {bound === undefined ? t('bind.pending') : bound}
                    </span>
                  )}
                  {supportsTools(bot) && status !== 'undeployed' && (
                    <Tag tone={deploymentTone(status)}>{deploymentLabel(status)}</Tag>
                  )}
                  {modelChangedFlag && (
                    <Tag tone="warning">{t('modelChanged')}</Tag>
                  )}
                </div>

                <div className={css.cardFooter}>
                  <span className={css.cardProject}>{t('project.label')}：{projectLabel(bot)}</span>
                  <span className={css.cardFooterActions}>
                    {ctas.includes('bind') && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<IconLinkOutlineRegular size={14} />}
                        disabled={rebindDisabled}
                        title={bot.active ? t('status.active') : (!bot.canRebind ? t('rebind.locked') : undefined)}
                        onClick={() => { setBindTarget(bot) }}
                      >
                        {t('bind.pending')}
                      </Button>
                    )}
                    {ctas.includes('deploy') && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={status === 'deploying' || deployBusy ? <StateDot state="ongoing" /> : undefined}
                        disabled={deployLocked || status === 'deploying' || deployBusy || !isDeployable(deployment)}
                        title={!isDeployable(deployment) ? t('deploy.notDeployable') : (deployLocked && status !== 'deploying' ? t('deploy.running') : undefined)}
                        onClick={() => { openDeployConfirm(bot) }}
                      >
                        {status === 'deploying' || deployBusy
                          ? t('deploy.status.deploying')
                          : status === 'failed' || status === 'deployed' ? t('deploy.redeploy') : t('deploy.action')}
                      </Button>
                    )}
                    {ctas.includes('debug') && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<IconPlayOutlineRegular size={14} />}
                        disabled={debug?.running === true || debugStarting === bot.id}
                        onClick={() => { runDebug(bot.id) }}
                      >
                        {t('debug')}
                      </Button>
                    )}
                    <Menu
                      open={cardMenu === bot.id}
                      align="end"
                      anchor={(
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('card.more')}
                          title={t('card.more')}
                          onClick={() => { setCardMenu(cardMenu === bot.id ? null : bot.id) }}
                        >
                          <IconEllipsisOutlineRegular size={14} />
                        </Button>
                      )}
                      onClose={() => { setCardMenu(null) }}
                    >
                      <MenuItemButton
                        icon={<IconInspectOutlineRegular size={14} />}
                        onSelect={() => { setCardMenu(null); setDetailId(bot.id) }}
                      >
                        {t('detail.open')}
                      </MenuItemButton>
                      {bot.source === 'local' && (
                        <MenuItemButton
                          icon={<IconEditOutlineRegular size={14} />}
                          onSelect={() => { setCardMenu(null); openEdit(bot) }}
                        >
                          {t('edit')}
                        </MenuItemButton>
                      )}
                      {bot.canDelete && (
                        <MenuItemButton
                          danger
                          icon={<IconTrashOutlineRegular size={14} />}
                          disabled={bot.active}
                          disabledReason={bot.active ? t('status.active') : undefined}
                          onSelect={() => { setCardMenu(null); setDeleteTarget(bot) }}
                        >
                          {t('delete')}
                        </MenuItemButton>
                      )}
                    </Menu>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detailBot !== undefined && (
        <BotDetailDrawer
          t={t}
          bot={detailBot}
          deployment={deploymentById.get(detailBot.id)}
          status={deploymentStatusOf(detailBot.id)}
          debug={debug}
          deployLocked={deployLocked}
          deployBusy={pendingDeploy?.kind === 'bot' && pendingDeploy.id === detailBot.id}
          debugBusy={debugStarting === detailBot.id}
          loadProxy={detailBot.source === 'claimed' ? () => loadProxy(detailBot.id) : undefined}
          onBind={() => { setBindTarget(detailBot) }}
          onDeploy={() => { openDeployConfirm(detailBot) }}
          onDebug={() => { runDebug(detailBot.id) }}
          onEdit={() => { openEdit(detailBot) }}
          onDelete={() => { setDeleteTarget(detailBot) }}
          onClose={() => { setDetailId(null) }}
        />
      )}

      {bindTarget !== null && (
        <BindToolDialog
          t={t}
          botName={bindTarget.name}
          toolTypes={toolTypes}
          installed={installed}
          current={boundToolType(bindTarget)}
          onConfirm={(toolType) => { rebind(bindTarget, toolType) }}
          onClose={() => { setBindTarget(null) }}
        />
      )}

      {deployConfirm !== null && (
        <Modal
          open
          onClose={() => { setDeployConfirm(null) }}
          title={t('deploy.confirm.title')}
          tone="warning"
          description={t('deploy.confirm.description')}
          closeLabel={t('deploy.confirm.cancel')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setDeployConfirm(null) }}>{t('deploy.confirm.cancel')}</Button>
              <Button variant="primary" icon={<IconUploadOutlineRegular size={14} />} onClick={() => { deployOne(deployConfirm) }}>
                {t('deploy.confirm.confirm')}
              </Button>
            </>
          )}
        >
          <div className={css.confirmBody}>
            <p className={css.confirmBot}>{deployConfirm.name}</p>
            <p className={css.confirmLine}>
              {t('detail.tool')}：{boundToolType(deployConfirm) ?? t('bind.pending')}
            </p>
            {deployProtocols.length >= 2 && (
              <div className={css.confirmProtocol}>
                <span className={css.confirmLine}>{t('deploy.protocol')}</span>
                <Menu
                  open={protocolMenu}
                  anchor={(
                    <Button size="sm" variant="outline" onClick={() => { setProtocolMenu(!protocolMenu) }}>
                      {wireProtocolLabel(t, deployProtocol)}
                    </Button>
                  )}
                  items={deployProtocols.map(protocol => ({ id: protocol, label: wireProtocolLabel(t, protocol) }))}
                  selectedId={deployProtocol}
                  onSelect={(id) => {
                    if (isWireProtocol(id)) setDeployProtocol(id)
                    setProtocolMenu(false)
                  }}
                  onClose={() => { setProtocolMenu(false) }}
                />
              </div>
            )}
            <p className={css.confirmWarning}>{t('deploy.confirm.warning')}</p>
          </div>
        </Modal>
      )}

      {modal !== null && (
        <BotFormDrawer
          t={t}
          mode={modal.mode}
          value={form}
          onChange={setForm}
          error={formError}
          submitting={submitting}
          toolTypes={toolTypes}
          installed={installed}
          onCancel={() => { setModal(null) }}
          onSubmit={submit}
        />
      )}

      {deleteTarget !== null && (
        <Modal
          open
          onClose={() => { setDeleteTarget(null) }}
          title={t('deleteConfirm.title')}
          tone="warning"
          description={t('deleteConfirm.description')}
          closeLabel={t('deleteConfirm.cancel')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setDeleteTarget(null) }}>{t('deleteConfirm.cancel')}</Button>
              <Button variant="primary" icon={<IconTrashOutlineRegular size={14} />} onClick={confirmDelete}>
                {t('deleteConfirm.confirm')}
              </Button>
            </>
          )}
        >
          {deleteTarget.name}
        </Modal>
      )}

      {deployDialog && (
        <Modal
          open
          onClose={closeDeployDialog}
          title={t('deploy.dialog.title')}
          description={t('deploy.dialog.description')}
          closeLabel={t('deploy.dialog.close')}
          className={css.deployDialog ?? ''}
          contentClassName={css.deployDialogContent ?? ''}
          footer={(
            <>
              <Button variant="ghost" onClick={closeDeployDialog}>{t('deploy.dialog.close')}</Button>
              <Button
                variant="primary"
                icon={<IconUploadOutlineRegular size={14} />}
                disabled={deploymentsFailed || !deployAllAvailable || deployLocked}
                onClick={deployAllBots}
              >
                {pendingDeploy?.kind === 'all' ? t('deploy.all.starting') : t('deploy.all')}
              </Button>
            </>
          )}
        >
          <div className={css.deployDialogBody}>
            <p className={css.confirmWarning}>{t('deploy.confirm.warning')}</p>
            {deployState?.running === true && (
              <DeployProgress state={deployState} nameOf={deploymentNameOf} t={t} />
            )}
            {deployError !== '' && (
              <div className={css.testError} role="alert"><span>{deployError}</span></div>
            )}
            {deploymentsFailed ? (
              <div className={css.testError} role="alert">
                <span>{t('deploy.loadFailed')}</span>
                <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={refreshDeployments}>{t('load.retry')}</Button>
              </div>
            ) : deployDialogRows.length === 0 ? (
              <p className={css.empty}>{t('deploy.dialog.empty')}</p>
            ) : (
              <ul className={css.deployList}>
                {deployDialogRows.map(row => (
                  <li key={row.id} className={css.deployRow}>
                    <span className={css.deployRowName}>{row.name}</span>
                    <span className={css.deployRowTool}>{row.toolType ?? t('bind.pending')}</span>
                    <Tag tone={deploymentTone(row.status)}>{deploymentLabel(row.status)}</Tag>
                    {row.status === 'failed' && row.error !== undefined && (
                      <span className={css.deployRowError}>{row.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {toast !== null && (
        toast.success
          ? <Toast key={toast.key} text={toast.text} tone="success" onDone={() => { setToast(null) }} />
          : <Toast key={toast.key} text={toast.text} onDone={() => { setToast(null) }} />
      )}
    </div>
  )
}

/** One page-level alert row: a titled failure with an optional action and dismiss control. */
function PageAlert(props: {
  title: string
  detail: string
  action?: { label: string; icon?: ReactNode; onClick: () => void } | undefined
  onDismiss?: (() => void) | undefined
  dismissLabel?: string | undefined
  onDismissIcon?: ReactNode
  children?: ReactNode
}): ReactElement {
  const { title, detail, action, onDismiss, dismissLabel, onDismissIcon, children } = props
  return (
    <div className={css.pageAlert} role="alert">
      <span className={css.pageAlertTitle}>{title}</span>
      <span className={css.pageAlertDetail}>{detail}</span>
      {children}
      {action !== undefined && (
        <Button size="sm" variant="ghost" icon={action.icon} onClick={action.onClick}>{action.label}</Button>
      )}
      {onDismiss !== undefined && dismissLabel !== undefined && (
        <Button size="sm" variant="ghost" icon={onDismissIcon} onClick={onDismiss}>{dismissLabel}</Button>
      )}
    </div>
  )
}

/** Batch deployment progress: label, count, the current bot, and a determinate bar. */
function DeployProgress(props: {
  state: BotDeployState
  nameOf: (id: string) => string
  t: RockBotManagerSectionProps['t']
}): ReactElement {
  const { state, nameOf, t } = props
  const percent = state.total === 0 ? 0 : Math.round((state.done / state.total) * 100)
  const label = `${t('deploy.progress')} ${String(state.done)}/${String(state.total)}`
  const current = state.current === undefined ? undefined : nameOf(state.current)
  return (
    <div className={css.deployProgress} role="status" aria-live="polite">
      <StateDot state="ongoing" />
      <span className={css.deployProgressLabel}>{label}</span>
      {current !== undefined && <span className={css.deployCurrent}>{current}</span>}
      <span
        className={css.deployTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <span className={css.deployFill} style={{ width: `${String(percent)}%` }} />
      </span>
    </div>
  )
}

/** Single-line debug progress: the bot name + bound backend + view-session link. */
function DebugProgressRow(props: {
  debug: BotDebugState
  t: RockBotManagerSectionProps['t']
  openSession: (sessionId: string) => void
}): ReactElement {
  const { debug, t, openSession } = props
  const sessionId = debug.sessionId
  const current = debug.progress.current
  const text = current === undefined
    ? `[${debug.botName ?? ''}]${t('debug.running')}`
    : `[${debug.botName ?? ''}]${t('debug.running')} ${current}`
  return (
    <div className={css.progressRow}>
      <span className={css.progressCurrent}>{text}</span>
      {sessionId !== undefined
        ? (
          <Button size="sm" variant="ghost" icon={<IconRightUpOutlineRegular size={14} />} onClick={() => { openSession(sessionId) }}>
            {t('progress.viewSession')}
          </Button>
        )
        : null}
    </div>
  )
}

/** One completed debug run: pass/fail tag + answer/error + view-session link. */
function DebugResultRow(props: {
  result: BotTestResult
  sessionId: string | undefined
  t: RockBotManagerSectionProps['t']
  openSession: (sessionId: string) => void
}): ReactElement {
  const { result, sessionId, t, openSession } = props
  const detail = result.ok ? result.answer : result.error
  return (
    <div className={css.debugResult}>
      <Tag tone={result.ok ? 'success' : 'danger'}>
        {result.ok ? t('debug.pass') : t('debug.fail')}
      </Tag>
      <span className={css.debugDetail}>{detail}</span>
      {sessionId !== undefined
        ? (
          <Button size="sm" variant="ghost" icon={<IconRightUpOutlineRegular size={14} />} onClick={() => { openSession(sessionId) }}>
            {t('progress.viewSession')}
          </Button>
        )
        : null}
    </div>
  )
}
