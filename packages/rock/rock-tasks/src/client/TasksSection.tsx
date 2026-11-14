/** Rock task-management panel: read-only list of the cloud task queue. */
import { useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TaskSummary } from '@rock/rock-tasks/types'
import css from './rock-tasks.module.css'

/** Host operations injected into the Cordis-free task table. */
export interface TasksSectionInjected {
  remote: {
    listTasks(): Promise<RemoteResult<TaskSummary[]>>
  }
}

export type TasksSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tasks'> & InjectFace<TasksSectionInjected>

/** Render the cloud task queue as a flat read-only table. */
export function TasksSection({ t, remote }: TasksSectionProps): ReactElement {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  useEffect(() => {
    let cancelled = false
    void remote.listTasks().then((result) => {
      if (!cancelled && result.ok) setTasks(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  if (tasks.length === 0) {
    return <p className={css.empty}>{t('tasks.empty')}</p>
  }
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th scope="col">{t('tasks.column.title')}</th>
          <th scope="col">{t('tasks.column.type')}</th>
          <th scope="col">{t('tasks.column.status')}</th>
          <th scope="col">{t('tasks.column.owner')}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(task => (
          <tr key={task.id}>
            <td>{task.title || task.id}</td>
            <td>{task.type}</td>
            <td>{task.status}</td>
            <td>{task.owner}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
