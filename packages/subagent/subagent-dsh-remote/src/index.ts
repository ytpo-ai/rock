/**
 * Profile-named `dsh web` Remote subagent provider. Each accepted run connects
 * a running `dsh web` Host over the Typert unary protocol (token→cookie), creates
 * one session in the delegating workspace, dispatches the text-only task, and
 * polls `session/wait` until the turn reaches a stopping state. The provider
 * never spawns or stops the Host.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertPositiveFinite,
  assertUsableCwd,
  NO_START_CAPABILITIES,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import { connectRemote, DshRemoteClient } from './client.ts'
import {
  dshRemoteConfigurationFailure,
  dshRemoteConnectFailure,
  DshRemoteRunFailure,
} from './failure.ts'
import { startDshRemoteRun, type DshRemoteRunSpec } from './run.ts'

export const name = 'subagent-dsh-remote'
export const inject = ['subagents']

const DEFAULT_PROVIDER_NAME = 'dsh-remote'

/** Default `dsh web` Host base URL. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3080'

/** Default per-poll `session/wait` deadline. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000

/** Deployment-owned Host, context, and polling settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dsh-remote`). */
  providerName?: string
  /** `dsh web` Host base URL without a trailing slash. */
  baseUrl?: string
  /** Host launch token (printed in the Host startup URL). */
  token?: string
  /** Child preset id fixed for created sessions. */
  agentPreset?: string
  /** Per-poll `session/wait` deadline. */
  waitTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  baseUrl: z.string().min(1).default(DEFAULT_BASE_URL),
  token: z.string().min(1),
  agentPreset: z.string().min(1),
  waitTimeoutMs: z.number().default(DEFAULT_WAIT_TIMEOUT_MS),
})

/** The shape after schemastery applied the defaults; the preset stays optional. */
type ResolvedConfig = Omit<Required<Config>, 'agentPreset'> & Pick<Config, 'agentPreset'>

class DshRemoteProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    if (request.signal.aborted) {
      throw new Error('subagent-dsh-remote: request was aborted before startup')
    }
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-dsh-remote', 'child cwd', request.cwd)
    } catch (error) {
      throw dshRemoteConfigurationFailure(error)
    }
    if (this.config.token === '') {
      throw dshRemoteConfigurationFailure(new Error('subagent-dsh-remote: token must be a non-empty string'))
    }
    let client: DshRemoteClient
    try {
      const cookie = await connectRemote(this.config.baseUrl, this.config.token, fetch)
      client = new DshRemoteClient(this.config.baseUrl, cookie, fetch)
    } catch (error) {
      throw error instanceof DshRemoteRunFailure ? error : dshRemoteConnectFailure(error)
    }
    const spec: DshRemoteRunSpec = {
      client,
      cwd,
      ...(this.config.agentPreset === undefined ? {} : { agentPreset: this.config.agentPreset }),
      waitTimeoutMs: this.config.waitTimeoutMs,
      onError: (error, stopReason: SubagentStopReason) => {
        this.ctx.logger.warn(`subagent-dsh-remote "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startDshRemoteRun(request, spec)
  }
}

/**
 * Register one Profile-named `dsh web` Remote provider.
 * @param ctx - context carrying the shared subagent service.
 * @param config - registry name, Host base URL/token, preset, and polling settings.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    token: config.token ?? '',
    ...(config.agentPreset === undefined ? {} : { agentPreset: config.agentPreset }),
    waitTimeoutMs: config.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
  }
  assertPositiveFinite('subagent-dsh-remote', 'waitTimeoutMs', resolved.waitTimeoutMs)
  ctx.subagents.registerProvider(new DshRemoteProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
