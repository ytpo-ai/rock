/** Rock overview panel: console dashboard with counts, period totals, and per-bot leaderboards. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OverviewBotRow, RockOverview } from '@rock/rock-tasks/types'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free overview component. */
export interface OverviewSectionInjected {
  remote: {
    overview(): Promise<RemoteResult<RockOverview>>
  }
}

export type OverviewSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tasks'> & InjectFace<OverviewSectionInjected>

/** Selectable aggregation period. */
type Period = 'month' | 'week' | 'today'

/** One leaderboard row: a bot and its period value. */
interface RankItem {
  botId: string
  botName: string
  value: number
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value))
}

function formatTokens(value: number): string {
  const v = value
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

function valueOf(row: OverviewBotRow, period: Period, metric: 'tasks' | 'tokens'): number {
  return row[period][metric]
}

function StatCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className={css.statCard}>
      <span className={css.statLabel}>{label}</span>
      <span className={css.statValue}>{value}</span>
    </div>
  )
}

function Leaderboard({ title, items, barClass, format }: {
  title: string
  items: RankItem[]
  barClass: string | undefined
  format: (value: number) => string
}): ReactElement {
  const max = items[0]?.value ?? 0
  return (
    <div className={css.leaderboard}>
      <p className={css.leaderboardTitle}>{title}</p>
      {items.length === 0 ? (
        <p className={css.empty}>—</p>
      ) : (
        <ul className={css.rankList}>
          {items.map((item, index) => {
            const pct = max > 0 ? Math.max(2, (item.value / max) * 100) : 0
            return (
              <li key={item.botId} className={css.rankRow}>
                <span className={css.rankIndex}>{index + 1}</span>
                <span className={css.rankName} title={item.botName}>{item.botName}</span>
                <div className={css.rankTrack}>
                  <div className={[css.rankBar, barClass].filter(Boolean).join(' ')} style={{ width: `${pct}%` }} />
                </div>
                <span className={css.rankValue}>{format(item.value)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Render the per-bot console dashboard. */
export function OverviewSection({ t, remote }: OverviewSectionProps): ReactElement {
  const [overview, setOverview] = useState<RockOverview | null>(null)
  const [period, setPeriod] = useState<Period>('month')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void remote.overview().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) setOverview(result.value)
      else setFailed(true)
    })
    return () => { cancelled = true }
  }, [remote, reload])

  const taskRank = useMemo<RankItem[]>(() => (
    (overview?.byBot ?? [])
      .map(bot => ({ botId: bot.botId, botName: bot.botName, value: valueOf(bot, period, 'tasks') }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  ), [overview, period])

  const tokenRank = useMemo<RankItem[]>(() => (
    (overview?.byBot ?? [])
      .map(bot => ({ botId: bot.botId, botName: bot.botName, value: valueOf(bot, period, 'tokens') }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  ), [overview, period])

  const totals = overview?.totals ?? {
    today: { tasks: 0, tokens: 0, accepted: 0, assigned: 0 },
    week: { tasks: 0, tokens: 0, accepted: 0, assigned: 0 },
    month: { tasks: 0, tokens: 0, accepted: 0, assigned: 0 },
  }

  return (
    <div className={css.page}>
      {loading ? (
        <p className={css.empty}>{t('overview.loading')}</p>
      ) : failed ? (
        <p className={css.empty}>
          {t('load.failed')} <Button variant="ghost" size="sm" onClick={() => { setReload(v => v + 1) }}>{t('load.retry')}</Button>
        </p>
      ) : (
        <div className={css.overview}>
          <div className={css.statGrid}>
            <StatCard label={t('overview.bots')} value={formatNumber(overview?.counts.bots ?? 0)} />
            <StatCard label={t('overview.projects')} value={formatNumber(overview?.counts.projects ?? 0)} />
            <StatCard label={t('overview.runningTasks')} value={formatNumber(overview?.counts.runningTasks ?? 0)} />
          </div>

          <div className={css.statGrid}>
            <div className={css.statCard}>
              <span className={css.statLabel}>{t('overview.period.today')}</span>
              <span className={css.periodMetric}>{t('overview.tasks')} {formatNumber(totals.today.accepted)}<span className={css.acceptedCheck}>✓</span><span className={css.ratioSeparator}>/</span>{formatNumber(totals.today.assigned)}</span>
              <span className={css.periodMetric}>{t('overview.tokens')} {formatTokens(totals.today.tokens)}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>{t('overview.period.week')}</span>
              <span className={css.periodMetric}>{t('overview.tasks')} {formatNumber(totals.week.accepted)}<span className={css.acceptedCheck}>✓</span><span className={css.ratioSeparator}>/</span>{formatNumber(totals.week.assigned)}</span>
              <span className={css.periodMetric}>{t('overview.tokens')} {formatTokens(totals.week.tokens)}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>{t('overview.period.month')}</span>
              <span className={css.periodMetric}>{t('overview.tasks')} {formatNumber(totals.month.accepted)}<span className={css.acceptedCheck}>✓</span><span className={css.ratioSeparator}>/</span>{formatNumber(totals.month.assigned)}</span>
              <span className={css.periodMetric}>{t('overview.tokens')} {formatTokens(totals.month.tokens)}</span>
            </div>
          </div>

          <div className={css.periodToolbar}>
            <SegmentedTabs
              items={[
                { value: 'month', label: t('overview.period.month'), id: 'overview-period-month', panelId: 'overview-period-month-panel' },
                { value: 'week', label: t('overview.period.week'), id: 'overview-period-week', panelId: 'overview-period-week-panel' },
                { value: 'today', label: t('overview.period.today'), id: 'overview-period-today', panelId: 'overview-period-today-panel' },
              ]}
              value={period}
              onChange={setPeriod}
              label={t('overview.period.label')}
              size="sm"
            />
          </div>

          <div className={css.leaderboards}>
            <Leaderboard title={t('overview.taskRank')} items={taskRank} barClass={css.rankBarTask} format={formatNumber} />
            <Leaderboard title={t('overview.tokenRank')} items={tokenRank} barClass={css.rankBarToken} format={formatTokens} />
          </div>
        </div>
      )}
    </div>
  )
}
