/**
 * Rock tool inventory plugin: probes the machine for installed agent tools and
 * exposes the result as a read-only Remote service (`ctx.rockToolInventory`).
 * The fast `--version` probe fills the first-paint snapshot; a manual
 * `detect()` runs the dedicated assistant LLM (`assistant` preset) to detect
 * install AND running state, streaming its transcript back through
 * `detectState()`.
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
import { detectPrompt, detectRecordFrom, mergeStatuses, parseDetectStatuses } from './detect.ts'
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
  private state: DetectState = { running: false, statuses: [], records: [] }
  private detectSessionId: SessionId | undefined
  private assistantText = ''

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockToolInventory')
    this.tools = config.tools ?? DEFAULT_TOOLS
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.recordDetectEvent(session, event)
    })
  }

  /** Detected state of every probe target, in declaration order (fast `--version` probe). */
  @Remote
  async listTools(): Promise<ToolStatus[]> {
    return Promise.all(this.tools.map(tool => probeTool(tool)))
  }

  /** Latest detection run state (transcript + merged statuses). */
  @Remote
  detectState(): DetectState {
    return this.state
  }

  /**
   * Start one full detection run through the dedicated assistant LLM. Returns
   * immediately with `running: true`; results stream in via {@link detectState}.
   */
  @Remote
  async detect(): Promise<DetectState> {
    if (this.state.running) return this.state
    const fast = await Promise.all(this.tools.map(tool => probeTool(tool)))
    this.state = { running: true, statuses: fast, records: [] }
    this.detectSessionId = undefined
    this.assistantText = ''
    try {
      const sessionId = await this.launchAssistant()
      this.detectSessionId = sessionId
      this.state = { ...this.state, sessionId: String(sessionId) }
    } catch (error) {
      this.state = { running: false, statuses: fast, records: [], error: messageOf(error) }
    }
    return this.state
  }

  /** Launch the dedicated assistant session and submit the probe prompt. */
  private async launchAssistant(): Promise<SessionId> {
    const agentPresets = this.ctx.get('agentPresets') as {
      resolve(id: string): Promise<{ id: string }>
      acquireScope(id: string): Promise<{ key: unknown } & AsyncDisposable>
      mount(ctx: Context, id: string): Promise<unknown>
    } | undefined
    const agents = this.ctx.get('agents') as {
      create(options: {
        sessionId: SessionId
        meta?: { agentPreset?: string }
        agentOptions?: AgentOptions
        setup?: (agentCtx: Context) => Promise<void>
      }): Promise<{ agent: { followup(message: unknown): void } }>
    } | undefined

    if (agentPresets === undefined) throw new Error('agentPresets service unavailable')
    if (agents === undefined) throw new Error('agents service unavailable')

    const preset = await agentPresets.resolve(ASSISTANT_PRESET)
    await using scope = await agentPresets.acquireScope(preset.id)
    void scope

    const assistant = this.assistantIdentity()
    const sessionId = brandString<SessionId>(`runner-detect-${randomUUID()}`)
    const agentOptions: AgentOptions = {
      provider: ASSISTANT_PROVIDER,
      model: ASSISTANT_MODEL,
      ...(assistant === undefined ? {} : { agentId: assistant.agentBotId }),
    }
    const handle = await agents.create({
      sessionId,
      meta: { agentPreset: preset.id },
      agentOptions,
      setup: async (agentCtx) => {
        await agentPresets.mount(agentCtx, preset.id)
      },
    })
    await this.attachToWorkspace(String(sessionId))
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: detectPrompt(this.tools) }],
      source: { kind: 'user' },
    }))
    return sessionId
  }

  /** Attach the detection session to the workspace root so it is visible/openable (best-effort). */
  private async attachToWorkspace(sessionId: string): Promise<void> {
    const workspace = this.ctx.get('rockWorkspace') as { rootPath(): string | null } | undefined
    const cwd = workspace?.rootPath() ?? null
    if (cwd === null) return
    const registry = this.ctx.get('workspaceRegistry') as {
      create(path: string): Promise<{ attachSession(id: string): Promise<void> }>
    } | undefined
    if (registry === undefined) return
    try {
      const ws = await registry.create(cwd)
      await ws.attachSession(sessionId)
    } catch (error) {
      this.ctx.logger.warn(`rock-tool-inventory: attach session ${sessionId} to workspace failed: ${messageOf(error)}`)
    }
  }

  /** Record one event for the in-flight detection session and finalize on turn end. */
  private recordDetectEvent(session: Session, event: SessionEvent): void {
    if (this.detectSessionId === undefined || session.id !== this.detectSessionId) return
    const record = detectRecordFrom(event)
    if (record !== null) {
      this.state.records = [...this.state.records, record]
      if (record.type === 'assistant.message' && record.text !== undefined) {
        this.assistantText += record.text
      }
    }
    if (event.type === 'turn/end') this.finalizeDetect()
  }

  /** Parse the assistant's JSON answer, merge over the fast probe, and settle the run. */
  private finalizeDetect(): void {
    const assistant = parseDetectStatuses(this.assistantText, this.tools)
    this.state = {
      running: false,
      ...(this.state.sessionId === undefined ? {} : { sessionId: this.state.sessionId }),
      statuses: mergeStatuses(this.state.statuses, assistant),
      records: this.state.records,
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
