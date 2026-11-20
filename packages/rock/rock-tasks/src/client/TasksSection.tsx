/** Rock task-management panel: current/history tabs, status-grouped task cards, search/sort/filter, and the run-bot + records dialogs. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button, Checkbox, IconWarningTriangleOutlineRegular, Input, Menu, Modal, StateDot, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArchivedTaskSummary, TaskBot, TaskSummary, TaskWorkRecord } from '@rock/rock-tasks/types'
import type { RockTasksKey } from './locales.ts'
import { statusLabel } from './status.ts'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free task table. */
export interface TasksSectionInjected {
  remote: {
    listTasks(): Promise<RemoteResult<TaskSummary[]>>
    listBots(): Promise<RemoteResult<TaskBot[]>>
    listProjects(): Promise<RemoteResult<Array<{ id: string; name: string; slug?: string }>>>
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

/** Ordering applied within each status group. */
type Sort = 'newest' | 'oldest' | 'due'

/** Background queue refresh cadence. */
const REFRESH_INTERVAL_MS = 15_000

/** Statuses the backend allows `run` from. */
const RUNNABLE = new Set(['pending', 'in-progress', 'bot-completed'])

/** Board status columns, in order (after the leading pool column). */
const BOARD_STATUSES = ['pending', 'in-progress', 'bot-completed', 'awaiting-review', 'done'] as const

/** Brand names for execution backends, kept verbatim (not translated). */
const TOOL_TYPE_LABELS: Readonly<Record<string, string>> = {
  codex: 'Codex',
  dsh: 'DSH',
  opencode: 'OpenCode',
  pi: 'Pi',
  acp: 'ACP',
  'claude-code': 'Claude Code',
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dateFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** Format an ISO-8601 timestamp as a compact local date + time, or '' when unparseable. */
function formatDateTime(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : dateTimeFormatter.format(ms)
}

/** Format an ISO-8601 timestamp as a compact local date, or '' when unparseable. */
function formatDate(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : dateFormatter.format(ms)
}

/** One board column (pool or a status group). */
interface BoardColumn {
  key: string
  title: string
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
    case 'bot-completed':
    case 'blocked': return 'warning'
    case 'in-progress': return 'info'
    default: return 'neutral'
  }
}

/** State dot for one work-queue status. */
function statusDot(status: string): StateDotState {
  switch (status) {
    case 'done': return 'done'
    case 'blocked':
    case 'awaiting-review':
    case 'bot-completed': return 'warning'
    case 'in-progress': return 'ongoing'
    default: return 'idle'
  }
}

/** Localized label for one task kind, falling back to the raw kind. */
function typeLabel(t: (key: RockTasksKey) => string, type: string): string {
  if (type === 'requirement') return t('type.requirement')
  if (type === 'task') return t('type.task')
  return type
}

/** Tag tone for one task kind. */
function typeTone(type: string): TagTone {
  return type === 'requirement' ? 'info' : 'neutral'
}

/** Localized label for one priority, falling back to the raw value. */
function priorityLabel(t: (key: RockTasksKey) => string, priority: string): string {
  if (priority === 'low') return t('priority.low')
  if (priority === 'medium') return t('priority.medium')
  if (priority === 'high') return t('priority.high')
  return priority
}

/** Tag tone for one priority. */
function priorityTone(priority: string): TagTone {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'neutral'
}

/** Readable brand name for an execution backend, falling back to the raw value. */
function toolTypeLabel(toolType: string): string {
  return TOOL_TYPE_LABELS[toolType] ?? toolType
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

/** Localized label for a turn-end reason, falling back to the raw reason kind. */
function turnReasonLabel(t: (key: RockTasksKey) => string, reason: string): string {
  switch (reason) {
    case 'stop': return t('records.reason.stop')
    case 'completed': return t('records.reason.completed')
    case 'cancel': return t('records.reason.cancel')
    case 'aborted': return t('records.reason.aborted')
    case 'error': return t('records.reason.error')
    case 'limit': return t('records.reason.limit')
    case 'idle': return t('records.reason.idle')
    default: return reason
  }
}

/** Compact text for one work record row: tool name / step / turn / reason, without opaque ids. */
function recordText(t: (key: RockTasksKey) => string, record: TaskWorkRecord): string {
  switch (record.type) {
    case 'tool.call':
      return record.toolId ?? ''
    case 'tool.result':
      return record.error ?? ''
    case 'step.start':
    case 'step.end':
      return `#${record.stepId ?? ''}`
    case 'turn.start':
      return `#${record.turn ?? ''}`
    case 'turn.end':
      return `#${record.turn ?? ''}${record.reason === undefined ? '' : ` · ${turnReasonLabel(t, record.reason)}`}`
    case 'assistant.message':
      return record.text ?? ''
    case 'task.definition':
      return (record.data as { title?: string } | undefined)?.title ?? ''
    case 'task.receipt':
      return (record.data as { summary?: string } | undefined)?.summary ?? ''
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

/** Epoch ms for a task's creation time; 0 when absent or unparseable. */
function createdMs(task: TaskSummary): number {
  if (task.createdAt === undefined) return 0
  const ms = Date.parse(task.createdAt)
  return Number.isNaN(ms) ? 0 : ms
}

/** Epoch ms for a task's due time; Infinity when absent (sorts last). */
function dueMs(task: TaskSummary): number {
  if (task.dueAt === undefined) return Number.POSITIVE_INFINITY
  const ms = Date.parse(task.dueAt)
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/** Whether a task is due within the hour (or overdue): red card highlight. */
function dueSoon(dueAt: string): boolean {
  const ms = Date.parse(dueAt)
  if (Number.isNaN(ms)) return false
  return ms - Date.now() < 60 * 60 * 1000
}

/** Compare two tasks by the active ordering, applied within each status group. */
function compareTasks(a: TaskSummary, b: TaskSummary, sort: Sort): number {
  if (sort === 'due') {
    const delta = dueMs(a) - dueMs(b)
    if (delta !== 0) return delta
    return createdMs(b) - createdMs(a)
  }
  const delta = createdMs(a) - createdMs(b)
  return sort === 'oldest' ? delta : -delta
}

/** Render the task panel: a current/history tab split over the cloud queue and the local archive. */
export function TasksSection({ t, remote }: TasksSectionProps): ReactElement {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [bots, setBots] = useState<TaskBot[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string; slug?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [columnMenu, setColumnMenu] = useState(false)
  const [runTarget, setRunTarget] = useState<TaskSummary | null>(null)
  const [selectedBot, setSelectedBot] = useState('')
  const [botMenu, setBotMenu] = useState(false)
  const [running, setRunning] = useState(false)
  const [acting, setActing] = useState(false)
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [records, setRecords] = useState<TaskWorkRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsFailed, setRecordsFailed] = useState(false)
  const [toast, setToast] = useState<{ text: string; key: number; success: boolean } | null>(null)

  /** Silent background refresh (polling, mutations, manual): never flips the page skeleton. */
  const refresh = (): void => {
    void remote.listTasks().then((result) => {
      if (result.ok) { setTasks(result.value); setLoadFailed(false) }
    })
    void remote.listBots().then((result) => { if (result.ok) setBots(result.value) })
    void remote.listProjects().then((result) => { if (result.ok) setProjects(result.value) })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    void remote.listTasks().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setTasks(result.value)
      else setLoadFailed(true)
    })
    void remote.listBots().then((result) => {
      if (!cancelled && result.ok) setBots(result.value)
    })
    void remote.listProjects().then((result) => {
      if (!cancelled && result.ok) setProjects(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  // Poll the queue so newly pushed cloud tasks surface without a manual reload.
  // `refresh` closes over the stable `remote` handle and React setters, so a
  // stale closure cannot observe or write anything different.
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [remote])

  const retryLoad = (): void => {
    setLoading(true)
    setLoadFailed(false)
    void remote.listTasks().then((result) => {
      setLoading(false)
      if (result.ok) setTasks(result.value)
      else setLoadFailed(true)
    })
    void remote.listBots().then((result) => { if (result.ok) setBots(result.value) })
    void remote.listProjects().then((result) => { if (result.ok) setProjects(result.value) })
  }

  const boardColumns = useMemo<BoardColumn[]>(() => {
    const pool: TaskSummary[] = []
    const byStatus = new Map<string, TaskSummary[]>()
    for (const task of tasks) {
      if (search.trim() !== '') {
        const q = search.trim().toLowerCase()
        const haystack = `${task.title}\n${task.description}\n${task.type}`.toLowerCase()
        if (!haystack.includes(q)) continue
      }
      if (task.type === 'task' && task.executorId.length === 0) {
        pool.push(task)
        continue
      }
      const list = byStatus.get(task.status) ?? []
      list.push(task)
      byStatus.set(task.status, list)
    }
    for (const list of byStatus.values()) list.sort((a, b) => compareTasks(a, b, 'newest'))
    pool.sort((a, b) => compareTasks(a, b, 'newest'))
    return [
      { key: 'pool', title: t('tasks.pool'), tasks: pool },
      ...BOARD_STATUSES.map(status => ({ key: status, title: statusLabel(t, status), tasks: byStatus.get(status) ?? [] })),
    ]
  }, [tasks, search, t])

  const visibleBoardColumns = boardColumns.filter(column => !hiddenColumns.has(column.key))

  const botName = (botId: string): string => bots.find(bot => bot.id === botId)?.name ?? botId
  const projectName = (projectId: string): string | undefined => projects.find(project => project.id === projectId)?.name

  const openRun = (task: TaskSummary): void => {
    setRunTarget(task)
    setSelectedBot(task.executorId.length > 0 ? task.executorId : '')
  }

  const openRecords = (id: string, title: string, kind: RecordTarget['kind']): void => {
    setRecordTarget({ id, title, kind })
    setRecords([])
    setRecordsFailed(false)
    setRecordsLoading(true)
    if (kind === 'current') {
      void remote.listWorkRecords(id).then((result) => {
        setRecordsLoading(false)
        if (result.ok) setRecords(result.value)
        else setRecordsFailed(true)
      })
    } else {
      void remote.getArchivedTask(id).then((result) => {
        setRecordsLoading(false)
        if (result.ok) setRecords(result.value.records)
        else setRecordsFailed(true)
      })
    }
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
        const launchFailed = result.error.code === 'rockTasks/launchFailed'
        setToast({ text: t(launchFailed ? 'toast.run.launchFailed' : 'toast.run.failed'), key: Date.now(), success: false })
        return
      }
      setToast({ text: t('toast.run.success'), key: Date.now(), success: true })
      setRunTarget(null)
      refresh()
    })
  }

  const submitTask = (task: TaskSummary): void => {
    setActing(true)
    void remote.submitTask(task.id, task.executorId).then((result) => {
      setActing(false)
      if (!result.ok) {
        setToast({ text: t('toast.submit.failed'), key: Date.now(), success: false })
        return
      }
      setToast({ text: t('toast.submit.success'), key: Date.now(), success: true })
      refresh()
    })
  }

  const continueTask = (task: TaskSummary): void => {
    setActing(true)
    void remote.continueTask(task.id, task.executorId).then((result) => {
      setActing(false)
      if (!result.ok) {
        setToast({ text: t('toast.continue.failed'), key: Date.now(), success: false })
        return
      }
      setToast({ text: t('toast.continue.success'), key: Date.now(), success: true })
      refresh()
    })
  }

  const toggleColumn = (key: string): void => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const currentBot = runTarget !== null ? bots.find(bot => bot.id === selectedBot) : undefined

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div className={css.toolbarActions}>
          <div className={css.search}>
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              placeholder={t('tasks.search')}
              aria-label={t('tasks.search')}
            />
          </div>
          <div className={css.columnMenu}>
            <Button size="sm" variant="outline" onClick={() => { setColumnMenu(!columnMenu) }}>
              {t('tasks.columns')}
            </Button>
            {columnMenu && (
              <div className={css.columnMenuPanel}>
                {boardColumns.map(column => (
                  <Checkbox
                    key={column.key}
                    checked={!hiddenColumns.has(column.key)}
                    onChange={() => { toggleColumn(column.key) }}
                    label={column.title}
                  />
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={refresh}>{t('tasks.refresh')}</Button>
        </div>
      </div>

      {loading ? (
        <div className={css.board}>
          <div className={css.skeletonCard} />
          <div className={css.skeletonCard} />
        </div>
      ) : loadFailed ? (
        <div className={css.loadError} role="alert">
          <span>{t('load.failed')}</span>
          <Button variant="ghost" size="sm" onClick={retryLoad}>{t('load.retry')}</Button>
        </div>
      ) : visibleBoardColumns.length === 0 ? (
        <div className={css.emptyState}>
          <p className={css.empty}>{t('tasks.empty')}</p>
          <Button variant="ghost" size="sm" onClick={refresh}>{t('tasks.refresh')}</Button>
        </div>
      ) : (
        <div className={css.board}>
          {visibleBoardColumns.map(column => (
            <section key={column.key} className={css.boardColumn}>
              <header className={css.statusHeader}>
                <StateDot state={column.key === 'pool' ? 'idle' : statusDot(column.key)} />
                <span className={css.statusTitle}>{column.title}</span>
                <Tag tone={column.key === 'pool' ? 'neutral' : statusTone(column.key)}>{column.tasks.length}</Tag>
              </header>
              <div className={css.boardColumnBody}>
                <ul className={css.cards}>
                  {column.tasks.map((task) => {
                    const danger = task.isBlocked === true || (task.dueAt !== undefined && dueSoon(task.dueAt))
                    return (
                      <li key={task.id} className={danger ? `${css.card} ${css.cardDanger}` : css.card}>
                        <div className={css.cardBody}>
                          <div className={css.cardTitle}>{task.title || task.id}</div>
                          <div className={css.cardMeta}>
                            <Tag tone={typeTone(task.type)}>{typeLabel(t, task.type)}</Tag>
                            {task.priority !== undefined && <Tag tone={priorityTone(task.priority)}>{priorityLabel(t, task.priority)}</Tag>}
                            {task.isBlocked === true && <Tag tone="danger">{t('status.blocked')}</Tag>}
                            {task.status === 'done' && task.resolution !== undefined && (
                              <Tag tone={task.resolution === 'accepted' ? 'success' : 'danger'}>
                                {task.resolution === 'accepted' ? t('resolution.accepted') : t('resolution.rejected')}
                              </Tag>
                            )}
                            <span className={css.cardOwner}>{task.executorId.length > 0 ? botName(task.executorId) : t('run.none')}</span>
                          </div>
                          <div className={css.cardFacts}>
                            {task.projectId !== undefined && projectName(task.projectId) !== undefined && (
                              <span className={css.cardFact}>{projectName(task.projectId)}</span>
                            )}
                            {task.dueAt !== undefined && (
                              <span className={Date.parse(task.dueAt) < Date.now() ? css.overdue : css.cardFact}>
                                {t('task.due')} {formatDate(task.dueAt)}
                              </span>
                            )}
                            {task.createdAt !== undefined && (
                              <span className={css.cardFact}>{t('task.created')} {formatDateTime(task.createdAt)}</span>
                            )}
                          </div>
                          {task.description !== '' && <p className={css.cardDesc}>{task.description}</p>}
                        </div>
                        <div className={css.cardActions}>
                          <Button size="sm" variant="ghost" onClick={() => { openRecords(task.id, task.title || task.id, 'current') }}>{t('records.open')}</Button>
                          {RUNNABLE.has(task.status) && (
                            <Button size="sm" onClick={() => { openRun(task) }}>{t('tasks.execute')}</Button>
                          )}
                          {task.status === 'bot-completed' && task.executorId.length > 0 && (
                            <Button size="sm" variant="outline" disabled={acting} onClick={() => { submitTask(task) }}>{t('tasks.submit')}</Button>
                          )}
                          {task.status === 'awaiting-review' && task.executorId.length > 0 && (
                            <Button size="sm" variant="outline" disabled={acting} onClick={() => { continueTask(task) }}>{t('tasks.continue')}</Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          ))}
        </div>
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
                  items={bots.map(bot => ({ id: bot.id, label: bot.name }))}
                  selectedId={selectedBot}
                  onSelect={(id) => { setSelectedBot(id); setBotMenu(false) }}
                  onClose={() => { setBotMenu(false) }}
                />
              )}
              {currentBot !== undefined && <Tag tone="info">{toolTypeLabel(currentBot.toolType)}</Tag>}
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
            ) : recordsFailed ? (
              <div className={css.loadError} role="alert">
                <span>{t('records.loadFailed')}</span>
                <Button variant="ghost" size="sm" onClick={() => { openRecords(recordTarget.id, recordTarget.title, recordTarget.kind) }}>{t('load.retry')}</Button>
              </div>
            ) : records.length === 0 ? (
              <p className={css.empty}>{t('records.empty')}</p>
            ) : (
              <ul className={css.recordList}>
                {records.map((record, index) => (
                  <li key={`${record.sessionId ?? 'task'}-${index}`} className={css.recordRow}>
                    <Tag tone={recordTone(record)}>
                      {recordLabel(t, record)}
                    </Tag>
                    <span className={css.recordText}>{recordText(t, record)}</span>
                    <span className={css.recordTime}>{formatDateTime(record.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {toast !== null && (
        <Toast
          key={toast.key}
          text={toast.text}
          {...toast.success ? { tone: 'success' as const } : { icon: <IconWarningTriangleOutlineRegular /> }}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
