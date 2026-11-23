/** Rock observability panel: tabbed relay-forward log and local session rows. */
import { useCallback, useEffect, useRef, useState, type ReactElement, type UIEvent } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservabilityRow, RelayForwardLog } from '@rock/rock-observability/types'
import type { RockObservabilityKey } from './locales.ts'
import css from './rock-observability.module.css'

/** Host operations injected into the Cordis-free panel component. */
export interface RockObservabilitySectionInjected {
  /** The Remote fold: local session rows plus paged relay-forward logs. */
  remote: {
    rows(): Promise<RemoteResult<ObservabilityRow[]>>
    relayLogs(offset: number, limit: number): Promise<RemoteResult<RelayForwardLog[]>>
    relayLogCount(): Promise<RemoteResult<number>>
  }
}

export type RockObservabilitySectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-observability'> & InjectFace<RockObservabilitySectionInjected>

/** The narrow translate seat shared by the tab panels. */
type RelayTranslate = (key: RockObservabilityKey) => string

/** Entries fetched per older-page request. */
const PAGE_SIZE = 50
/** Distance from the scroll bottom, in pixels, that requests one older page. */
const LOAD_OLDER_THRESHOLD = 64

/** One tab value. */
type LogTab = 'relay' | 'sessions'

/** Compact local timestamp: `MM-DD HH:MM:SS`; the cell title carries the full ISO time. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Duration: minutes past one minute, seconds past one second, milliseconds below. */
function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)} min`
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} s` : `${Math.round(value)} ms`
}

/** Bar length on a square-root scale; the longest loaded duration fills the bar. */
function barShare(total: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  if (total <= 0) return 0
  return Math.min(1, Math.sqrt(total / scale))
}

/** One relay forward's model mapping: original → mapped, plus the bound model when known. */
function modelLabel(log: RelayForwardLog): string {
  const original = log.requestModel ?? '—'
  const mapped = `${log.mappedModel}${log.boundModel !== undefined ? ` (${log.boundModel})` : ''}`
  return `${original} → ${mapped}`
}

/** Success when the upstream answered below 400; failure on a ≥400 status or error. */
function statusClass(log: RelayForwardLog): string | undefined {
  if (log.error !== undefined || (log.status !== undefined && log.status >= 400)) return css.statusFail
  if (log.status !== undefined) return css.statusOk
  return css.statusMuted
}

/** Time-bar fill tone: red on failure, blue otherwise. */
function barClass(log: RelayForwardLog): string | undefined {
  return log.error !== undefined || (log.status !== undefined && log.status >= 400) ? css.barFail : css.barOk
}

/** Relay-forward table: newest at the top, scroll down to page older entries. */
export function RelayLogTable({ t, remote }: { t: RelayTranslate; remote: RockObservabilitySectionInjected['remote'] }): ReactElement {
  const [logs, setLogs] = useState<RelayForwardLog[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      remote.relayLogs(0, PAGE_SIZE),
      remote.relayLogCount(),
    ]).then(([page, count]) => {
      if (cancelled) return
      const value = page.ok ? page.value : []
      const totalValue = count.ok ? count.value : value.length
      offsetRef.current = value.length
      setLogs(value)
      setTotal(totalValue)
      setExhausted(value.length >= totalValue)
      setLoadFailed(!page.ok || !count.ok)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [remote])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (loadingRef.current || exhausted || total === null) return
    loadingRef.current = true
    setLoading(true)
    setLoadFailed(false)
    const result = await remote.relayLogs(offsetRef.current, PAGE_SIZE)
    const value = result.ok ? result.value : []
    offsetRef.current += value.length
    if (result.ok) {
      setLogs(previous => [...previous, ...value])
      setExhausted(offsetRef.current >= total)
    } else {
      setLoadFailed(true)
    }
    setLoading(false)
    loadingRef.current = false
  }, [remote, exhausted, total])

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_OLDER_THRESHOLD) void loadOlder()
  }

  const scale = logs.reduce((max, log) => {
    const duration = log.durationMs ?? 0
    return duration > max ? duration : max
  }, 0)

  return (
    <div ref={scrollRef} className={css.scroll} onScroll={onScroll}>
      {logs.length === 0 && !loading
        ? <p className={css.empty}>{t('relay.empty')}</p>
        : (
          <table className={css.table} aria-label={t('tab.relay')}>
            <colgroup>
              <col className={css.colTime} />
              <col className={css.colBot} />
              <col className={css.colTool} />
              <col className={css.colSession} />
              <col className={css.colPath} />
              <col className={css.colModel} />
              <col className={css.colStatus} />
              <col className={css.colDuration} />
            </colgroup>
            <thead>
              <tr>
                <th className={css.th} scope="col">{t('relay.column.time')}</th>
                <th className={css.th} scope="col">{t('relay.column.bot')}</th>
                <th className={css.th} scope="col">{t('relay.column.tool')}</th>
                <th className={css.th} scope="col">{t('relay.column.session')}</th>
                <th className={css.th} scope="col">{t('relay.column.path')}</th>
                <th className={css.th} scope="col">{t('relay.column.model')}</th>
                <th className={css.th} scope="col">{t('relay.column.status')}</th>
                <th className={css.th} scope="col">{t('relay.column.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={`${log.timestamp}-${log.agentBotId}`}>
                  <td className={css.cell} title={log.timestamp}>{formatTime(log.timestamp)}</td>
                  <td className={css.cell} title={log.agentBotId}>{log.botName ?? log.agentBotId}</td>
                  <td className={css.cell}>{log.toolType ?? '—'}</td>
                  <td className={css.cell}>{log.rockSessionId ?? '—'}</td>
                  <td className={css.cell}>{log.pathSuffix}</td>
                  <td className={css.cell} title={modelLabel(log)}>{modelLabel(log)}</td>
                  <td className={css.cell}>
                    <span className={statusClass(log)}>{log.status ?? log.error ?? '—'}</span>
                  </td>
                  <td className={css.cell}>
                    <div className={css.timeWrap}>
                      <div className={css.bar}>
                        <div
                          className={css.barFill}
                          style={{ width: `${Math.round(barShare(log.durationMs ?? 0, scale) * 100)}%` }}
                        >
                          <span className={barClass(log)} />
                        </div>
                      </div>
                      <span className={css.timeValue}>{formatMs(log.durationMs)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <div className={css.older} role="status">
        {loading
          ? <span className={css.olderStatus}>{t('loadOlder.loading')}</span>
          : loadFailed
            ? (
              <button type="button" className={css.retry} onClick={() => { void loadOlder() }}>
                {t('loadOlder.failed')} · {t('loadOlder.retry')}
              </button>
            )
            : exhausted
              ? <span className={css.olderStatus}>{t('loadOlder.done')}</span>
              : null}
      </div>
    </div>
  )
}

/** Local session rows: one per observed session with turns/steps/output-token figures. */
export function SessionsTable({ t, remote }: { t: RelayTranslate; remote: RockObservabilitySectionInjected['remote'] }): ReactElement {
  const [rows, setRows] = useState<ObservabilityRow[]>([])

  useEffect(() => {
    let cancelled = false
    void remote.rows().then((result) => {
      if (!cancelled && result.ok) setRows(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  if (rows.length === 0) return <p className={css.empty}>{t('session.empty')}</p>
  return (
    <table className={css.table} aria-label={t('tab.sessions')}>
      <colgroup>
        <col className={css.colSession} />
        <col className={css.colMetric} />
        <col className={css.colMetric} />
        <col className={css.colMetric} />
      </colgroup>
      <thead>
        <tr>
          <th className={css.th} scope="col">{t('session.column.session')}</th>
          <th className={css.th} scope="col">{t('session.column.turns')}</th>
          <th className={css.th} scope="col">{t('session.column.steps')}</th>
          <th className={css.th} scope="col">{t('session.column.tokens')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.sessionId}>
            <td className={css.cell} title={row.sessionId}>{row.sessionId}</td>
            <td className={css.num}>{row.turns}</td>
            <td className={css.num}>{row.steps}</td>
            <td className={css.num}>{row.outputTokens}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The tab-selected Logs panel. */
export function RockObservabilitySection({ t, remote }: RockObservabilitySectionProps): ReactElement {
  const [tab, setTab] = useState<LogTab>('relay')
  const tabs: readonly { value: LogTab; label: string }[] = [
    { value: 'relay', label: t('tab.relay') },
    { value: 'sessions', label: t('tab.sessions') },
  ]

  return (
    <div className={css.root}>
      <div className={css.tabs} role="tablist" aria-label={t('tab.label')}>
        {tabs.map(item => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={tab === item.value ? css.tabActive : css.tab}
            onClick={() => { setTab(item.value) }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'relay'
        ? <RelayLogTable t={t} remote={remote} />
        : <div className={css.scroll}><SessionsTable t={t} remote={remote} /></div>}
    </div>
  )
}
