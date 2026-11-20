/**
 * Profile-named OpenCode v2 one-shot subagent provider. Each accepted run
 * connects the local OpenCode server (discovered from its service file or an
 * explicit url/password), creates one session in the delegating workspace,
 * dispatches the text-only task over HTTP REST, and polls the durable message
 * list until the idle message settles the turn. The provider never spawns or
 * stops the OpenCode server itself.
 *
 * @module @deepseek-ai/dsh-subagent-opencode
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertPositiveFinite,
  assertUsableCwd,
  NO_START_CAPABILITIES,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  basicAuthorization,
  OpencodeClient,
  readServiceFile,
} from './client.ts'
import {
  opencodeConfigurationFailure,
  opencodeDiscoveryFailure,
} from './failure.ts'
import { startOpencodeRun, type OpencodeRunSpec } from './run.ts'
import type { OpencodeServiceInfo } from './types.ts'

export const name = 'subagent-opencode'
export const inject = ['subagents']

const DEFAULT_PROVIDER_NAME = 'opencode'

/** Default delay between durable-message polls. */
export const DEFAULT_POLL_INTERVAL_MS = 500

/** The tool-type id the runtime connection config (url + token) is keyed by. */
const TOOL_TYPE = 'opencode'

/** Deployment-owned discovery, context, and polling settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `opencode`). */
  providerName?: string
  /** Discovery file path; defaults to the OpenCode service file under the home directory. */
  servicePath?: string
  /** Explicit server URL; requires `password`, and overrides `servicePath`. */
  url?: string
  /** Explicit server password; requires `url`, and overrides `servicePath`. */
  password?: string
  /** OpenCode agent id fixed for created sessions. */
  agent?: string
  /** Delay between durable-message polls. */
  pollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  servicePath: z.string().min(1),
  url: z.string().min(1),
  password: z.string().min(1),
  agent: z.string().min(1),
  pollIntervalMs: z.number().default(DEFAULT_POLL_INTERVAL_MS),
})

/** The shape after schemastery applied the defaults; discovery overrides stay optional. */
type ResolvedConfig = Omit<Required<Config>, 'url' | 'password' | 'servicePath' | 'agent'> & Pick<Config, 'url' | 'password' | 'servicePath' | 'agent'>

/** Default OpenCode service discovery file path. */
function defaultServicePath(): string {
  return join(homedir(), '.local', 'state', 'opencode', 'service.json')
}

/**
 * Resolve the OpenCode server record: explicit url/password win, otherwise the
 * discovery file is read.
 * @param config - the resolved plugin config.
 * @returns the discovered service info.
 */
function resolveService(config: ResolvedConfig): OpencodeServiceInfo {
  if (config.url !== undefined && config.password !== undefined) {
    return { url: config.url, password: config.password }
  }
  if (config.url !== undefined || config.password !== undefined) {
    throw new TypeError('subagent-opencode: url and password must be configured together, or use servicePath discovery')
  }
  const servicePath = config.servicePath ?? defaultServicePath()
  return readServiceFile(servicePath)
}

class OpencodeProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  /** The user-supplied runtime connection (url + password), when the inventory panel persists one. */
  private connectionOverride(): { url?: string; token?: string } | undefined {
    const inventory = this.ctx.get('rockToolInventory') as {
      connectionConfig(id: string): { url?: string; token?: string } | undefined
    } | undefined
    return inventory?.connectionConfig(TOOL_TYPE)
  }

  /** Resolve the service record, preferring the runtime url+password over static discovery. */
  private resolveServiceWithOverride(): OpencodeServiceInfo {
    const connection = this.connectionOverride()
    if (connection !== undefined && connection.url !== undefined && connection.token !== undefined) {
      return { url: connection.url, password: connection.token }
    }
    return resolveService(this.config)
  }

  start(request: ResolvedSubagentStartRequest) {
    if (request.signal.aborted) {
      throw new Error('subagent-opencode: request was aborted before startup')
    }
    let cwd: string
    try {
      cwd = assertUsableCwd('subagent-opencode', 'child cwd', request.cwd)
    } catch (error) {
      throw opencodeConfigurationFailure(error)
    }
    let service: OpencodeServiceInfo
    try {
      service = this.resolveServiceWithOverride()
    } catch (error) {
      throw opencodeDiscoveryFailure(error)
    }
    const client = new OpencodeClient(
      service.url,
      basicAuthorization(service.password),
    )
    const spec: OpencodeRunSpec = {
      client,
      cwd,
      ...(request.label === undefined ? {} : { label: request.label }),
      ...(this.config.agent === undefined ? {} : { agent: this.config.agent }),
      pollIntervalMs: this.config.pollIntervalMs,
      onError: (error, stopReason: SubagentStopReason) => {
        this.ctx.logger.warn(`subagent-opencode "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startOpencodeRun(request, spec)
  }
}

/**
 * Register one Profile-named OpenCode provider.
 * @param ctx - context carrying the shared subagent service.
 * @param config - registry name, discovery, context, and polling settings.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    ...(config.servicePath === undefined ? {} : { servicePath: config.servicePath }),
    ...(config.url === undefined ? {} : { url: config.url }),
    ...(config.password === undefined ? {} : { password: config.password }),
    ...(config.agent === undefined ? {} : { agent: config.agent }),
    pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  }
  assertPositiveFinite('subagent-opencode', 'pollIntervalMs', resolved.pollIntervalMs)
  ctx.subagents.registerProvider(new OpencodeProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
