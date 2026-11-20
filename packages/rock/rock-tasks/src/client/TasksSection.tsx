/** Rock task-management panel: board/list dual view over the employee-visible queue, with run/submit/continue and work records. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button, Checkbox, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconWarningTriangleOutlineRegular, Input, Menu, Modal, SegmentedTabs, StateDot, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskBot, TaskSummary, TaskWorkRecord } from '@rock/rock-tasks/types'
import type { RockTasksKey } from './locales.ts'
import { STATUS_ORDER, statusLabel } from './status.ts'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free task panel. */
export interface TasksSectionInjected {
  remote: {
    listTasks(): Promise<RemoteResult<TaskSummary[]>>
    listBots(): Promise<RemoteResult<TaskBot[]>>
    listProjects(): Promise<RemoteResult<Array<{ id: string; name: string; slug?: string }>>>
    runTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    submitTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    continueTask(taskId: string, botId: string): Promise<RemoteResult<TaskSummary>>
    reviewTask(taskId: string, resolution: 'accepted' | 'rejected', reason: string): Promise<RemoteResult<TaskSummary>>
    listWorkRecords(taskId: string): Promise<RemoteResult<TaskWorkRecord[]>>
  }
}

export type TasksSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tasks'> & InjectFace<TasksSectionInjected>

/** Ordering applied within the list view. */
type Sort = 'newest' | 'oldest' | 'due'

/** Which panel is shown: the kanban board or the list. */
type View = 'board' | 'list'

/** Background queue refresh cadence. */
const REFRESH_INTERVAL_MS = 15_000

/** Sentinel id for the "all" option in a filter menu. */
const FILTER_ALL = '__all__'

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

/** Format an ISO-8601 timestamp as a compact local date + time, or '' when unparseable. */
function formatDateTime(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : dateTimeFormatter.format(ms)
}

/** One board column (pool or a status group). */
interface BoardColumn {
  key: string
  title: string
  tasks: TaskSummary[]
}

/** Tag tone for one work-queue status. */
function statusTone(status: string): TagTone {
  switch (status) {
    case 'done': return 'success'
    case 'awaiting-review': return 'violet'
    case 'bot-completed': return 'warning'
    case 'in-progress': return 'info'
    case 'cancelled': return 'quiet'
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

/** Compare two tasks by the active ordering. */
function compareTasks(a: TaskSummary, b: TaskSummary, sort: Sort): number {
  if (sort === 'due') {
    const delta = dueMs(a) - dueMs(b)
    if (delta !== 0) return delta
    return createdMs(b) - createdMs(a)
  }
  const delta = createdMs(a) - createdMs(b)
  return sort === 'oldest' ? delta : -delta
}

/** Countdown text and tone for a due date: overdue red, <1h soon, otherwise normal. */
function dueCountdown(t: (key: RockTasksKey) => string, dueAt?: string): { text: string; tone: 'overdue' | 'soon' | 'normal' } {
  if (dueAt === undefined) return { text: '', tone: 'normal' }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return { text: '', tone: 'normal' }
  const diff = due - Date.now()
  const abs = Math.abs(diff)
  const totalMin = Math.floor(abs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0 || days > 0) parts.push(`${hours}h`)
  parts.push(`${mins}m`)
  const time = parts.join(' ')
  const tone = diff < 0 ? 'overdue' : diff < 3_600_000 ? 'soon' : 'normal'
  const text = diff < 0
    ? t('task.dueCountdown.overdue').replace('{time}', time)
    : t('task.dueCountdown.remaining').replace('{time}', time)
  return { text, tone }
}

/** Countdown class for one tone. */
function countdownClass(tone: 'overdue' | 'soon' | 'normal'): string | undefined {
  if (tone === 'overdue') return css.countdownOverdue
  if (tone === 'soon') return css.countdownSoon
  return css.countdown
}

/** A filter dropdown: an outline button anchored to a Menu, with a leading "all" row. */
function FilterMenu({ label, value, items, onChange }: {
  label: string
  value: string
  items: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const selected = items.some(item => item.id === value) ? value : FILTER_ALL
  const rows = [{ id: FILTER_ALL, label }, ...items]
  return (
    <Menu
      open={open}
      anchor={(
        <Button size="sm" variant="outline" onClick={() => { setOpen(!open) }}>
          {rows.find(row => row.id === selected)?.label ?? label}
        </Button>
      )}
      items={rows}
      selectedId={selected}
      onSelect={(id) => { onChange(id === FILTER_ALL ? '' : id); setOpen(false) }}
      onClose={() => { setOpen(false) }}
    />
  )
}

/** One board card, laid out as header / content / footer. */
function BoardCard({ task, t, botName, projectName, onDetail, onRun, onSubmit, onReview, acting }: {
  task: TaskSummary
  t: (key: RockTasksKey) => string
  botName: (botId: string) => string
  projectName: (projectId?: string) => string | undefined
  onDetail: () => void
  onRun: () => void
  onSubmit: () => void
  onReview: () => void
  acting: boolean
}): ReactElement {
  const danger = task.isBlocked === true || (task.dueAt !== undefined && dueSoon(task.dueAt))
  const countdown = dueCountdown(t, task.dueAt)
  return (
    <li className={danger ? `${css.card} ${css.cardDanger}` : css.card}>
      {/* header: kind + priority + blocked/resolution + due countdown */}
      <div className={css.cardHeader}>
        <div className={css.cardBadges}>
          <Tag tone={typeTone(task.type)}>{typeLabel(t, task.type)}</Tag>
          {task.priority !== undefined && <Tag tone={priorityTone(task.priority)}>{priorityLabel(t, task.priority)}</Tag>}
          {task.isBlocked === true && <Tag tone="danger">{t('status.blocked')}</Tag>}
          {task.status === 'done' && task.resolution !== undefined && (
            <Tag tone={task.resolution === 'accepted' ? 'success' : 'danger'}>
              {task.resolution === 'accepted' ? t('resolution.accepted') : t('resolution.rejected')}
            </Tag>
          )}
        </div>
        {task.dueAt !== undefined && (
          <span className={countdownClass(countdown.tone)}>{countdown.text}</span>
        )}
      </div>

      {/* content: title -> project -> assignee -> executor bot */}
      <button type="button" className={css.cardTitle} onClick={onDetail} title={t('detail.open')}>
        {task.title || task.id}
      </button>
      <div className={css.cardFields}>
        <div className={css.cardField}>
          <span className={css.cardFieldLabel}>{t('task.project')}</span>
          <span className={css.cardFieldValue}>{projectName(task.projectId) ?? t('task.global')}</span>
        </div>
        <div className={css.cardField}>
          <span className={css.cardFieldLabel}>{t('task.assignee')}</span>
          <span className={css.cardFieldValue}>{task.assignee !== undefined && task.assignee !== '' ? t('task.you') : t('task.unassigned')}</span>
        </div>
        <div className={css.cardField}>
          <span className={css.cardFieldLabel}>{t('task.executor')}</span>
          <span className={css.cardFieldValue}>{task.executorId.length > 0 ? botName(task.executorId) : t('task.unassigned')}</span>
        </div>
      </div>
      {task.skills !== undefined && task.skills.length > 0 && (
        <div className={css.cardSkills}>
          {task.skills.map(skill => <span key={skill.id} className={css.cardSkill}>{skill.name}</span>)}
        </div>
      )}

      {/* footer: created time + actions */}
      <div className={css.cardFooter}>
        <span className={css.cardCreated}>{task.createdAt !== undefined ? formatDateTime(task.createdAt) : ''}</span>
        <div className={css.cardActions}>
          <Button size="sm" variant="ghost" onClick={onDetail}>{t('detail.open')}</Button>
          {RUNNABLE.has(task.status) && (
            <Button size="sm" onClick={onRun}>{t('tasks.execute')}</Button>
          )}
          {task.status === 'bot-completed' && task.executorId.length > 0 && (
            <Button size="sm" variant="outline" disabled={acting} onClick={onSubmit}>{t('tasks.submit')}</Button>
          )}
          {task.status === 'awaiting-review' && (
            <Button size="sm" variant="outline" disabled={acting} onClick={onReview}>{t('review.open')}</Button>
          )}
        </div>
      </div>
    </li>
  )
}

/** One grid row in the list view. */
function TaskGridRow({ task, t, botName, projectName, onDetail, onRun, onSubmit, onReview, acting }: {
  task: TaskSummary
  t: (key: RockTasksKey) => string
  botName: (botId: string) => string
  projectName: (projectId?: string) => string | undefined
  onDetail: () => void
  onRun: () => void
  onSubmit: () => void
  onReview: () => void
  acting: boolean
}): ReactElement {
  const danger = task.isBlocked === true || (task.dueAt !== undefined && dueSoon(task.dueAt))
  const countdown = dueCountdown(t, task.dueAt)
  const hasSub = task.description !== '' || (task.skills !== undefined && task.skills.length > 0)
  return (
    <>
      <div role="row" className={danger ? `${css.listRow} ${css.listRowDanger}` : css.listRow}>
        <div role="cell" className={css.colTitle}>
          <div className={css.titleLine}>
            <Tag tone={typeTone(task.type)}>{typeLabel(t, task.type)}</Tag>
            <button type="button" className={css.titleButton} onClick={onDetail} title={t('detail.open')}>
              {task.title || task.id}
            </button>
          </div>
        </div>
        <div role="cell" className={css.colStatus}>
          <Tag tone={statusTone(task.status)}>{statusLabel(t, task.status)}</Tag>
          {task.isBlocked === true && <Tag tone="danger">{t('status.blocked')}</Tag>}
        </div>
        <div role="cell" className={css.colPriority}>
          {task.priority !== undefined
            ? <Tag tone={priorityTone(task.priority)}>{priorityLabel(t, task.priority)}</Tag>
            : <span className={css.cellEmpty}>—</span>}
        </div>
        <div role="cell" className={css.colProject} title={projectName(task.projectId) ?? t('task.global')}>
          {projectName(task.projectId) ?? t('task.global')}
        </div>
        <div role="cell" className={css.colExecutor} title={task.executorId.length > 0 ? botName(task.executorId) : t('task.unassigned')}>
          {task.executorId.length > 0 ? botName(task.executorId) : t('task.unassigned')}
        </div>
        <div role="cell" className={css.colCreatedDue}>
          <span className={css.createdLine}>{task.createdAt !== undefined ? formatDateTime(task.createdAt) : '—'}</span>
          {task.dueAt !== undefined
            ? <span className={countdownClass(countdown.tone)}>{countdown.text}</span>
            : <span className={css.cellEmpty}>—</span>}
        </div>
        <div role="cell" className={css.colActions}>
          <Button size="sm" variant="outline" onClick={onDetail}>{t('detail.open')}</Button>
          {RUNNABLE.has(task.status) && <Button size="sm" onClick={onRun}>{t('tasks.execute')}</Button>}
          {task.status === 'bot-completed' && task.executorId.length > 0 && (
            <Button size="sm" variant="outline" disabled={acting} onClick={onSubmit}>{t('tasks.submit')}</Button>
          )}
          {task.status === 'awaiting-review' && (
            <Button size="sm" variant="outline" disabled={acting} onClick={onReview}>{t('review.open')}</Button>
          )}
        </div>
      </div>
      {hasSub && (
        <div role="row" className={css.listSubRow}>
          <div role="cell" className={css.subRowCell}>
            {task.skills !== undefined && task.skills.length > 0 && (
              <div className={css.subRowLine}>
                <span className={css.subRowLabel}>{t('task.skills')}</span>
                <span className={css.subRowValue}>{task.skills.map(skill => skill.name).join('、')}</span>
              </div>
            )}
            {task.description !== '' && <p className={css.subRowDesc}>{task.description}</p>}
          </div>
        </div>
      )}
    </>
  )
}

/** Render the employee-visible queue: a board/list dual view over cloud tasks. */
export function TasksSection({ t, remote }: TasksSectionProps): ReactElement {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [bots, setBots] = useState<TaskBot[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string; slug?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [view, setView] = useState<View>('board')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [page, setPage] = useState(1)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [columnMenu, setColumnMenu] = useState(false)
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({})
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({})
  const [runTarget, setRunTarget] = useState<TaskSummary | null>(null)
  const [selectedBot, setSelectedBot] = useState('')
  const [botMenu, setBotMenu] = useState(false)
  const [running, setRunning] = useState(false)
  const [acting, setActing] = useState(false)
  const [detailTarget, setDetailTarget] = useState<TaskSummary | null>(null)
  const [records, setRecords] = useState<TaskWorkRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsFailed, setRecordsFailed] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<TaskSummary | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [reviewing, setReviewing] = useState(false)
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
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [remote])

  // Filter/search/sort changes reset the list to the first page.
  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, statusFilter, projectFilter, sort, view])

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

  const botName = (botId: string): string => bots.find(bot => bot.id === botId)?.name ?? botId
  const projectName = (projectId?: string): string | undefined =>
    projectId === undefined ? undefined : projects.find(project => project.id === projectId)?.name

  /** Board columns: pool + statuses, client-grouped and filtered by search/type/project. */
  const boardColumns = useMemo<BoardColumn[]>(() => {
    const pool: TaskSummary[] = []
    const byStatus = new Map<string, TaskSummary[]>()
    for (const task of tasks) {
      if (search.trim() !== '') {
        const q = search.trim().toLowerCase()
        const haystack = `${task.title}\n${task.description}\n${task.type}`.toLowerCase()
        if (!haystack.includes(q)) continue
      }
      if (typeFilter !== '' && task.type !== typeFilter) continue
      if (projectFilter !== '' && task.projectId !== projectFilter) continue
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
  }, [tasks, search, typeFilter, projectFilter, t])

  /** List rows: filtered, sorted, client-side paginated. */
  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = tasks.filter((task) => {
      if (typeFilter !== '' && task.type !== typeFilter) return false
      if (statusFilter !== '' && task.status !== statusFilter) return false
      if (projectFilter !== '' && task.projectId !== projectFilter) return false
      if (q !== '') {
        const haystack = `${task.title}\n${task.description}\n${task.type}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    rows.sort((a, b) => compareTasks(a, b, sort))
    return rows
  }, [tasks, search, typeFilter, statusFilter, projectFilter, sort])

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(listRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = listRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  const visibleBoardColumns = boardColumns.filter(column => !hiddenColumns.has(column.key))

  /** Whether a board column is collapsed; empty columns collapse by default until toggled. */
  const columnCollapsed = (key: string, count: number): boolean =>
    key in collapsedColumns ? collapsedColumns[key] === true : count === 0
  const toggleColumnCollapse = (key: string, count: number): void => {
    setCollapsedColumns(prev => ({ ...prev, [key]: !(key in prev ? prev[key] === true : count === 0) }))
  }

  const openRun = (task: TaskSummary): void => {
    setRunTarget(task)
    setSelectedBot(task.executorId.length > 0 ? task.executorId : '')
  }

  const openDetail = (task: TaskSummary): void => {
    setDetailTarget(task)
    setRecords([])
    setRecordsFailed(false)
    setRecordsLoading(true)
    void remote.listWorkRecords(task.id).then((result) => {
      setRecordsLoading(false)
      if (result.ok) setRecords(result.value)
      else setRecordsFailed(true)
    })
  }

  // Live work-record heartbeat: refresh the records list while the detail modal is open.
  useEffect(() => {
    if (detailTarget === null) return
    const timer = setInterval(() => {
      void remote.listWorkRecords(detailTarget.id).then((result) => {
        if (result.ok) setRecords(result.value)
      })
    }, 1500)
    return () => { clearInterval(timer) }
  }, [detailTarget, remote])

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

  const openReview = (task: TaskSummary): void => {
    setReviewTarget(task)
    setReviewReason('')
  }

  const submitReview = (resolution: 'accepted' | 'rejected' | 'continue'): void => {
    if (reviewTarget === null) return
    setReviewing(true)
    const isContinue = resolution === 'continue'
    const action = isContinue
      ? remote.continueTask(reviewTarget.id, reviewTarget.executorId)
      : remote.reviewTask(reviewTarget.id, resolution, reviewReason)
    void action.then((result) => {
      setReviewing(false)
      if (!result.ok) {
        setToast({ text: t(isContinue ? 'toast.continue.failed' : 'toast.review.failed'), key: Date.now(), success: false })
        return
      }
      setToast({ text: t(isContinue ? 'toast.continue.success' : 'toast.review.success'), key: Date.now(), success: true })
      setReviewTarget(null)
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

  const columnLimit = (key: string): number => columnLimits[key] ?? 20
  const showMore = (key: string): void => {
    setColumnLimits(prev => ({ ...prev, [key]: (prev[key] ?? 20) + 20 }))
  }

  const currentBot = runTarget !== null ? bots.find(bot => bot.id === selectedBot) : undefined

  const typeItems = [
    { id: 'requirement', label: t('type.requirement') },
    { id: 'task', label: t('type.task') },
  ]
  const statusItems = STATUS_ORDER.map(status => ({ id: status, label: statusLabel(t, status) }))
  const projectItems = projects.map(project => ({ id: project.id, label: project.name }))
  const sortItems = [
    { id: 'newest', label: t('tasks.sort.newest') },
    { id: 'oldest', label: t('tasks.sort.oldest') },
    { id: 'due', label: t('tasks.sort.due') },
  ]

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div className={css.toolbarPrimary}>
          <SegmentedTabs
            items={[
              { value: 'board', label: t('tasks.view.board'), id: 'tasks-view-board', panelId: 'tasks-view-board-panel' },
              { value: 'list', label: t('tasks.view.list'), id: 'tasks-view-list', panelId: 'tasks-view-list-panel' },
            ]}
            value={view}
            onChange={(next) => { setView(next) }}
            label={t('tasks.tabs.label')}
            size="sm"
          />
        </div>
        <div className={css.toolbarSecondary}>
          <div className={css.search}>
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              placeholder={t('tasks.search')}
              aria-label={t('tasks.search')}
            />
          </div>
          <FilterMenu
            label={t('tasks.filter.allTypes')}
            value={typeFilter}
            items={typeItems}
            onChange={setTypeFilter}
          />
          <FilterMenu
            label={t('tasks.filter.allProjects')}
            value={projectFilter}
            items={projectItems}
            onChange={setProjectFilter}
          />
          {view === 'list' && (
            <FilterMenu
              label={t('tasks.filter.allStatuses')}
              value={statusFilter}
              items={statusItems}
              onChange={setStatusFilter}
            />
          )}
          {view === 'list' && (
            <FilterMenu
              label={t('tasks.filter.sort')}
              value={sort}
              items={sortItems}
              onChange={(next) => { setSort(next as Sort) }}
            />
          )}
          {view === 'board' && (
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
          )}
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
      ) : view === 'board' ? (
        visibleBoardColumns.length === 0 ? (
          <div className={css.emptyState}>
            <p className={css.empty}>{t('tasks.empty')}</p>
            <Button variant="ghost" size="sm" onClick={refresh}>{t('tasks.refresh')}</Button>
          </div>
        ) : (
          <div className={css.board}>
            {visibleBoardColumns.map((column) => {
              const collapsed = columnCollapsed(column.key, column.tasks.length)
              return (
                <section key={column.key} className={collapsed ? `${css.boardColumn} ${css.boardColumnCollapsed}` : css.boardColumn}>
                  <header className={css.statusHeader}>
                    <button
                      type="button"
                      className={css.columnHeaderButton}
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? t('tasks.expandColumn') : t('tasks.collapseColumn')}
                      onClick={() => { toggleColumnCollapse(column.key, column.tasks.length) }}
                    >
                      {collapsed ? <IconChevronRightOutlineRegular /> : <IconChevronDownOutlineRegular />}
                    </button>
                    <StateDot state={column.key === 'pool' ? 'idle' : statusDot(column.key)} />
                    <span className={css.statusTitle}>{column.title}</span>
                    <Tag tone={column.key === 'pool' ? 'neutral' : statusTone(column.key)}>{column.tasks.length}</Tag>
                  </header>
                  {!collapsed && (
                    <>
                      <div className={css.boardColumnBody}>
                        <ul className={css.cards}>
                          {column.tasks.slice(0, columnLimit(column.key)).map(task => (
                            <BoardCard
                              key={task.id}
                              task={task}
                              t={t}
                              botName={botName}
                              projectName={projectName}
                              acting={acting}
                              onDetail={() => { openDetail(task) }}
                              onRun={() => { openRun(task) }}
                              onSubmit={() => { submitTask(task) }}
                              onReview={() => { openReview(task) }}
                            />
                          ))}
                        </ul>
                      </div>
                      {column.tasks.length > columnLimit(column.key) && (
                        <Button size="sm" variant="ghost" onClick={() => { showMore(column.key) }}>{t('tasks.more')}</Button>
                      )}
                    </>
                  )}
                </section>
              )
            })}
          </div>
        )
      ) : (
        <>
          <div className={css.listSummary}>
            <span>{listRows.length} {t('tasks.listCount')}</span>
          </div>
          {listRows.length === 0 ? (
            <div className={css.emptyState}>
              <p className={css.empty}>{t('tasks.emptyList')}</p>
            </div>
          ) : (
            <div className={css.listTable}>
              <div className={css.listGrid} role="table" aria-label={t('tasks.listLabel')}>
                <div className={css.listHead} role="row">
                  <span role="columnheader" className={css.colTitle}>{t('task.title')}</span>
                  <span role="columnheader" className={css.colStatus}>{t('task.status')}</span>
                  <span role="columnheader" className={css.colPriority}>{t('task.priority')}</span>
                  <span role="columnheader" className={css.colProject}>{t('task.project')}</span>
                  <span role="columnheader" className={css.colExecutor}>{t('task.executor')}</span>
                  <span role="columnheader" className={css.colCreatedDue}>{t('task.createdDue')}</span>
                  <span role="columnheader" className={css.colActions}>
                    <span className={css.visuallyHidden}>{t('task.actions')}</span>
                  </span>
                </div>
                {pageItems.map(task => (
                  <TaskGridRow
                    key={task.id}
                    task={task}
                    t={t}
                    botName={botName}
                    projectName={projectName}
                    acting={acting}
                    onDetail={() => { openDetail(task) }}
                    onRun={() => { openRun(task) }}
                    onSubmit={() => { submitTask(task) }}
                    onReview={() => { openReview(task) }}
                  />
                ))}
              </div>
            </div>
          )}
          {totalPages > 1 && (
            <div className={css.listPager}>
              <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => { setPage(safePage - 1) }}>{t('list.prev')}</Button>
              <span className={css.listPagerMeta}>{safePage} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => { setPage(safePage + 1) }}>{t('list.next')}</Button>
            </div>
          )}
        </>
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

      {detailTarget !== null && (
        <Modal
          open
          onClose={() => { setDetailTarget(null) }}
          title={detailTarget.title || detailTarget.id}
          description={t('detail.description')}
          closeLabel={t('run.cancel')}
          footer={(
            <Button variant="ghost" onClick={() => { setDetailTarget(null) }}>{t('run.cancel')}</Button>
          )}
        >
          <div className={css.detail}>
            <div className={css.detailBadges}>
              <Tag tone={typeTone(detailTarget.type)}>{typeLabel(t, detailTarget.type)}</Tag>
              <Tag tone={statusTone(detailTarget.status)}>{statusLabel(t, detailTarget.status)}</Tag>
              {detailTarget.isBlocked === true && <Tag tone="danger">{t('status.blocked')}</Tag>}
              {detailTarget.status === 'done' && detailTarget.resolution !== undefined && (
                <Tag tone={detailTarget.resolution === 'accepted' ? 'success' : 'danger'}>
                  {detailTarget.resolution === 'accepted' ? t('resolution.accepted') : t('resolution.rejected')}
                </Tag>
              )}
              {detailTarget.priority !== undefined && (
                <Tag tone={priorityTone(detailTarget.priority)}>{priorityLabel(t, detailTarget.priority)}</Tag>
              )}
            </div>

            {detailTarget.description !== '' && <p className={css.detailDesc}>{detailTarget.description}</p>}

            <div className={css.detailFields}>
              <div className={css.rowField}>
                <span className={css.cardFieldLabel}>{t('task.project')}</span>
                <span>{projectName(detailTarget.projectId) ?? t('task.global')}</span>
              </div>
              <div className={css.rowField}>
                <span className={css.cardFieldLabel}>{t('task.executor')}</span>
                <span>{detailTarget.executorId.length > 0 ? botName(detailTarget.executorId) : t('task.unassigned')}</span>
              </div>
              {detailTarget.assignee !== undefined && detailTarget.assignee !== '' && (
                <div className={css.rowField}>
                  <span className={css.cardFieldLabel}>{t('task.assignee')}</span>
                  <span>{t('task.you')}</span>
                </div>
              )}
              {detailTarget.skills !== undefined && detailTarget.skills.length > 0 && (
                <div className={css.rowField}>
                  <span className={css.cardFieldLabel}>{t('task.skills')}</span>
                  <span className={css.cardSkills}>
                    {detailTarget.skills.map(skill => <span key={skill.id} className={css.cardSkill}>{skill.name}</span>)}
                  </span>
                </div>
              )}
              {detailTarget.dueAt !== undefined && (
                <div className={css.rowField}>
                  <span className={css.cardFieldLabel}>{t('task.due')}</span>
                  <span>{formatDateTime(detailTarget.dueAt)}</span>
                </div>
              )}
              {detailTarget.createdAt !== undefined && (
                <div className={css.rowField}>
                  <span className={css.cardFieldLabel}>{t('task.created')}</span>
                  <span>{formatDateTime(detailTarget.createdAt)}</span>
                </div>
              )}
              {detailTarget.isBlocked === true && detailTarget.blockReason !== undefined && (
                <div className={css.rowField}>
                  <span className={css.cardFieldLabel}>{t('task.blockReason')}</span>
                  <span>{detailTarget.blockReason}</span>
                </div>
              )}
            </div>

            <h3 className={css.recordsHeading}>{t('records.title')}</h3>
            {recordsLoading ? (
              <p className={css.empty}>{t('records.loading')}</p>
            ) : recordsFailed ? (
              <div className={css.loadError} role="alert">
                <span>{t('records.loadFailed')}</span>
                <Button variant="ghost" size="sm" onClick={() => { openDetail(detailTarget) }}>{t('load.retry')}</Button>
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

      {reviewTarget !== null && (
        <Modal
          open
          onClose={() => { if (!reviewing) setReviewTarget(null) }}
          title={t('review.title')}
          description={reviewTarget.title || reviewTarget.id}
          closeLabel={t('run.cancel')}
          footer={(
            <>
              <Button variant="ghost" disabled={reviewing} onClick={() => { setReviewTarget(null) }}>{t('run.cancel')}</Button>
              <Button variant="outline" disabled={reviewing} onClick={() => { submitReview('continue') }}>{t('tasks.continue')}</Button>
              <Button variant="outline" disabled={reviewing} onClick={() => { submitReview('rejected') }}>{t('review.reject')}</Button>
              <Button variant="primary" disabled={reviewing} onClick={() => { submitReview('accepted') }}>{t('review.accept')}</Button>
            </>
          )}
        >
          <div className={css.reviewDialog}>
            <p className={css.reviewDesc}>{t('review.description')}</p>
            <Input
              value={reviewReason}
              onChange={(event) => { setReviewReason(event.target.value) }}
              placeholder={t('review.reason')}
              aria-label={t('review.reason')}
            />
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
