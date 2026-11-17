/** Rock task-management panel: current/history tabs, status-grouped task cards, filter, and the run-bot dialog. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Menu, Modal, StateDot, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArchivedTaskSummary, TaskBot, TaskSummary, TaskWorkRecord } from '@rock/rock-tasks/types'
import type { RockTasksKey } from './locales.ts'
import { STATUS_ORDER, statusLabel } from './status.ts'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free task table. */
export interface TasksSectionInjected {
  remote: {
    listTasks(): Promise<RemoteResult<TaskSummary[]>>
    listBots(): Promise<RemoteResult<TaskBot[]>>
    runTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    submitTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    continueTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    listWorkRecords(taskId: string): Promise<RemoteResult<TaskWorkRecord[]>>
    listArchivedTasks(): Promise<RemoteResult<ArchivedTaskSummary[]>>
    getArchivedTask(taskId: string): Promise<RemoteResult<{ summary: ArchivedTaskSummary | null; records: TaskWorkRecord[] }>>
  }
}

export type TasksSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tasks'> & InjectFace<TasksSectionInjected>

/** Panel tab: cloud queue (current) or the local archive (history). */
type Tab = 'current' | 'history'

/** Canonical status order for grouping and filtering. */
const TERMINAL = new Set(['done', 'cancelled'])

/** Statuses the backend allows `run` from. */
const RUNNABLE = new Set(['pending', 'in-progress', 'blocked'])

/** One status-group of task cards. */
interface StatusGroup {
  status: string
  tasks: TaskSummary[]
}

/** The task whose records dialog is open. */
interface RecordTarget {
  id: string
  title: string
  kind: 'current' | 'history'
}

/** Tag tone for one work-queue status. */
function statusTone(status: string): TagTone {
  switch (status) {
    case 'done': return 'success'
    case 'awaiting-review':
    case 'blocked': return 'warning'
    case 'in-progress':
    case 'planning':
    case 'planned': return 'info'
    default: return 'neutral'
  }
}

/** State dot for one work-queue status. */
function statusDot(status: string): StateDotState {
  switch (status) {
    case 'done': return 'done'
    case 'blocked':
    case 'awaiting-review': return 'warning'
    case 'in-progress': return 'ongoing'
    default: return 'idle'
  }
}

/** Localized label for one work record row. */
function recordLabel(t: (key: RockTasksKey) => string, record: TaskWorkRecord): string {
  switch (record.type) {
    case 'tool.call': return t('records.tool.call')
    case 'tool.result': return t('records.tool.result')
    case 'step.start': return t('records.step.start')
    case 'step.end': return t('records.step.end')
    case 'turn.start': return t('records.turn.start')
    case 'turn.end': return t('records.turn.end')
    case 'task.definition': return t('records.task.definition')
    case 'task.receipt': return t('records.task.receipt')
    case 'assistant.message': return t('records.assistant.message')
    case 'run.start': return t('records.run.start')
    case 'run.end': return t('records.run.end')
    default: return record.type
  }
}

/** Compact text for one work record row: tool id / step / turn plus optional error. */
function recordText(record: TaskWorkRecord): string {
  switch (record.type) {
    case 'tool.call':
    case 'tool.result': {
      const error = record.error === undefined ? '' : ` · ${record.error}`
      return `${record.toolId ?? ''}${error}`
    }
    case 'step.start':
    case 'step.end':
      return `#${record.stepId ?? ''}`
    case 'turn.start':
    case 'turn.end':
      return `#${record.turn ?? ''}${record.reason === undefined ? '' : ` · ${record.reason}`}`
    case 'assistant.message':
      return record.text ?? ''
    case 'run.start':
    case 'run.end':
      return record.runId ?? ''
    case 'task.definition':
      return String((record.data as { title?: string } | undefined)?.title ?? '')
    case 'task.receipt':
      return String((record.data as { summary?: string } | undefined)?.summary ?? '')
    default:
      return ''
  }
}

/** Tag tone for one work record row. */
function recordTone(record: TaskWorkRecord): TagTone {
  switch (record.type) {
    case 'tool.call': return 'info'
    case 'tool.result': return record.ok === false ? 'danger' : 'success'
    case 'task.receipt': {
      const outcome = (record.data as { outcome?: string } | undefined)?.outcome
      return outcome === 'success' ? 'success' : outcome === 'failed' ? 'danger' : 'warning'
    }
    case 'task.definition':
    case 'assistant.message':
    case 'run.start':
    case 'run.end':
    case 'step.start':
    case 'step.end':
    case 'turn.start':
    case 'turn.end':
    default: return 'neutral'
  }
}

/** Render the task panel: a current/history tab split over the cloud queue and the local archive. */
export function TasksSection({ t, remote }: TasksSectionProps): ReactElement {
  const [tab, setTab] = useState<Tab>('current')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [archived, setArchived] = useState<ArchivedTaskSummary[]>([])
  const [bots, setBots] = useState<TaskBot[]>([])
  const [loading, setLoading] = useState(true)
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [filterMenu, setFilterMenu] = useState(false)
  const [runTarget, setRunTarget] = useState<TaskSummary | null>(null)
  const [selectedBot, setSelectedBot] = useState('')
  const [botMenu, setBotMenu] = useState(false)
  const [running, setRunning] = useState(false)
  const [acting, setActing] = useState(false)
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [records, setRecords] = useState<TaskWorkRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void remote.listTasks().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setTasks(result.value)
      else setLoadFailed(true)
    })
    void remote.listBots().then((result) => {
      if (!cancelled && result.ok) setBots(result.value)
    })
    void loadArchived(cancelled)
    return () => { cancelled = true }
  }, [remote])

  const loadArchived = (cancelled: { value: boolean } | boolean = { value: false }): void => {
    const isCancelled = typeof cancelled === 'boolean' ? () => cancelled : () => cancelled.value
    setArchivedLoading(true)
    void remote.listArchivedTasks().then((result) => {
      setArchivedLoading(false)
      if (isCancelled()) return
      if (result.ok) setArchived(result.value)
    })
  }

  const retryLoad = (): void => {
    setLoading(true)
    setLoadFailed(false)
    void remote.listTasks().then((result) => {
      setLoading(false)
      if (result.ok) setTasks(result.value)
      else setLoadFailed(true)
    })
    void remote.listBots().then((result) => { if (result.ok) setBots(result.value) })
    loadArchived(false)
  }

  const visible = useMemo(() => tasks.filter((task) => {
    if (tab === 'current' && TERMINAL.has(task.status)) return false
    if (statusFilter !== 'all' && task.status !== statusFilter) return false
    return true
  }), [tasks, statusFilter, tab])

  const groups = useMemo<StatusGroup[]>(() => {
    const map = new Map<string, TaskSummary[]>()
    for (const task of visible) {
      const list = map.get(task.status) ?? []
      list.push(task)
      map.set(task.status, list)
    }
    return STATUS_ORDER.flatMap((status) => {
      const tasks = map.get(status)
      return tasks === undefined ? [] : [{ status, tasks }]
    })
  }, [visible])

  const botName = (botId: string): string => bots.find(bot => bot.id === botId)?.name ?? botId

  const openRun = (task: TaskSummary): void => {
    setRunTarget(task)
    setSelectedBot(task.executorId.length > 0 ? task.executorId : '')
  }

  const openRecords = (id: string, title: string, kind: RecordTarget['kind']): void => {
    setRecordTarget({ id, title, kind })
    setRecords([])
    setRecordsLoading(true)
    const request = kind === 'current'
      ? remote.listWorkRecords(id).then(result => result.ok ? result.value : [])
      : remote.getArchivedTask(id).then(result => result.ok ? result.value.records : [])
    void request.then((value) => {
      setRecordsLoading(false)
      setRecords(value)
    })
  }

  // Live work-record heartbeat: refresh the records list while the dialog is open.
  useEffect(() => {
    if (recordTarget === null) return
    const timer = setInterval(() => {
      const request = recordTarget.kind === 'current'
        ? remote.listWorkRecords(recordTarget.id).then(result => result.ok ? result.value : [])
        : remote.getArchivedTask(recordTarget.id).then(result => result.ok ? result.value.records : [])
      void request.then((value) => { setRecords(value) })
    }, 1500)
    return () => { clearInterval(timer) }
  }, [recordTarget, remote])

  const submitRun = (): void => {
    if (runTarget === null || selectedBot.length === 0) return
    setRunning(true)
    void remote.runTask(runTarget.id, selectedBot).then((result) => {
      setRunning(false)
      if (!result.ok) {
        const launchFailed = String(result.error.code) === 'rockTasks/launchFailed'
        setToast({ text: t(launchFailed ? 'toast.run.launchFailed' : 'toast.run.failed'), key: Date.now() })
        return
      }
      setToast({ text: t('toast.run.success'), key: Date.now() })
      setRunTarget(null)
      void remote.listTasks().then((r) => { if (r.ok) setTasks(r.value) })
    })
  }

  const submitTask = (task: TaskSummary): void => {
    setActing(true)
    void remote.submitTask(task.id, task.executorId).then((result) => {
      setActing(false)
      if (!result.ok) {
        setToast({ text: t('toast.submit.failed'), key: Date.now() })
        return
      }
      setToast({ text: t('toast.submit.success'), key: Date.now() })
      void remote.listTasks().then((r) => { if (r.ok) setTasks(r.value) })
    })
  }

  const continueTask = (task: TaskSummary): void => {
    setActing(true)
    void remote.continueTask(task.id, task.executorId).then((result) => {
      setActing(false)
      if (!result.ok) {
        setToast({ text: t('toast.continue.failed'), key: Date.now() })
        return
      }
      setToast({ text: t('toast.continue.success'), key: Date.now() })
      void remote.listTasks().then((r) => { if (r.ok) setTasks(r.value) })
    })
  }

  const filterOptions = [
    { id: 'all', label: t('tasks.filter.all') },
    ...STATUS_ORDER.map(status => ({ id: status, label: statusLabel(t, status) })),
  ]

  const currentBot = runTarget !== null ? bots.find(bot => bot.id === selectedBot) : undefined

  const receiptOutcome = (entry: ArchivedTaskSummary): string | undefined => entry.receipt?.outcome

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div className={css.tabs}>
          <Button size="sm" variant={tab === 'current' ? 'primary' : 'outline'} onClick={() => { setTab('current') }}>
            {t('tasks.tab.current')}
          </Button>
          <Button size="sm" variant={tab === 'history' ? 'primary' : 'outline'} onClick={() => { setTab('history') }}>
            {t('tasks.tab.history')}
          </Button>
        </div>
        {tab === 'current' && (
          <Menu
            open={filterMenu}
            anchor={(
              <Button size="sm" variant="outline" onClick={() => { setFilterMenu(!filterMenu) }}>
                {statusFilter === 'all' ? t('tasks.filter.all') : statusLabel(t, statusFilter)}
              </Button>
            )}
            items={filterOptions}
            selectedId={statusFilter}
            onSelect={(id) => { setStatusFilter(id); setFilterMenu(false) }}
            onClose={() => { setFilterMenu(false) }}
          />
        )}
      </div>

      {tab === 'current' ? (
        loading ? (
          <div className={css.sections}>
            <div className={css.skeletonCard} />
            <div className={css.skeletonCard} />
          </div>
        ) : loadFailed ? (
          <div className={css.loadError} role="alert">
            <span>{t('load.failed')}</span>
            <Button variant="ghost" size="sm" onClick={retryLoad}>{t('load.retry')}</Button>
          </div>
        ) : groups.length === 0 ? (
          <p className={css.empty}>{t('tasks.empty')}</p>
        ) : (
          <div className={css.sections}>
            {groups.map(group => (
              <section key={group.status} className={css.statusSection}>
                <header className={css.statusHeader}>
                  <StateDot state={statusDot(group.status)} />
                  <span className={css.statusTitle}>{statusLabel(t, group.status)}</span>
                  <Tag tone={statusTone(group.status)}>{group.tasks.length}</Tag>
                </header>
                <ul className={css.cards}>
                  {group.tasks.map(task => (
                    <li key={task.id} className={css.card}>
                      <div className={css.cardBody}>
                        <div className={css.cardTitle}>{task.title || task.id}</div>
                        <div className={css.cardMeta}>
                          <Tag tone="outline">{task.type}</Tag>
                          {task.status === 'done' && task.resolution !== undefined && (
                            <Tag tone={task.resolution === 'accepted' ? 'success' : 'danger'}>
                              {task.resolution === 'accepted' ? t('resolution.accepted') : t('resolution.rejected')}
                            </Tag>
                          )}
                          <span className={css.cardOwner}>{task.executorId.length > 0 ? botName(task.executorId) : t('run.none')}</span>
                        </div>
                        {task.description !== '' && <p className={css.cardDesc}>{task.description}</p>}
                      </div>
                      <div className={css.cardActions}>
                        <Button size="sm" variant="ghost" onClick={() => { openRecords(task.id, task.title || task.id, 'current') }}>{t('records.open')}</Button>
                        {RUNNABLE.has(task.status) && (
                          <Button size="sm" onClick={() => { openRun(task) }}>{t('tasks.execute')}</Button>
                        )}
                        {task.status === 'in-progress' && task.executorId.length > 0 && (
                          <Button size="sm" variant="outline" disabled={acting} onClick={() => { submitTask(task) }}>{t('tasks.submit')}</Button>
                        )}
                        {task.status === 'awaiting-review' && task.executorId.length > 0 && (
                          <Button size="sm" variant="outline" disabled={acting} onClick={() => { continueTask(task) }}>{t('tasks.continue')}</Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : archivedLoading ? (
        <p className={css.empty}>{t('records.loading')}</p>
      ) : archived.length === 0 ? (
        <p className={css.empty}>{t('tasks.historyEmpty')}</p>
      ) : (
        <ul className={css.cards}>
          {archived.map(entry => (
            <li key={entry.id} className={css.card}>
              <div className={css.cardBody}>
                <div className={css.cardTitle}>{entry.title || entry.id}</div>
                <div className={css.cardMeta}>
                  <Tag tone={statusTone(entry.status)}>{statusLabel(t, entry.status)}</Tag>
                  {entry.resolution !== undefined && (
                    <Tag tone={entry.resolution === 'accepted' ? 'success' : 'danger'}>
                      {entry.resolution === 'accepted' ? t('resolution.accepted') : t('resolution.rejected')}
                    </Tag>
                  )}
                  {receiptOutcome(entry) !== undefined && (
                    <Tag tone={receiptOutcome(entry) === 'success' ? 'success' : 'warning'}>
                      {receiptOutcome(entry) === 'success' ? t('receipt.success') : t('receipt.partial')}
                    </Tag>
                  )}
                </div>
              </div>
              <div className={css.cardActions}>
                <Button size="sm" variant="ghost" onClick={() => { openRecords(entry.id, entry.title || entry.id, 'history') }}>{t('records.open')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {runTarget !== null && (
        <Modal
          open
          onClose={() => { if (!running) setRunTarget(null) }}
          title={t('run.title')}
          description={t('run.description')}
          closeLabel={t('run.cancel')}
          footer={(
            <>
              <Button variant="ghost" disabled={running} onClick={() => { setRunTarget(null) }}>{t('run.cancel')}</Button>
              <Button variant="primary" disabled={running || selectedBot.length === 0} onClick={submitRun}>{t('run.run')}</Button>
            </>
          )}
        >
          <div className={css.runDialog}>
            <div className={css.runTaskTitle}>{runTarget.title || runTarget.id}</div>
            {runTarget.executorId.length > 0 && (
              <div className={css.runCurrent}>
                {t('run.current')}: {botName(runTarget.executorId)}
              </div>
            )}
            <div className={css.runField}>
              <span className={css.runLabel}>{t('run.bot')}</span>
              {bots.length === 0 ? (
                <p className={css.noBot}>{t('run.noBot')}</p>
              ) : (
                <Menu
                  open={botMenu}
                  anchor={(
                    <Button size="sm" variant="outline" onClick={() => { setBotMenu(!botMenu) }}>
                      {currentBot === undefined ? t('run.select') : currentBot.name}
                    </Button>
                  )}
                  items={bots.map(bot => ({ id: bot.id, label: `${bot.name} · ${bot.toolType}` }))}
                  selectedId={selectedBot}
                  onSelect={(id) => { setSelectedBot(id); setBotMenu(false) }}
                  onClose={() => { setBotMenu(false) }}
                />
              )}
              {currentBot !== undefined && <Tag tone="info">{currentBot.toolType}</Tag>}
            </div>
          </div>
        </Modal>
      )}

      {recordTarget !== null && (
        <Modal
          open
          onClose={() => { setRecordTarget(null) }}
          title={t('records.title')}
          description={recordTarget.title}
          closeLabel={t('run.cancel')}
          footer={(
            <Button variant="ghost" onClick={() => { setRecordTarget(null) }}>{t('run.cancel')}</Button>
          )}
        >
          <div className={css.records}>
            {recordsLoading ? (
              <p className={css.empty}>{t('records.loading')}</p>
            ) : records.length === 0 ? (
              <p className={css.empty}>{t('records.empty')}</p>
            ) : (
              <ul className={css.recordList}>
                {records.map((record, index) => (
                  <li key={`${record.sessionId ?? 'task'}-${index}`} className={css.recordRow}>
                    <Tag tone={recordTone(record)}>
                      {recordLabel(t, record)}
                    </Tag>
                    <span className={css.recordText}>{recordText(record)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {toast !== null && <Toast key={toast.key} text={toast.text} tone="success" onDone={() => { setToast(null) }} />}
    </div>
  )
}
