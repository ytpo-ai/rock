/** Rock observability panel: refresh, bot filter, page size, and tabbed log tables. */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, IconRefreshOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AdapterRequestLog, BotOption, ObservabilityRow, RelayForwardLog } from '@rock/rock-observability/types'
import type { RockObservabilityKey } from './locales.ts'
import { LogDisplayDialog } from './LogDisplayDialog.tsx'
import {
  DEFAULT_PAGE_SIZE,
  barShare,
  durationScale,
  formatMs,
  formatTime,
  reachedLoadOlderThreshold,
  usePagedLogs,
  type PagedLogs,
} from './paged-logs.ts'
import css from './rock-observability.module.css'

/** Host operations injected into the Cordis-free panel component. */
export interface RockObservabilitySectionInjected {
  /** The Remote fold: local session rows plus paged relay-forward and adapter request logs. */
  remote: {
    rows(): Promise<RemoteResult<ObservabilityRow[]>>
    relayLogs(offset: number, limit: number, botId?: string): Promise<RemoteResult<RelayForwardLog[]>>
    relayLogCount(botId?: string): Promise<RemoteResult<number>>
    adapterLogs(offset: number, limit: number, botId?: string): Promise<RemoteResult<AdapterRequestLog[]>>
    adapterLogCount(botId?: string): Promise<RemoteResult<number>>
    bots(): Promise<RemoteResult<BotOption[]>>
  }
}

export type RockObservabilitySectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-observability'> & InjectFace<RockObservabilitySectionInjected>

/** The narrow translate seat shared by the tab panels. */
type RelayTranslate = (key: RockObservabilityKey) => string

/** One tab value; the session aggregate tab is not surfaced yet. */
type LogTab = 'relay' | 'adapter'

/** The bot filter value that selects every bot. */
const ALL_BOTS = ''

/** One relay forward's model mapping: original → mapped, plus the bound model when known. */
function modelLabel(log: RelayForwardLog): string {
  const original = log.requestModel ?? '—'
  const mapped = `${log.mappedModel}${log.boundModel !== undefined ? ` (${log.boundModel})` : ''}`
  return `${original} → ${mapped}`
}

/** One adapter request's token reading: `input → output`, with cache counts in the cell title. */
function tokenLabel(log: AdapterRequestLog): string {
  const tokens = log.tokens
  if (tokens === undefined) return '—'
  return `${formatCount(tokens.input)} → ${formatCount(tokens.output)}`
}

/** The full token breakdown for the cell title. */
function tokenDetail(log: AdapterRequestLog): string {
  const tokens = log.tokens
  if (tokens === undefined) return ''
  const parts = [`in ${formatCount(tokens.input)}`, `out ${formatCount(tokens.output)}`]
  if (tokens.cacheRead !== undefined) parts.push(`cache read ${formatCount(tokens.cacheRead)}`)
  if (tokens.cacheWrite !== undefined) parts.push(`cache write ${formatCount(tokens.cacheWrite)}`)
  if (tokens.reasoning !== undefined) parts.push(`reasoning ${formatCount(tokens.reasoning)}`)
  if (tokens.total !== undefined) parts.push(`total ${formatCount(tokens.total)}`)
  return parts.join(' · ')
}

/** Compact token figure: thousands past one thousand, exact below. */
function formatCount(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value)
}

/** Success when the upstream answered below 400; failure on a ≥400 status or error. */
function statusClass(status: number | undefined, hasError: boolean): string | undefined {
  if (hasError || (status !== undefined && status >= 400)) return css.statusFail
  if (status !== undefined) return css.statusOk
  return css.statusMuted
}

/** Time-bar fill tone: red on failure, blue otherwise. */
function barClass(hasError: boolean): string | undefined {
  return hasError ? css.barFail : css.barOk
}

/** The paging footer shared by both log tables: loading, retry, and end-of-history states. */
function LoadOlderFooter({ t, logs }: { t: RelayTranslate; logs: PagedLogs<unknown> }): ReactElement {
  return (
    <div className={css.older} role="status">
      {logs.loading
        ? <span className={css.olderStatus}>{t('loadOlder.loading')}</span>
        : logs.loadFailed
          ? (
            <button type="button" className={css.retry} onClick={() => { void logs.loadOlder() }}>
              {t('loadOlder.failed')} · {t('loadOlder.retry')}
            </button>
          )
          : logs.exhausted
            ? <span className={css.olderStatus}>{t('loadOlder.done')}</span>
            : null}
    </div>
  )
}

/** One duration cell: a scaled bar plus the formatted value. */
function DurationCell({ durationMs, failed, scale }: { durationMs: number | undefined; failed: boolean; scale: number }): ReactElement {
  return (
    <div className={css.timeWrap}>
      <div className={css.bar}>
        <div className={css.barFill} style={{ width: `${Math.round(barShare(durationMs ?? 0, scale) * 100)}%` }}>
          <span className={barClass(failed)} />
        </div>
      </div>
      <span className={css.timeValue}>{formatMs(durationMs)}</span>
    </div>
  )
}

/** Relay-forward table: newest at the top, scroll down to page older entries. */
export function RelayLogTable({ t, logs }: { t: RelayTranslate; logs: PagedLogs<RelayForwardLog> }): ReactElement {
  const scale = durationScale(logs.entries)

  if (logs.entries.length === 0 && !logs.loading) {
    return <p className={css.empty}>{logs.loadFailed ? t('loadOlder.failed') : t('relay.empty')}</p>
  }
  return (
    <div className={css.scroll} onScroll={(event) => { if (reachedLoadOlderThreshold(event)) void logs.loadOlder() }}>
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
          {logs.entries.map(log => (
            <tr key={`${log.timestamp}-${log.agentBotId}`}>
              <td className={css.cell} title={log.timestamp}>{formatTime(log.timestamp)}</td>
              <td className={css.cell} title={log.agentBotId}>{log.botName ?? log.agentBotId}</td>
              <td className={css.cell}>{log.toolType ?? '—'}</td>
              <td className={css.cell} title={log.rockSessionId}>{log.rockSessionId ?? '—'}</td>
              <td className={css.cell}>{log.pathSuffix}</td>
              <td className={css.cell} title={modelLabel(log)}>{modelLabel(log)}</td>
              <td className={css.cell}>
                <span className={statusClass(log.status, log.error !== undefined)}>{log.status ?? log.error ?? '—'}</span>
              </td>
              <td className={css.cell}>
                <DurationCell durationMs={log.durationMs} failed={log.error !== undefined} scale={scale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadOlderFooter t={t} logs={logs} />
    </div>
  )
}

/** Adapter request table: one row per model call the Rock agent made. */
export function AdapterLogTable({ t, logs }: { t: RelayTranslate; logs: PagedLogs<AdapterRequestLog> }): ReactElement {
  const scale = durationScale(logs.entries)

  if (logs.entries.length === 0 && !logs.loading) {
    return <p className={css.empty}>{logs.loadFailed ? t('loadOlder.failed') : t('adapter.empty')}</p>
  }
  return (
    <div className={css.scroll} onScroll={(event) => { if (reachedLoadOlderThreshold(event)) void logs.loadOlder() }}>
      <table className={css.table} aria-label={t('tab.adapter')}>
        <colgroup>
          <col className={css.colTime} />
          <col className={css.colBot} />
          <col className={css.colProvider} />
          <col className={css.colSession} />
          <col className={css.colModel} />
          <col className={css.colTokens} />
          <col className={css.colStatus} />
          <col className={css.colDuration} />
        </colgroup>
        <thead>
          <tr>
            <th className={css.th} scope="col">{t('adapter.column.time')}</th>
            <th className={css.th} scope="col">{t('adapter.column.bot')}</th>
            <th className={css.th} scope="col">{t('adapter.column.provider')}</th>
            <th className={css.th} scope="col">{t('adapter.column.session')}</th>
            <th className={css.th} scope="col">{t('adapter.column.model')}</th>
            <th className={css.th} scope="col">{t('adapter.column.tokens')}</th>
            <th className={css.th} scope="col">{t('adapter.column.status')}</th>
            <th className={css.th} scope="col">{t('adapter.column.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {logs.entries.map((log, index) => (
            <tr key={`${log.timestamp}-${log.provider}-${log.sessionId ?? ''}-${String(index)}`}>
              <td className={css.cell} title={log.timestamp}>{formatTime(log.timestamp)}</td>
              <td className={css.cell} title={log.agentBotId ?? undefined}>{log.botName ?? log.agentBotId ?? '—'}</td>
              <td className={css.cell} title={log.wireProtocol}>{log.provider}</td>
              <td className={css.cell} title={log.sessionId}>{log.sessionId ?? '—'}</td>
              <td className={css.cell} title={log.boundModel === undefined ? log.requestModel : `${log.requestModel} → ${log.boundModel}`}>
                {log.boundModel === undefined ? log.requestModel : `${log.requestModel} → ${log.boundModel}`}
              </td>
              <td className={css.cell} title={tokenDetail(log)}>{tokenLabel(log)}</td>
              <td className={css.cell}>
                <span className={statusClass(log.status, log.error !== undefined)}>{log.status ?? log.error ?? '—'}</span>
              </td>
              <td className={css.cell}>
                <DurationCell durationMs={log.durationMs} failed={log.error !== undefined} scale={scale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadOlderFooter t={t} logs={logs} />
    </div>
  )
}

/** The tab-selected Logs panel with its shared refresh, bot filter, and page-size controls. */
export function RockObservabilitySection({ t, remote }: RockObservabilitySectionProps): ReactElement {
  const [tab, setTab] = useState<LogTab>('relay')
  const [botId, setBotId] = useState(ALL_BOTS)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [revision, setRevision] = useState(0)
  const [bots, setBots] = useState<BotOption[]>([])
  const [botMenu, setBotMenu] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void remote.bots().then((result) => {
      if (!cancelled && result.ok) setBots(result.value)
    })
    return () => { cancelled = true }
  }, [remote, revision])

  const scope = botId === ALL_BOTS ? undefined : botId
  const loadRelay = useCallback(
    (offset: number, limit: number) => remote.relayLogs(offset, limit, scope),
    [remote, scope],
  )
  const countRelay = useCallback(() => remote.relayLogCount(scope), [remote, scope])
  const loadAdapter = useCallback(
    (offset: number, limit: number) => remote.adapterLogs(offset, limit, scope),
    [remote, scope],
  )
  const countAdapter = useCallback(() => remote.adapterLogCount(scope), [remote, scope])

  const relay = usePagedLogs(loadRelay, countRelay, pageSize, revision)
  const adapter = usePagedLogs(loadAdapter, countAdapter, pageSize, revision)

  const tabs: readonly { value: LogTab; label: string }[] = [
    { value: 'relay', label: t('tab.relay') },
    { value: 'adapter', label: t('tab.adapter') },
  ]
  const activeBot = bots.find(bot => bot.id === botId)
  const botLabel = activeBot?.name ?? (botId === ALL_BOTS ? t('filter.all') : botId)

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <Button
          size="sm"
          variant="outline"
          icon={<IconRefreshOutlineRegular size={14} />}
          disabled={relay.loading || adapter.loading}
          onClick={() => { setRevision(current => current + 1) }}
        >
          {t('toolbar.refresh')}
        </Button>
        <Menu
          open={botMenu}
          anchor={(
            <Button size="sm" variant="outline" onClick={() => { setBotMenu(!botMenu) }}>
              {t('filter.bot')}: {botLabel}
            </Button>
          )}
          items={[
            { id: ALL_BOTS, label: t('filter.all') },
            ...bots.map(bot => ({ id: bot.id, label: bot.name })),
          ]}
          selectedId={botId}
          onSelect={(id) => {
            setBotId(id)
            setBotMenu(false)
          }}
          onClose={() => { setBotMenu(false) }}
        />
        <Button size="sm" variant="outline" onClick={() => { setDisplayOpen(true) }}>
          {t('display.button')}: {pageSize}
        </Button>
      </div>
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
      {tab === 'relay' && <RelayLogTable t={t} logs={relay} />}
      {tab === 'adapter' && <AdapterLogTable t={t} logs={adapter} />}
      {displayOpen && (
        <LogDisplayDialog
          open
          pageSize={pageSize}
          t={t}
          onApply={(size) => {
            setPageSize(size)
            setDisplayOpen(false)
          }}
          onClose={() => { setDisplayOpen(false) }}
        />
      )}
    </div>
  )
}
