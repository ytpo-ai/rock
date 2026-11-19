/** Rock tool inventory panel: detected runner states plus a single-line detection progress row. */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetectState, ToolStatus } from '@rock/rock-tool-inventory/types'
import css from './rock-tool-inventory.module.css'

/** Poll interval while a detection run is in flight. */
const DETECT_POLL_MS = 1000

/** Host operations injected into the Cordis-free read-only component. */
export interface ToolInventorySectionInjected {
  remote: {
    listTools(): Promise<RemoteResult<ToolStatus[]>>
    detect(): Promise<RemoteResult<DetectState>>
    detectState(): Promise<RemoteResult<DetectState>>
  }
  openSession: (sessionId: string) => void
}

export type ToolInventorySectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-tool-inventory'> & InjectFace<ToolInventorySectionInjected>

type RunnerState = 'running' | 'installed' | 'missing'

/** Derive the runner state from one status row. */
function runnerState(tool: ToolStatus): RunnerState {
  if (tool.running === true) return 'running'
  return tool.installed ? 'installed' : 'missing'
}

/** Dot state for a runner row. */
function runnerDot(state: RunnerState): 'done' | 'idle' {
  return state === 'running' ? 'done' : 'idle'
}

/** Render the detected runner rows plus the single-line assistant-LLM detection progress. */
export function ToolInventorySection({ t, remote, openSession }: ToolInventorySectionProps): ReactElement {
  const [tools, setTools] = useState<ToolStatus[]>([])
  const [detect, setDetect] = useState<DetectState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void remote.listTools().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setTools(result.value)
      else setLoadFailed(true)
    })
    void remote.detectState().then((result) => {
      if (!cancelled && result.ok) setDetect(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  useEffect(() => {
    if (detect?.running !== true) return
    const timer = setInterval(() => {
      void remote.detectState().then((result) => {
        if (result.ok) setDetect(result.value)
      })
    }, DETECT_POLL_MS)
    return () => { clearInterval(timer) }
  }, [detect?.running, remote])

  const runDetect = (): void => {
    void remote.detect().then((result) => {
      if (result.ok) setDetect(result.value)
      else setLoadFailed(true)
    })
  }

  const statuses = detect !== null && detect.statuses.length > 0 ? detect.statuses : tools
  const running = detect?.running === true
  const progress = detect?.progress
  const sessionId = detect?.sessionId

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <Button variant="primary" size="sm" disabled={running} onClick={runDetect}>
          {running ? t('detect.running') : t('detect.action')}
        </Button>
      </div>

      {detect !== null && progress !== undefined && (running || sessionId !== undefined) ? (
        <ProgressRow
          running={running}
          detected={progress.detected}
          total={progress.total}
          current={progress.current}
          sessionId={sessionId}
          t={t}
          openSession={openSession}
        />
      ) : null}

      {loading ? (
        <div className={css.list} aria-hidden>
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
          <div className={css.skeletonRow} />
        </div>
      ) : loadFailed ? (
        <div className={css.error} role="alert">
          <span>{t('load.failed')}</span>
          <Button variant="ghost" size="sm" onClick={runDetect}>{t('load.retry')}</Button>
        </div>
      ) : statuses.length === 0 ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : (
        <ul className={css.list}>
          {statuses.map((tool) => {
            const state = runnerState(tool)
            return (
              <li key={tool.id} className={css.row}>
                <StateDot state={runnerDot(state)} />
                <span className={css.toolId}>{tool.id}</span>
                <span className={css.statusLabel}>{t(`status.${state}`)}</span>
                <span className={css.version}>{tool.version ?? '—'}</span>
                {state === 'missing' && tool.installDocUrl !== undefined
                  ? <a className={css.install} href={tool.installDocUrl} target="_blank" rel="noreferrer">{t('action.install')}</a>
                  : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Single-line detection progress: fraction + current work + view-session link. */
function ProgressRow(props: {
  running: boolean
  detected: number
  total: number
  current: string | undefined
  sessionId: string | undefined
  t: ToolInventorySectionProps['t']
  openSession: (sessionId: string) => void
}): ReactElement {
  const { running, detected, total, current, sessionId, t, openSession } = props
  const percent = total > 0 ? Math.round((detected / total) * 100) : 0
  const fillStyle: CSSProperties = { width: `${percent}%` }
  const statusText = running
    ? (current !== undefined ? t('progress.current', { command: current }) : t('detect.running'))
    : t('progress.done')
  return (
    <div className={css.progressRow}>
      <div className={css.progressFraction}>
        <span className={css.progressLabel}>{t('progress.label')}</span>
        <div
          className={css.progressBar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={detected}
        >
          <div className={css.progressFill} style={fillStyle} />
        </div>
        <span className={css.progressCount}>{`${detected}/${total}`}</span>
      </div>
      <span className={css.progressCurrent}>{statusText}</span>
      {sessionId !== undefined
        ? (
          <Button size="sm" variant="ghost" onClick={() => { openSession(sessionId) }}>
            {t('progress.viewSession')}
          </Button>
        )
        : null}
    </div>
  )
}
