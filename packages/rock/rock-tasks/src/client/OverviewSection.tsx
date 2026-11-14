/** Rock overview panel: which bot is running which task, with task status. */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TaskSummary } from '@rock/rock-tasks/types'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free overview component. */
export interface OverviewSectionInjected {
  remote: {
    listTasks(): Promise<RemoteResult<TaskSummary[]>>
  }
}

export type OverviewSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tasks'> & InjectFace<OverviewSectionInjected>

/** One bot row: its id, whether it is running, and its tasks. */
interface BotOverview {
  botId: string
  running: boolean
  tasks: TaskSummary[]
}

/** A task is "running" while it is in progress. */
function isRunning(task: TaskSummary): boolean {
  return task.status === 'in-progress'
}

/** Group tasks by owning bot, marking bots with an in-progress task as running. */
function groupByBot(tasks: readonly TaskSummary[]): BotOverview[] {
  const map = new Map<string, BotOverview>()
  for (const task of tasks) {
    const botId = task.owner.length > 0 ? task.owner : '(unassigned)'
    let entry = map.get(botId)
    if (entry === undefined) {
      entry = { botId, running: false, tasks: [] }
      map.set(botId, entry)
    }
    entry.tasks.push(task)
    if (isRunning(task)) entry.running = true
  }
  return [...map.values()]
}

/** Render the per-bot task overview. */
export function OverviewSection({ t, remote }: OverviewSectionProps): ReactElement {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  useEffect(() => {
    let cancelled = false
    void remote.listTasks().then((result) => {
      if (!cancelled && result.ok) setTasks(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  const bots = useMemo(() => groupByBot(tasks), [tasks])

  if (bots.length === 0) {
    return <p className={css.empty}>{t('overview.empty')}</p>
  }
  return (
    <div className={css.overview}>
      {bots.map(bot => (
        <section key={bot.botId} className={css.botCard}>
          <header className={css.botHeader}>
            <span className={css.botId}>{bot.botId}</span>
            <span className={bot.running ? css.running : css.idle}>
              {bot.running ? t('overview.running') : t('overview.idle')}
            </span>
          </header>
          <ul className={css.taskList}>
            {bot.tasks.map(task => (
              <li key={task.id} className={css.taskRow}>
                <span className={css.taskTitle}>{task.title || task.id}</span>
                <span className={css.taskStatus}>{task.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
