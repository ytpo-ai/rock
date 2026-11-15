/**
 * Rock tool inventory plugin: probes the machine for installed agent tools and
 * exposes the result as a read-only Remote service (`ctx.rockToolInventory`).
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
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { toolStatusFrom } from './probe.ts'
import type { ToolDescriptor, ToolStatus } from './types.ts'

export type * from './types.ts'

const execFileAsync = promisify(execFile)

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

/** Remote service carrying the tool inventory. */
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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'rockToolInventory')
    this.tools = config.tools ?? DEFAULT_TOOLS
  }

  /** Detected state of every probe target, in declaration order. */
  @Remote
  async listTools(): Promise<ToolStatus[]> {
    return Promise.all(this.tools.map(tool => probeTool(tool)))
  }
}

/** Probe one tool with a bounded `--version` run. */
async function probeTool(tool: ToolDescriptor): Promise<ToolStatus> {
  const installDocUrl = tool.installDocUrl === undefined || tool.installDocUrl === '' ? undefined : tool.installDocUrl
  try {
    const { stdout } = await execFileAsync(tool.command, ['--version'], { timeout: 5000 })
    return { ...toolStatusFrom(tool.id, stdout, undefined), ...installDocUrl === undefined ? {} : { installDocUrl } }
  } catch (error) {
    return { ...toolStatusFrom(tool.id, undefined, error), ...installDocUrl === undefined ? {} : { installDocUrl } }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The read-only tool inventory Remote. */
    rockToolInventory: RockToolInventoryController
  }
}
