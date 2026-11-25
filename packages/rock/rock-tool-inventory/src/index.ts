/**
 * Rock tool inventory plugin: probes the machine for installed agent tools and
 * exposes the result as a read-only Remote service (`ctx.rockToolInventory`).
 * The fast `--version` probe fills the first-paint snapshot; a manual
 * `detect()` runs the dedicated assistant LLM (`assistant` preset) to detect
 * install AND running state. The full process renders in the assistant session
 * (DSH conversation); this Remote exposes only the statuses and a compact
 * progress line through `detectState()`.
 *
 * ```yaml
 * - id: rock-tool-inventory
 *   name: '@rock/rock-tool-inventory'
 *   config:
 *     tools:
 *       - { id: codex, command: codex }
 *       - { id: pi, command: pi }
 * ```
 *
 * @module @rock/rock-tool-inventory
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { watch as chokidarWatch } from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { assistantMessageText, commandOf, debugPrompt, detectPrompt, mergeStatuses, parseDebugResult, parseDetectConnectionPatches, parseDetectStatuses, touchedToolIds } from './detect.ts'
import { backfillConnectionPatch, normalizeConnection, normalizeConnectionConfig } from './connection.ts'
import { toolStatusFrom } from './probe.ts'
import { postToolStatus } from './report.ts'
import { ServiceStatusPoller } from './service-status.ts'
import type { DebugState, DetectState, ToolConnectionConfig, ToolConnectionPatch, ToolDescriptor, ToolServiceStatus, ToolStatus } from './types.ts'

export type * from './types.ts'

const execFileAsync = promisify(execFile)

/** The dedicated assistant preset id (D-035) and its cloud route. */
const ASSISTANT_PRESET = 'assistant'
const ASSISTANT_PROVIDER = 'seagull-cloud'
const ASSISTANT_MODEL = 'seagull-relay'

/** Default interval between service-status probe rounds. */
const DEFAULT_POLL_INTERVAL_MS = 10_000

/** Default per-probe timeout for one service liveness probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 2_000

/** Probe targets the workbench ships by default. */
const DEFAULT_TOOLS: readonly ToolDescriptor[] = [
  {
    id: 'codex',
    command: 'codex',
    installDocUrl: 'https://developers.openai.com/codex/cli',
    serviceHint: '通过 codex app-server daemon 的控制 unix socket 委派（默认 ~/.codex/app-server-control/app-server-control.sock，JSON-RPC）。',
    configurable: true,
  },
  { id: 'pi', command: 'pi', installDocUrl: 'https://github.com/badlogic/pi-mono', configurable: true },
  {
    id: 'opencode',
    command: 'opencode',
    serviceHint: '通过 opencode v2 本地常驻 server 的 HTTP REST 委派（发现文件 ~/.local/state/opencode/service.json 提供 url+password，Basic 鉴权）。',
    configurable: true,
  },
  {
    id: 'dsh',
    command: 'dsh',
    serviceHint: '通过已运行的 dsh web Host 的 HTTP Remote API 委派（token→cookie→session/create→session/prompt→session/wait；Host 地址来自 ROCK_DSH_REMOTE_URL，token 来自 ROCK_DSH_REMOTE_TOKEN，默认 http://127.0.0.1:3080）。',
    configurable: true,
    requiresToken: true,
  },
  { id: 'claude-code', command: 'claude', configurable: true },
]

/** JSON file persisting the last detection result across restarts. */
const DEFAULT_STATE_PATH = '../.rock/tool-inventory.json'

/** JSON file persisting the user-supplied service connections (url + token). */
const DEFAULT_CONNECTIONS_PATH = '../.rock/tool-connections.json'

/** Deployment-owned probe targets; patchable from cordis.yml. */
export interface Config {
  /** Tool descriptors to probe; defaults to the shipped targets. */
  tools?: ToolDescriptor[]
  /** JSON file persisting the last detection result; defaults to the Rock home. */
  statePath?: string
  /** JSON file persisting the service connections; defaults to the Rock home. */
  connectionsPath?: string
  /** Interval between service-status probe rounds in milliseconds. */
  pollIntervalMs?: number
  /** Per-probe timeout for one service liveness probe in milliseconds. */
  serviceProbeTimeoutMs?: number
  /** Whether to report service-status changes to the Seagull gateway. */
  reportToolStatus?: boolean
}

/** Remote service carrying the tool inventory and the assistant detection run. */
export default class RockToolInventoryController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    tools: z.array(z.object({
      id: z.string().min(1),
      command: z.string().min(1),
      installDocUrl: z.string().default(''),
      serviceHint: z.string().default(''),
      configurable: z.boolean().default(false),
      requiresToken: z.boolean().default(false),
    })).default([...DEFAULT_TOOLS]),
    statePath: z.string().min(1).default(DEFAULT_STATE_PATH),
    connectionsPath: z.string().min(1).default(DEFAULT_CONNECTIONS_PATH),
    pollIntervalMs: z.number().step(1).min(1000).default(DEFAULT_POLL_INTERVAL_MS),
    serviceProbeTimeoutMs: z.number().step(1).min(100).default(DEFAULT_PROBE_TIMEOUT_MS),
    reportToolStatus: z.boolean().default(true),
  })

  private readonly tools: readonly ToolDescriptor[]
  private readonly statePath: string
  private readonly connectionsPath: string
  private readonly reportToolStatus: boolean
  private readonly poller: ServiceStatusPoller
  private readonly serviceStatus = new Map<string, ToolServiceStatus>()
  private connections: Record<string, ToolConnectionConfig>
  private state: DetectState
  private debug: DebugState
  private detectSessionId: SessionId | undefined
  private debugSessionId: SessionId | undefined
  private debugToolId: string | undefined
  private assistantText = ''
  private debugAssistantText = ''
  private touched = new Set<string>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockToolInventory')
    this.tools = config.tools ?? DEFAULT_TOOLS
    this.statePath = config.statePath ?? DEFAULT_STATE_PATH
    this.connectionsPath = config.connectionsPath ?? DEFAULT_CONNECTIONS_PATH
    this.connections = this.loadConnections()
    const persisted = this.loadPersisted()
    this.state = {
      running: false,
      ...(persisted.lastDetectedAt === undefined ? {} : { lastDetectedAt: persisted.lastDetectedAt }),
      statuses: persisted.statuses,
      progress: { total: this.tools.length, detected: 0, steps: 0 },
    }
    this.debug = { running: false, progress: { total: 1, detected: 0, steps: 0 } }
    this.reportToolStatus = config.reportToolStatus ?? true
    this.poller = new ServiceStatusPoller({
      intervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: config.serviceProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      tools: this.tools,
      connections: () => this.connections,
      onResult: (statuses) => { this.handleServiceStatus(statuses) },
    })
    this.poller.start()
    ctx.effect(() => () => { this.poller.stop() }, 'rock-tool-inventory: service status poller')
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.recordDetectEvent(session, event)
    })
    ctx.effect(() => {
      const watcher = chokidarWatch(this.connectionsPath, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      })
      watcher.on('all', () => { this.reloadConnections() })
      watcher.on('ready', () => { this.reloadConnections() })
      watcher.on('error', (error) => {
        this.ctx.logger.warn(`rock-tool-inventory: connection watcher error: ${messageOf(error)}`)
      })
      return () => { void watcher.close() }
    }, 'rock-tool-inventory: connection watcher')
  }

  /** Detected state of every probe target, in declaration order (fast `--version` probe + live service status). */
  @Remote
  async listTools(): Promise<ToolStatus[]> {
    const fast = await Promise.all(this.tools.map(tool => probeTool(tool)))
    return this.withServiceStatus(fast)
  }

  /** The probe-target descriptors (static config: service hint, configurability), in declaration order. */
  @Remote
  toolDescriptors(): ToolDescriptor[] {
    return [...this.tools]
  }

  /** Latest detection run state (statuses + progress; the process renders in the assistant session). */
  @Remote
  detectState(): DetectState {
    return { ...this.state, statuses: this.withServiceStatus(this.state.statuses) }
  }

  /** The freshest transport-level service-status rows, in declaration order. */
  @Remote
  serviceStatuses(): ToolServiceStatus[] {
    return this.serviceStatusSnapshot()
  }

  /** Latest per-tool debug run state (result + progress; the process renders in the assistant session). */
  @Remote
  debugState(): DebugState {
    return this.debug
  }

  /** The persisted service connections, keyed by tool id (url + token). */
  @Remote
  connectionConfigs(): Record<string, ToolConnectionConfig> {
    return { ...this.connections }
  }

  /**
   * Persist one tool's service connection. Empty url/token fields clear the
   * corresponding override so the assistant (or provider discovery) fills them.
   * @param id - the tool type id.
   * @param config - the url/token to persist.
   */
  @Remote
  setConnectionConfig(id: string, config: ToolConnectionConfig): void {
    const tool = this.tools.find(candidate => candidate.id === id)
    if (tool === undefined) throw new Error(`unknown tool "${id}"`)
    const normalized = normalizeConnectionConfig(config)
    if (tool.requiresToken === true && normalized.token === undefined) {
      throw new Error(`tool "${id}" requires a token`)
    }
    this.connections = { ...this.connections, [id]: normalized }
    this.persistConnections()
  }

  /** The service connection for one tool, or undefined when none is persisted. */
  connectionConfig(id: string): ToolConnectionConfig | undefined {
    return this.connections[id]
  }

  /**
   * Start one full detection run through the dedicated assistant LLM. Returns
   * immediately with `running: true`; statuses and progress stream in via {@link detectState}.
   */
  @Remote
  async detect(): Promise<DetectState> {
    if (this.state.running || this.debug.running) return this.state
    const fast = await Promise.all(this.tools.map(tool => probeTool(tool)))
    this.state = { running: true, statuses: fast, progress: { total: this.tools.length, detected: 0, steps: 0 } }
    this.detectSessionId = undefined
    this.assistantText = ''
    this.touched = new Set()
    try {
      const sessionId = await this.launchAssistant(detectPrompt(this.tools))
      this.detectSessionId = sessionId
      this.state = { ...this.state, sessionId: String(sessionId) }
    } catch (error) {
      this.state = {
        running: false,
        statuses: fast,
        progress: { total: this.tools.length, detected: 0, steps: 0 },
        error: messageOf(error),
      }
    }
    return this.state
  }

  /**
   * Start one per-tool debug run through the dedicated assistant LLM: smoke-test
   * the tool's invocation, diagnose, attempt a fix, and re-test. Returns
   * immediately with `running: true`; the result and progress stream in via
   * {@link debugState}.
   * @param id - the tool type id to debug.
   */
  @Remote
  async debugTool(id: string): Promise<DebugState> {
    if (this.debug.running || this.state.running) return this.debug
    const tool = this.tools.find(candidate => candidate.id === id)
    if (tool === undefined) {
      this.debug = { running: false, progress: { total: 1, detected: 0, steps: 0 }, error: `unknown tool "${id}"` }
      return this.debug
    }
    if (tool.requiresToken === true && this.connections[id]?.token === undefined) {
      this.debug = { running: false, toolId: id, progress: { total: 1, detected: 0, steps: 0 }, error: `tool "${id}" requires a token; configure it first` }
      return this.debug
    }
    this.debug = { running: true, toolId: id, progress: { total: 1, detected: 0, steps: 0 } }
    this.debugSessionId = undefined
    this.debugToolId = id
    this.debugAssistantText = ''
    try {
      const sessionId = await this.launchAssistant(debugPrompt(tool, this.connections[id]))
      this.debugSessionId = sessionId
      this.debug = { ...this.debug, sessionId: String(sessionId) }
    } catch (error) {
      this.debug = {
        running: false,
        toolId: id,
        progress: { total: 1, detected: 0, steps: 0 },
        error: messageOf(error),
      }
    }
    return this.debug
  }

  /** Launch the dedicated assistant session in the default workspace and submit a probe/debug prompt. */
  private async launchAssistant(prompt: string): Promise<SessionId> {
    const agentPresets = this.ctx.get('agentPresets') as {
      resolve(id: string): Promise<{ id: string }>
      acquireScope(id: string): Promise<{ key: unknown } & AsyncDisposable>
      mount(ctx: Context, id: string): Promise<unknown>
    } | undefined
    const agents = this.ctx.get('agents') as {
      create(options: {
        sessionId: SessionId
        meta?: { agentPreset?: string; cwd?: string }
        agentOptions?: AgentOptions
        setup?: (agentCtx: Context) => Promise<void>
      }): Promise<{ agent: { followup(message: unknown): void } }>
    } | undefined

    if (agentPresets === undefined) throw new Error('agentPresets service unavailable')
    if (agents === undefined) throw new Error('agents service unavailable')

    const preset = await agentPresets.resolve(ASSISTANT_PRESET)
    await using scope = await agentPresets.acquireScope(preset.id)
    void scope

    const workspace = await this.resolveWorkspace()
    const assistant = this.assistantIdentity()
    const sessionId = brandString<SessionId>(`runner-detect-${randomUUID()}`)
    const agentOptions: AgentOptions = {
      provider: ASSISTANT_PROVIDER,
      model: ASSISTANT_MODEL,
      ...(assistant === undefined ? {} : { agentId: assistant.agentBotId }),
    }
    const handle = await agents.create({
      sessionId,
      meta: {
        agentPreset: preset.id,
        ...(workspace === undefined ? {} : { cwd: workspace.path }),
      },
      agentOptions,
      setup: async (agentCtx) => {
        await agentPresets.mount(agentCtx, preset.id)
      },
    })
    if (workspace !== undefined) {
      await workspace.attachSession(sessionId).catch((error: unknown) => {
        this.ctx.logger.warn(`rock-tool-inventory: attach session ${String(sessionId)} to workspace failed: ${messageOf(error)}`)
      })
    }
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    return sessionId
  }

  /** Resolve the default workspace so the session groups there; fall back to the Rock root. */
  private async resolveWorkspace(): Promise<{ path: string; attachSession(id: SessionId): Promise<void> } | undefined> {
    const registry = this.ctx.get('workspaceRegistry') as {
      initializeDefault(resolveDirectory: () => Promise<string>):
      Promise<{ path: string; attachSession(id: SessionId): Promise<void> } | undefined>
      create(path: string): Promise<{ path: string; attachSession(id: SessionId): Promise<void> }>
    } | undefined
    if (registry === undefined) return undefined
    const fallback = this.rockRoot()
    try {
      const workspace = await registry.initializeDefault(() => Promise.resolve(fallback))
      if (workspace !== undefined) return workspace
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: resolve default workspace failed: ${messageOf(error)}`)
    }
    try {
      return await registry.create(fallback)
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: create workspace at "${fallback}" failed: ${messageOf(error)}`)
      return undefined
    }
  }

  /** The Rock workspace root as a fallback cwd; the process cwd when uninitialized. */
  private rockRoot(): string {
    const rock = this.ctx.get('rockWorkspace') as { rootPath(): string | null } | undefined
    return rock?.rootPath() ?? process.cwd()
  }

  /** Dispatch a session event to the in-flight detection or debug run it belongs to. */
  private recordDetectEvent(session: Session, event: SessionEvent): void {
    if (session.id === this.detectSessionId) {
      this.recordDetectEventForDetect(event)
    } else if (session.id === this.debugSessionId) {
      this.recordDetectEventForDebug(event)
    }
  }

  /** Track progress for the in-flight detection session and finalize on turn end. */
  private recordDetectEventForDetect(event: SessionEvent): void {
    if (event.type === 'assistant/message') {
      this.assistantText += assistantMessageText(event.data.message)
    } else if (event.type === 'tool/call') {
      const command = commandOf(event.data.arguments)
      if (command !== undefined) {
        for (const id of touchedToolIds(command, this.tools)) this.touched.add(id)
      }
      this.state.progress = {
        total: this.tools.length,
        detected: this.touched.size,
        ...(command === undefined ? {} : { current: command }),
        steps: this.state.progress.steps + 1,
      }
    } else if (event.type === 'turn/end') {
      this.finalizeDetect()
    }
  }

  /** Track progress for the in-flight debug session and finalize on turn end. */
  private recordDetectEventForDebug(event: SessionEvent): void {
    if (event.type === 'assistant/message') {
      this.debugAssistantText += assistantMessageText(event.data.message)
    } else if (event.type === 'tool/call') {
      const command = commandOf(event.data.arguments)
      this.debug.progress = {
        total: 1,
        detected: command === undefined ? 0 : 1,
        ...(command === undefined ? {} : { current: command }),
        steps: this.debug.progress.steps + 1,
      }
    } else if (event.type === 'turn/end') {
      this.finalizeDebug()
    }
  }

  /** Parse the assistant's JSON answer, merge over the fast probe, settle the run, and persist. */
  private finalizeDetect(): void {
    const assistant = parseDetectStatuses(this.assistantText, this.tools)
    const statuses = mergeStatuses(this.state.statuses, assistant)
    const lastDetectedAt = new Date().toISOString()
    this.state = {
      running: false,
      ...(this.state.sessionId === undefined ? {} : { sessionId: this.state.sessionId }),
      lastDetectedAt,
      statuses,
      progress: this.state.progress,
    }
    this.detectSessionId = undefined
    this.persistState(statuses, lastDetectedAt)
    const patches = parseDetectConnectionPatches(this.assistantText, this.tools)
    if (this.backfillConnections(patches)) {
      this.persistConnections()
    }
    try {
      this.ctx.emit('rock-tool-inventory/detected')
    } catch (error) {
      // Emit dispatches listeners inline; a throwing consumer must not undo the persisted result.
      this.ctx.logger.warn(`rock-tool-inventory: detected listener failed: ${messageOf(error)}`)
    }
  }

  /** Parse the assistant's debug JSON answer, settle the run, and keep the result for the panel. */
  private finalizeDebug(): void {
    const toolId = this.debugToolId
    const tool = toolId === undefined ? undefined : this.tools.find(candidate => candidate.id === toolId)
    const result = tool === undefined
      ? { id: toolId ?? '', ok: false, finishedAt: new Date().toISOString(), diagnostic: 'unknown tool' }
      : parseDebugResult(this.debugAssistantText, tool)
    this.debug = {
      running: false,
      ...(this.debug.sessionId === undefined ? {} : { sessionId: this.debug.sessionId }),
      ...(toolId === undefined ? {} : { toolId }),
      result,
      progress: this.debug.progress,
    }
    this.debugSessionId = undefined
    this.debugToolId = undefined
    this.debugAssistantText = ''
  }

  /** Overlay the freshest service status onto base status rows (running + lastCheckedAt). */
  private withServiceStatus(statuses: readonly ToolStatus[]): ToolStatus[] {
    return statuses.map((status) => {
      const live = this.serviceStatus.get(status.id)
      if (live === undefined) return status
      return { ...status, running: live.running, lastCheckedAt: live.lastCheckedAt }
    })
  }

  /** The freshest service-status rows, in declaration order. */
  private serviceStatusSnapshot(): ToolServiceStatus[] {
    const out: ToolServiceStatus[] = []
    for (const tool of this.tools) {
      const status = this.serviceStatus.get(tool.id)
      if (status !== undefined) out.push(status)
    }
    return out
  }

  /** Handle one probe round: update the live map, emit, persist and report on change. */
  private handleServiceStatus(statuses: readonly ToolServiceStatus[]): void {
    let changed = false
    for (const status of statuses) {
      const previous = this.serviceStatus.get(status.id)
      if (previous === undefined || previous.running !== status.running) changed = true
      this.serviceStatus.set(status.id, status)
    }
    try {
      this.ctx.emit('rock-tool-inventory/service-status', statuses)
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: service-status listener failed: ${messageOf(error)}`)
    }
    if (!changed) return
    const merged = this.withServiceStatus(this.state.statuses)
    if (merged.length > 0) this.persistState(merged, this.state.lastDetectedAt)
    this.reportServiceStatus()
  }

  /** Report the freshest service status to the Seagull gateway (best-effort, key-gated). */
  private reportServiceStatus(): void {
    if (!this.reportToolStatus) return
    const onboarding = this.ctx.get('rockOnboarding') as { getRecord(): { baseUrl: string; key: string } | null } | undefined
    const record = onboarding?.getRecord()
    if (record === null || record === undefined) return
    const url = `${record.baseUrl.replace(/\/+$/, '')}/v1/connectors/tool-status`
    void postToolStatus(url, record.key, this.serviceStatusSnapshot()).catch(() => {
      // Best-effort: a failed report retries on the next status change.
    })
  }

  /** Read the last persisted detection result, or an empty state on absence/failure. */
  private loadPersisted(): { lastDetectedAt?: string; statuses: ToolStatus[] } {
    let raw: string
    try {
      raw = readFileSync(this.statePath, 'utf8')
    } catch {
      return { statuses: [] }
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return { statuses: [] }
      const record = parsed as { lastDetectedAt?: unknown; statuses?: unknown }
      const statuses = Array.isArray(record.statuses) ? record.statuses.filter(isToolStatus) : []
      const lastDetectedAt = typeof record.lastDetectedAt === 'string' ? record.lastDetectedAt : undefined
      return { ...(lastDetectedAt === undefined ? {} : { lastDetectedAt }), statuses }
    } catch {
      return { statuses: [] }
    }
  }

  /** Persist the latest detection result and timestamp so a restart keeps them. */
  private persistState(statuses: readonly ToolStatus[], lastDetectedAt?: string): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true })
      const payload = { ...(lastDetectedAt === undefined ? {} : { lastDetectedAt }), statuses }
      writeFileSync(this.statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: persist detection result failed: ${messageOf(error)}`)
    }
  }

  /** Read the persisted service connections, or an empty map on absence/failure (constructor path). */
  private loadConnections(): Record<string, ToolConnectionConfig> {
    return this.readConnectionsFile() ?? {}
  }

  /**
   * Read and parse the connections file. Returns undefined on any read or parse
   * failure so a hot-reload keeps the previous in-memory value instead of
   * clearing it on a half-written or missing file.
   */
  private readConnectionsFile(): Record<string, ToolConnectionConfig> | undefined {
    let raw: string
    try {
      raw = readFileSync(this.connectionsPath, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const out: Record<string, ToolConnectionConfig> = {}
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        const config = normalizeConnection(value)
        if (config !== undefined) out[id] = config
      }
      return out
    } catch {
      return undefined
    }
  }

  /** Reload the connections from disk after a file change; keep the current value on any failure. */
  private reloadConnections(): void {
    const next = this.readConnectionsFile()
    if (next !== undefined) this.connections = next
  }

  /**
   * Backfill detected connection fields into the persisted config, only where
   * the existing value is empty (never overwrite a user-supplied value).
   * @param patches - detection-derived patches.
   * @returns whether any connection changed, so the caller can persist once.
   */
  private backfillConnections(patches: readonly ToolConnectionPatch[]): boolean {
    let changed = false
    for (const patch of patches) {
      const merged = backfillConnectionPatch(this.connections[patch.id], patch)
      if (merged !== undefined) {
        this.connections = { ...this.connections, [patch.id]: merged }
        changed = true
      }
    }
    return changed
  }

  /** Persist the service connections so a restart keeps them. */
  private persistConnections(): void {
    try {
      mkdirSync(dirname(this.connectionsPath), { recursive: true })
      writeFileSync(this.connectionsPath, `${JSON.stringify(this.connections, null, 2)}\n`, 'utf8')
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: persist connections failed: ${messageOf(error)}`)
    }
  }

  /** The employee's dedicated assistant agent id, or undefined before sync. */
  private assistantIdentity(): { agentBotId: string } | undefined {
    const identity = this.ctx.get('seagullIdentity') as { getAssistants(): readonly { agentBotId: string }[] } | undefined
    return identity?.getAssistants()[0]
  }
}

/** Probe one tool with a bounded `--version` run. */
async function probeTool(tool: ToolDescriptor): Promise<ToolStatus> {
  const installDocUrl = tool.installDocUrl === undefined || tool.installDocUrl === '' ? undefined : tool.installDocUrl
  try {
    const { stdout } = await execFileAsync(tool.command, ['--version'], { timeout: 5000 })
    return {
      ...toolStatusFrom(tool.id, stdout, undefined),
      ...installDocUrl === undefined ? {} : { installDocUrl },
      lastCheckedAt: new Date().toISOString(),
      detectedBy: 'probe',
    }
  } catch (error) {
    return {
      ...toolStatusFrom(tool.id, undefined, error),
      ...installDocUrl === undefined ? {} : { installDocUrl },
      lastCheckedAt: new Date().toISOString(),
      detectedBy: 'probe',
    }
  }
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** Whether an unknown value is a well-formed ToolStatus. */
function isToolStatus(value: unknown): value is ToolStatus {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.installed === 'boolean'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only tool inventory Remote. */
    rockToolInventory: RockToolInventoryController
  }
}
