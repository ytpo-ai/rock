/**
 * Rock ConnectorClient LLM relay plugin (D-034). It mounts a loopback
 * OpenAI-compatible endpoint so external tools route their LLM calls through
 * Rock, which stamps each forwarded request with provenance and forwards it to
 * the Seagull cloud LLM Proxy. Inbound requests authenticate with a local
 * relay bearer key (distinct from the cloud connector key).
 *
 * ```yaml
 * - id: llm-relay
 *   name: '@rock/rock-llm-relay'
 *   config:
 *     host: 127.0.0.1
 *     port: 4090
 *     cloudBaseUrl: http://127.0.0.1:3000
 *     connectorClientId: rock-employee-a
 *     keyPath: ../.rock/relay-key.json
 * ```
 *
 * @module @rock/rock-llm-relay
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RelayKeyService } from './key-service.ts'
import { RelayLogStore } from './log-store.ts'
import { RockLlmRelay } from './relay.ts'
import type { RelayForwardLog, RockLlmRelayFacts } from './types.ts'

export const name = 'rock-llm-relay'
export const inject = []
export type * from './types.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4090
const DEFAULT_KEY_PATH = '../.rock/relay-key.json'
const DEFAULT_LOG_PATH = '../.rock/llm-relay-logs.jsonl'

/** Minimal structural view of the `seagull-identity` service (optional dep). */
interface IdentityLike {
  getClaims(): readonly { agentBotId: string; name?: string; employeeId: string; model?: { model?: string } }[]
  getAssistants(): readonly { agentBotId: string; name?: string; model?: { model?: string } }[]
  toolBindingOf(id: string): string | undefined
}

/** Deployment-owned relay connection facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Loopback bind host. */
  host?: string
  /** Loopback bind port. */
  port?: number
  /** Seagull cloud LLM Proxy origin; the relay appends `/v1/bots/{agentBotId}<path-suffix>`. */
  cloudBaseUrl: string
  /** Rock instance identity stamped as `x-seagull-connector-client-id`. */
  connectorClientId: string
  /** Local JSON file persisting the inbound relay bearer key. */
  keyPath?: string
  /** Local JSONL file persisting the relay forward log (size-rotated). */
  logPath?: string
}

export const Config: z<Config> = z.object({
  host: z.string().min(1).default(DEFAULT_HOST),
  port: z.number().step(1).min(1).max(65535).default(DEFAULT_PORT),
  cloudBaseUrl: z.string().min(1),
  connectorClientId: z.string().min(1),
  keyPath: z.string().min(1).default(DEFAULT_KEY_PATH),
  logPath: z.string().min(1).default(DEFAULT_LOG_PATH),
})

/** Host-side surface exposed as `ctx.rockLlmRelay` for the bot-manager drawer. */
class RockLlmRelayService {
  constructor(
    private readonly host: string,
    private port: number,
    private readonly keyService: RelayKeyService,
    private readonly logStore: RelayLogStore,
  ) {}

  /** Record the actual bound port once the server is listening. */
  setPort(port: number): void {
    this.port = port
  }

  /** Loopback facts (host/port/baseUrl/apiKey) other plugins read. */
  getFacts(): RockLlmRelayFacts {
    return {
      host: this.host,
      port: this.port,
      baseUrl: `http://${this.host}:${this.port}`,
      apiKey: this.keyService.getKey(),
    }
  }

  /** Recent relay forward logs, newest first. */
  recentLogs(): RelayForwardLog[] {
    return this.logStore.recent()
  }

  /** Total persisted forward-log entries across the active file and rotated fragments. */
  logCount(): Promise<number> {
    return this.logStore.count()
  }

  /** One newest-first page of persisted forward logs; `offset` is a 0-based skip. */
  logPage(offset: number, limit: number): Promise<RelayForwardLog[]> {
    return this.logStore.page(offset, limit)
  }
}

/** Mount the relay, its local key, and the host-side facts service, and dispose with the fiber. */
export function apply(ctx: Context, config: Config): void {
  const host = config.host ?? DEFAULT_HOST
  const port = config.port ?? DEFAULT_PORT
  const keyService = new RelayKeyService(config.keyPath ?? DEFAULT_KEY_PATH)
  if (keyService.generatedOnBoot) {
    void keyService.persist().catch((error: unknown) => {
      ctx.logger.warn(`rock-llm-relay: failed to persist relay key: ${messageOf(error)}`)
    })
  }

  const logStore = new RelayLogStore(config.logPath ?? DEFAULT_LOG_PATH, undefined, undefined, undefined, (error: unknown) => {
    ctx.logger.warn(`rock-llm-relay: failed to persist forward log: ${messageOf(error)}`)
  })
  void logStore.load()

  const relay = new RockLlmRelay({
    host,
    port,
    localKey: keyService.getKey(),
    cloudBaseUrl: config.cloudBaseUrl,
    resolveConnectorKey: () => {
      const onboarding = ctx.get('rockOnboarding') as { getRecord(): { key: string } | null } | undefined
      return onboarding?.getRecord()?.key
    },
    connectorClientId: config.connectorClientId,
    resolveEmployeeId: (agentBotId) => {
      const identity = ctx.get('seagullIdentity') as IdentityLike | undefined
      return identity?.getClaims().find(claim => claim.agentBotId === agentBotId)?.employeeId
    },
    onForward: (log) => { logStore.append(enrichForwardLog(log, ctx.get('seagullIdentity') as IdentityLike | undefined)) },
  })

  const service = new RockLlmRelayService(host, port, keyService, logStore)
  ctx.provide('rockLlmRelay', service)

  void relay.start().then((boundPort) => {
    service.setPort(boundPort)
    ctx.logger.info(`rock-llm-relay listening on http://${host}:${boundPort}`)
  }, (error: unknown) => {
    ctx.logger.error(`rock-llm-relay: failed to start: ${messageOf(error)}`)
  })
  ctx.effect(() => () => { void relay.stop() }, 'rock-llm-relay.stop()')
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/**
 * Attach the bot's name, bound model, and bound tool from the identity, when resolvable.
 * @param log - the relay record to enrich in place of a copy.
 * @param identity - the `seagull-identity` service surface, or `undefined` when absent.
 * @returns a new record carrying any resolvable `botName`, `boundModel`, and `toolType`.
 */
export function enrichForwardLog(log: RelayForwardLog, identity: IdentityLike | undefined): RelayForwardLog {
  if (identity === undefined) return log
  const ref = [...identity.getClaims(), ...identity.getAssistants()].find(item => item.agentBotId === log.agentBotId)
  const boundModel = ref?.model?.model
  const toolType = identity.toolBindingOf(log.agentBotId)
  return {
    ...log,
    ...(ref?.name === undefined ? {} : { botName: ref.name }),
    ...(boundModel === undefined ? {} : { boundModel }),
    ...(toolType === undefined ? {} : { toolType }),
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The loopback LLM relay facts service (host/port/baseUrl/local key). */
    rockLlmRelay: RockLlmRelayService
  }
}
