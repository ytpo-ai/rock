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
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { assistantMessageText, commandOf, detectPrompt, mergeStatuses, parseDetectStatuses, touchedToolIds } from './detect.ts'
import { toolStatusFrom } from './probe.ts'
import type { DetectState, ToolDescriptor, ToolStatus } from './types.ts'

export type * from './types.ts'

const execFileAsync = promisify(execFile)

/** The dedicated assistant preset id (D-035) and its cloud route. */
const ASSISTANT_PRESET = 'assistant'
const ASSISTANT_PROVIDER = 'seagull-cloud'
const ASSISTANT_MODEL = 'seagull-relay'

/** Probe targets the workbench ships by default. */
const DEFAULT_TOOLS: readonly ToolDescriptor[] = [
  { id: 'codex', command: 'codex', installDocUrl: 'https://developers.openai.com/codex/cli' },
  { id: 'pi', command: 'pi', installDocUrl: 'https://github.com/badlogic/pi-mono' },
  { id: 'opencode', command: 'opencode' },
  { id: 'dsh', command: 'dsh' },
  { id: 'claude-code', command: 'claude' },
]

/** Deployment-owned probe targets; patchable from cordis.yml. */
export interface Config {
  /** Tool descriptors to probe; defaults to the shipped targets. */
  tools?: ToolDescriptor[]
}

/** Remote service carrying the tool inventory and the assistant detection run. */
export default class RockToolInventoryController extends TypertRemoteService {
  static inject = []
  static Config: z<Config> = z.object({
    tools: z.array(z.object({
      id: z.string().min(1),
      command: z.string().min(1),
      installDocUrl: z.string().default(''),
    })).default([...DEFAULT_TOOLS]),
  })

  private readonly tools: readonly ToolDescriptor[]
  private state: DetectState
  private detectSessionId: SessionId | undefined
  private assistantText = ''
  private touched = new Set<string>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockToolInventory')
    this.tools = config.tools ?? DEFAULT_TOOLS
    this.state = { running: false, statuses: [], progress: { total: this.tools.length, detected: 0, steps: 0 } }
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.recordDetectEvent(session, event)
    })
  }

  /** Detected state of every probe target, in declaration order (fast `--version` probe). */
  @Remote
  async listTools(): Promise<ToolStatus[]> {
    return Promise.all(this.tools.map(tool => probeTool(tool)))
  }

  /** Latest detection run state (statuses + progress; the process renders in the assistant session). */
  @Remote
  detectState(): DetectState {
    return this.state
  }

  /**
   * Start one full detection run through the dedicated assistant LLM. Returns
   * immediately with `running: true`; statuses and progress stream in via {@link detectState}.
   */
  @Remote
  async detect(): Promise<DetectState> {
    if (this.state.running) return this.state
    const fast = await Promise.all(this.tools.map(tool => probeTool(tool)))
    this.state = { running: true, statuses: fast, progress: { total: this.tools.length, detected: 0, steps: 0 } }
    this.detectSessionId = undefined
    this.assistantText = ''
    this.touched = new Set()
    try {
      const sessionId = await this.launchAssistant()
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

  /** Launch the dedicated assistant session in the default workspace and submit the probe prompt. */
  private async launchAssistant(): Promise<SessionId> {
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
      content: [{ type: 'text', text: detectPrompt(this.tools) }],
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

  /** Track progress for the in-flight detection session and finalize on turn end. */
  private recordDetectEvent(session: Session, event: SessionEvent): void {
    if (this.detectSessionId === undefined || session.id !== this.detectSessionId) return
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

  /** Parse the assistant's JSON answer, merge over the fast probe, and settle the run. */
  private finalizeDetect(): void {
    const assistant = parseDetectStatuses(this.assistantText, this.tools)
    this.state = {
      running: false,
      ...(this.state.sessionId === undefined ? {} : { sessionId: this.state.sessionId }),
      statuses: mergeStatuses(this.state.statuses, assistant),
      progress: this.state.progress,
    }
    this.detectSessionId = undefined
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only tool inventory Remote. */
    rockToolInventory: RockToolInventoryController
  }
}
