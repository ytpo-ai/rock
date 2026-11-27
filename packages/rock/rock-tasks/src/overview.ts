/**
 * Pure overview aggregation for the Rock console: fold the employee-visible task
 * queue and the local adapter request log into counts, per-period totals, and a
 * per-bot leaderboard. Periods use Asia/Shanghai day/week/month bounds.
 *
 * @module @rock/rock-tasks/overview
 */
import type { OverviewBotRow, RockOverview, TaskBot, TaskSummary } from './types.ts'

/** Asia/Shanghai fixed offset (UTC+8, no daylight saving). */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** One adapter request-log entry, projected to the fields the overview folds. */
export interface OverviewAdapterLog {
  timestamp: string
  agentBotId?: string
  botName?: string
  tokens?: { input: number; output: number; total?: number }
}

/** Per-period counters used while folding task/token logs into today/week/month buckets. */
interface PeriodCounts {
  today: number
  week: number
  month: number
}

/** A fresh all-zero period counter. */
function zeroCounts(): PeriodCounts {
  return { today: 0, week: 0, month: 0 }
}

/** Token total of one adapter request, falling back to input + output when the provider omitted a total. */
function tokenTotal(tokens: OverviewAdapterLog['tokens']): number {
  if (tokens === undefined) return 0
  return tokens.total ?? tokens.input + tokens.output
}

/** The UTC instant of Asia/Shanghai midnight at the start of `now`'s local day. */
export function startOfDayShanghai(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - SHANGHAI_OFFSET_MS)
}

/** The UTC instant of Asia/Shanghai Monday 00:00 in `now`'s local week. */
export function startOfWeekShanghai(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const diffFromMonday = (shifted.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - diffFromMonday))
  return new Date(monday.getTime() - SHANGHAI_OFFSET_MS)
}

/** The UTC instant of Asia/Shanghai month-start 00:00 in `now`'s local month. */
export function startOfMonthShanghai(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const first = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1))
  return new Date(first.getTime() - SHANGHAI_OFFSET_MS)
}

/**
 * Fold tasks, bots, projects, and adapter logs into the console overview.
 * @param tasks - employee-visible queue (pollTasks, includes terminal tasks).
 * @param bots - employee-visible bots for the counts and name resolution.
 * @param projects - employee-visible projects for the counts.
 * @param logs - local adapter request logs for token totals.
 * @param now - the aggregation instant; period bounds derive from its Shanghai calendar day.
 * @returns counts, today/week/month totals, and the per-bot leaderboard (month task desc).
 */
export function foldOverview(
  tasks: TaskSummary[],
  bots: TaskBot[],
  projects: Array<{ id: string; name: string; slug?: string }>,
  logs: OverviewAdapterLog[],
  now: Date,
): RockOverview {
  const todayStart = startOfDayShanghai(now).getTime()
  const weekStart = startOfWeekShanghai(now).getTime()
  const monthStart = startOfMonthShanghai(now).getTime()

  let runningTasks = 0
  const taskCounts = new Map<string, PeriodCounts>()
  for (const task of tasks) {
    if (task.status === 'in-progress') runningTasks += 1
    if (task.type !== 'task' || task.executorId.length === 0) continue
    const createdMs = task.createdAt === undefined ? Number.NaN : Date.parse(task.createdAt)
    if (Number.isNaN(createdMs)) continue
    const entry = taskCounts.get(task.executorId) ?? zeroCounts()
    if (createdMs >= monthStart) entry.month += 1
    if (createdMs >= weekStart) entry.week += 1
    if (createdMs >= todayStart) entry.today += 1
    taskCounts.set(task.executorId, entry)
  }

  const tokenCounts = new Map<string, PeriodCounts>()
  const nameMap = new Map<string, string>()
  for (const bot of bots) nameMap.set(bot.id, bot.name)
  for (const log of logs) {
    const botId = log.agentBotId ?? ''
    if (botId.length > 0 && !nameMap.has(botId) && log.botName !== undefined && log.botName !== '') {
      nameMap.set(botId, log.botName)
    }
    if (botId.length === 0) continue
    const ts = Date.parse(log.timestamp)
    if (Number.isNaN(ts)) continue
    const tokens = tokenTotal(log.tokens)
    if (tokens === 0) continue
    const entry = tokenCounts.get(botId) ?? zeroCounts()
    if (ts >= monthStart) entry.month += tokens
    if (ts >= weekStart) entry.week += tokens
    if (ts >= todayStart) entry.today += tokens
    tokenCounts.set(botId, entry)
  }

  const botIds = new Set([...taskCounts.keys(), ...tokenCounts.keys()])
  const byBot: OverviewBotRow[] = []
  const totals = {
    today: { tasks: 0, tokens: 0 },
    week: { tasks: 0, tokens: 0 },
    month: { tasks: 0, tokens: 0 },
  }
  for (const botId of botIds) {
    const t = taskCounts.get(botId) ?? zeroCounts()
    const k = tokenCounts.get(botId) ?? zeroCounts()
    const row: OverviewBotRow = {
      botId,
      botName: nameMap.get(botId) ?? botId,
      today: { tasks: t.today, tokens: k.today },
      week: { tasks: t.week, tokens: k.week },
      month: { tasks: t.month, tokens: k.month },
    }
    byBot.push(row)
    totals.today.tasks += row.today.tasks
    totals.today.tokens += row.today.tokens
    totals.week.tasks += row.week.tasks
    totals.week.tokens += row.week.tokens
    totals.month.tasks += row.month.tasks
    totals.month.tokens += row.month.tokens
  }
  byBot.sort((a, b) => (b.month.tasks - a.month.tasks) || (b.month.tokens - a.month.tokens))

  return {
    counts: { bots: bots.length, projects: projects.length, runningTasks },
    totals,
    byBot: byBot.filter(row => row.month.tasks > 0 || row.month.tokens > 0),
  }
}
