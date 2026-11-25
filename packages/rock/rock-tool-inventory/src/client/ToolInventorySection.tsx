/** Rock tool inventory panel: detected runner states plus a single-line detection progress row. */
import { useEffect, useState, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DebugResult, DebugState, DetectState, ToolClientType, ToolConnectionConfig, ToolDescriptor, ToolServiceStatus, ToolStatus } from '@rock/rock-tool-inventory/types'
import css from './rock-tool-inventory.module.css'

/** Poll interval while a detection run is in flight. */
const DETECT_POLL_MS = 1000

/** Poll interval for the live service status (online/offline). */
const SERVICE_POLL_MS = 10_000

/** Host operations injected into the Cordis-free read-only component. */
export interface ToolInventorySectionInjected {
  remote: {
    listTools(): Promise<RemoteResult<ToolStatus[]>>
    toolDescriptors(): Promise<RemoteResult<ToolDescriptor[]>>
    detect(): Promise<RemoteResult<DetectState>>
    detectState(): Promise<RemoteResult<DetectState>>
    serviceStatuses(): Promise<RemoteResult<ToolServiceStatus[]>>
    debugTool(id: string): Promise<RemoteResult<DebugState>>
    debugState(): Promise<RemoteResult<DebugState>>
    connectionConfigs(): Promise<RemoteResult<Record<string, ToolConnectionConfig>>>
    setConnectionConfig(id: string, config: ToolConnectionConfig): Promise<RemoteResult<void>>
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

/** Format one ISO timestamp for the toolbar. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** Render the detected runner rows plus the single-line assistant-LLM detection progress. */
export function ToolInventorySection({ t, remote, openSession }: ToolInventorySectionProps): ReactElement {
  const [tools, setTools] = useState<ToolStatus[]>([])
  const [descriptors, setDescriptors] = useState<ToolDescriptor[]>([])
  const [connections, setConnections] = useState<Record<string, ToolConnectionConfig>>({})
  const [detect, setDetect] = useState<DetectState | null>(null)
  const [debug, setDebug] = useState<DebugState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [configUrl, setConfigUrl] = useState('')
  const [configToken, setConfigToken] = useState('')
  const [configClientType, setConfigClientType] = useState<ToolClientType | undefined>(undefined)
  const [configRootDir, setConfigRootDir] = useState('')
  const [configConfigRootDir, setConfigConfigRootDir] = useState('')
  const [configStartupCommand, setConfigStartupCommand] = useState('')
  const [serviceStatus, setServiceStatus] = useState<ToolServiceStatus[]>([])

  useEffect(() => {
    let cancelled = false
    void remote.listTools().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setTools(result.value)
      else setLoadFailed(true)
    })
    void remote.toolDescriptors().then((result) => {
      if (!cancelled && result.ok) setDescriptors(result.value)
    })
    void remote.connectionConfigs().then((result) => {
      if (!cancelled && result.ok) setConnections(result.value)
    })
    void remote.detectState().then((result) => {
      if (!cancelled && result.ok) setDetect(result.value)
    })
    void remote.debugState().then((result) => {
      if (!cancelled && result.ok) setDebug(result.value)
    })
    void remote.serviceStatuses().then((result) => {
      if (!cancelled && result.ok) setServiceStatus(result.value)
    })
    return () => { cancelled = true }
  }, [remote])

  useEffect(() => {
    const timer = setInterval(() => {
      void remote.serviceStatuses().then((result) => {
        if (result.ok) setServiceStatus(result.value)
      })
    }, SERVICE_POLL_MS)
    return () => { clearInterval(timer) }
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

  useEffect(() => {
    if (debug?.running !== true) return
    const timer = setInterval(() => {
      void remote.debugState().then((result) => {
        if (result.ok) setDebug(result.value)
      })
    }, DETECT_POLL_MS)
    return () => { clearInterval(timer) }
  }, [debug?.running, remote])

  const runDetect = (): void => {
    void remote.detect().then((result) => {
      if (result.ok) setDetect(result.value)
      else setLoadFailed(true)
    })
  }

  const runDebug = (id: string): void => {
    void remote.debugTool(id).then((result) => {
      if (result.ok) setDebug(result.value)
      else setLoadFailed(true)
    })
  }

  const descriptorById = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]))

  const openConfig = (id: string): void => {
    const existing = connections[id]
    setConfigUrl(existing?.url ?? '')
    setConfigToken(existing?.token ?? '')
    setConfigClientType(existing?.clientType)
    setConfigRootDir(existing?.rootDir ?? '')
    setConfigConfigRootDir(existing?.configRootDir ?? '')
    setConfigStartupCommand(existing?.startupCommand ?? '')
    setConfiguring(id)
  }

  const closeConfig = (): void => {
    setConfiguring(null)
    setConfigUrl('')
    setConfigToken('')
    setConfigClientType(undefined)
    setConfigRootDir('')
    setConfigConfigRootDir('')
    setConfigStartupCommand('')
  }

  const saveConfig = (): void => {
    if (configuring === null) return
    const next: ToolConnectionConfig = {
      ...(configUrl.length > 0 ? { url: configUrl } : {}),
      ...(configToken.length > 0 ? { token: configToken } : {}),
      ...(configClientType === undefined ? {} : { clientType: configClientType }),
      ...(configRootDir.length > 0 ? { rootDir: configRootDir } : {}),
      ...(configConfigRootDir.length > 0 ? { configRootDir: configConfigRootDir } : {}),
      ...(configStartupCommand.length > 0 ? { startupCommand: configStartupCommand } : {}),
    }
    void remote.setConnectionConfig(configuring, next).then((result) => {
      if (result.ok) {
        setConnections(prev => ({ ...prev, [configuring]: next }))
        closeConfig()
      } else {
        setLoadFailed(true)
      }
    })
  }

  const serviceById = new Map(serviceStatus.map(status => [status.id, status]))
  const statuses = (detect !== null && detect.statuses.length > 0 ? detect.statuses : tools)
    .map((tool) => {
      const live = serviceById.get(tool.id)
      return live === undefined ? tool : { ...tool, running: live.running, lastCheckedAt: live.lastCheckedAt }
    })
  const running = detect?.running === true
  const debugging = debug?.running === true
  const busy = running || debugging
  const progress = detect?.progress
  const sessionId = detect?.sessionId
  const lastDetectedAt = detect?.lastDetectedAt
  const debugSessionId = debug?.sessionId
  const debugResult = debug?.result

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        {lastDetectedAt !== undefined
          ? <span className={css.lastRun}>{t('detect.lastRun', { time: formatTime(lastDetectedAt) })}</span>
          : null}
        <Button variant="primary" size="sm" disabled={busy} onClick={runDetect}>
          {running ? t('detect.running') : t('detect.action')}
        </Button>
      </div>

      {detect !== null && progress !== undefined && (running || sessionId !== undefined) ? (
        <ProgressRow
          running={running}
          current={progress.current}
          sessionId={sessionId}
          t={t}
          openSession={openSession}
        />
      ) : null}

      {debug !== null && debugging ? (
        <ProgressRow
          running
          current={debug.progress.current}
          sessionId={debugSessionId}
          t={t}
          openSession={openSession}
        />
      ) : null}

      {debugResult !== undefined && !debugging ? (
        <DebugResultRow result={debugResult} sessionId={debugSessionId} t={t} openSession={openSession} />
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
            const descriptor = descriptorById.get(tool.id)
            return (
              <li key={tool.id} className={css.row}>
                <StateDot state={runnerDot(state)} />
                <span className={css.toolId}>{tool.id}</span>
                <span className={css.statusLabel}>{t(`status.${state}`)}</span>
                {tool.lastCheckedAt !== undefined
                  ? <span className={css.checkedAt}>{t('status.checkedAt', { time: formatTime(tool.lastCheckedAt) })}</span>
                  : null}
                <span className={css.version}>{tool.version ?? '—'}</span>
                {state === 'missing' && tool.installDocUrl !== undefined
                  ? <a className={css.install} href={tool.installDocUrl} target="_blank" rel="noreferrer">{t('action.install')}</a>
                  : (
                    <span className={css.actions}>
                      {descriptor?.configurable === true
                        ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { openConfig(tool.id) }}>
                            {t('config.action')}
                          </Button>
                        )
                        : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => { runDebug(tool.id) }}
                      >
                        {debug?.toolId === tool.id && debugging ? t('debug.running') : t('debug.action')}
                      </Button>
                    </span>
                  )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfigModal
        toolId={configuring}
        requiresToken={configuring !== null && descriptorById.get(configuring)?.requiresToken === true}
        url={configUrl}
        token={configToken}
        clientType={configClientType}
        rootDir={configRootDir}
        configRootDir={configConfigRootDir}
        startupCommand={configStartupCommand}
        onUrl={setConfigUrl}
        onToken={setConfigToken}
        onClientType={setConfigClientType}
        onRootDir={setConfigRootDir}
        onConfigRootDir={setConfigConfigRootDir}
        onStartupCommand={setConfigStartupCommand}
        onClose={closeConfig}
        onSave={saveConfig}
        t={t}
      />
    </div>
  )
}

/** Single-line detection progress: current work + view-session link. */
function ProgressRow(props: {
  running: boolean
  current: string | undefined
  sessionId: string | undefined
  t: ToolInventorySectionProps['t']
  openSession: (sessionId: string) => void
}): ReactElement {
  const { running, current, sessionId, t, openSession } = props
  const statusText = running
    ? (current !== undefined ? t('progress.current', { command: current }) : t('detect.running'))
    : t('progress.done')
  return (
    <div className={css.progressRow}>
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

/** One completed debug run: pass/fail tag + summary + view-session link. */
function DebugResultRow(props: {
  result: DebugResult
  sessionId: string | undefined
  t: ToolInventorySectionProps['t']
  openSession: (sessionId: string) => void
}): ReactElement {
  const { result, sessionId, t, openSession } = props
  const detail = result.ok ? result.summary : (result.summary ?? result.diagnostic)
  return (
    <div className={css.debugResult}>
      <Tag tone={result.ok ? 'success' : 'danger'}>
        {result.ok ? t('debug.pass') : t('debug.fail')}
      </Tag>
      <span className={css.debugToolId}>{result.id}</span>
      {detail !== undefined
        ? <span className={css.debugDetail}>{detail}</span>
        : null}
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

/** Connection configuration dialog: url + token + clientType + rootDir + configRootDir + startupCommand. */
function ConfigModal(props: {
  toolId: string | null
  requiresToken: boolean
  url: string
  token: string
  clientType: ToolClientType | undefined
  rootDir: string
  configRootDir: string
  startupCommand: string
  onUrl: (value: string) => void
  onToken: (value: string) => void
  onClientType: (value: ToolClientType | undefined) => void
  onRootDir: (value: string) => void
  onConfigRootDir: (value: string) => void
  onStartupCommand: (value: string) => void
  onClose: () => void
  onSave: () => void
  t: ToolInventorySectionProps['t']
}): ReactElement {
  const {
    toolId, requiresToken, url, token, clientType, rootDir, configRootDir, startupCommand,
    onUrl, onToken, onClientType, onRootDir, onConfigRootDir, onStartupCommand,
    onClose, onSave, t,
  } = props
  const missingToken = requiresToken && token.trim().length === 0
  return (
    <Modal
      open={toolId !== null}
      onClose={onClose}
      title={t('config.title', { tool: toolId ?? '' })}
      closeLabel={t('config.cancel')}
      footer={(
        <span className={css.modalFooter}>
          <Button size="sm" variant="ghost" onClick={onClose}>{t('config.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={missingToken} onClick={onSave}>{t('config.save')}</Button>
        </span>
      )}
    >
      <div className={css.configForm}>
        <label className={css.configField}>
          <span className={css.configLabel}>{t('config.url')}</span>
          <Input value={url} onChange={(event) => { onUrl(event.target.value) }} placeholder={t('config.urlPlaceholder')} />
        </label>
        <label className={css.configField}>
          <span className={css.configLabel}>{t('config.token')}{requiresToken ? ' *' : ''}</span>
          <Input type="password" value={token} onChange={(event) => { onToken(event.target.value) }} placeholder={t('config.tokenPlaceholder')} />
        </label>
        <div className={css.configField}>
          <span className={css.configLabel}>{t('config.clientType')}</span>
          <div className={css.clientTypeOptions}>
            <Button size="sm" variant={clientType === 'gui' ? 'primary' : 'ghost'} onClick={() => { onClientType(clientType === 'gui' ? undefined : 'gui') }}>
              {t('config.clientType.gui')}
            </Button>
            <Button size="sm" variant={clientType === 'tui' ? 'primary' : 'ghost'} onClick={() => { onClientType(clientType === 'tui' ? undefined : 'tui') }}>
              {t('config.clientType.tui')}
            </Button>
          </div>
        </div>
        <label className={css.configField}>
          <span className={css.configLabel}>{t('config.rootDir')}</span>
          <Input value={rootDir} onChange={(event) => { onRootDir(event.target.value) }} placeholder={t('config.rootDirPlaceholder')} />
        </label>
        <label className={css.configField}>
          <span className={css.configLabel}>{t('config.configRootDir')}</span>
          <Input value={configRootDir} onChange={(event) => { onConfigRootDir(event.target.value) }} placeholder={t('config.configRootDirPlaceholder')} />
        </label>
        <label className={css.configField}>
          <span className={css.configLabel}>{t('config.startupCommand')}</span>
          <Input value={startupCommand} onChange={(event) => { onStartupCommand(event.target.value) }} placeholder={t('config.startupCommandPlaceholder')} />
        </label>
        {missingToken
          ? <span className={css.configError}>{t('config.tokenRequired')}</span>
          : null}
      </div>
    </Modal>
  )
}
