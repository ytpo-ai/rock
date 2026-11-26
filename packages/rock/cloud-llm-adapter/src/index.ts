/**
 * Rock ConnectorClient LLM adapter plugin. One instance owns many
 * OpenAI-compatible provider routes (each with its own `baseUrl + apiKey +
 * models`), so a custom agent bot can route to any official API (DeepSeek /
 * OpenAI / Qwen / ...) directly, while `seagull-cloud` remains one configured
 * route among them.
 *
 * Every finished request is recorded to a local rotating JSONL log and exposed
 * through `ctx.rockLlmAdapter`, so the Rock console can page the adapter's own
 * request history independently of the loopback relay's forward log.
 *
 * ```yaml
 * - id: llm-cloud
 *   name: '@rock/cloud-llm-adapter'
 *   config:
 *     providers:
 *       seagull-cloud:
 *         baseUrl: http://127.0.0.1:3000
 *         apiKey: sk-agent-xxxx
 *       deepseek:
 *         baseUrl: https://api.deepseek.com
 *         apiKey: sk-deepseek-xxxx
 *         models: [deepseek-chat, deepseek-reasoner]
 * ```
 *
 * @module @rock/cloud-llm-adapter
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RotatingJsonlLog } from '@rock/rock-log-store'
import { CloudLlmAdapter } from './adapter.ts'
import type { LlmRequestLog } from './types.ts'

export const name = 'rock-cloud-llm-adapter'
export const inject = ['llm']
export type * from './types.ts'

const DEFAULT_MODEL = 'rock-model'
const DEFAULT_LOG_PATH = '../.rock/llm-adapter-logs.jsonl'

/** One provider route accepted from cordis.yml, mirroring `CloudProviderConfig`. */
export interface ProviderConfig {
  /** OpenAI-compatible endpoint origin; the adapter appends `/v1/chat/completions`. */
  baseUrl: string
  /** Bearer API key for this provider. */
  apiKey?: string
  /** Human-readable display name; defaults to the provider id. */
  name?: string
  /** Advertised model ids for the catalog. */
  models?: string[]
  /** Placeholder model id for catalog and omitted-request fallback. */
  defaultModel?: string
  /** Rock-relayed route: connector-key auth + `/v1/bots/{agentId}` scoped URL. */
  relay?: boolean
}

/** Deployment-owned connection facts; every provider is patchable from cordis.yml. */
export interface Config {
  /** Provider routes keyed by the id passed to `GenerateOptions.provider`. */
  providers?: Record<string, ProviderConfig>
  /** Local JSONL file persisting the request log (size-rotated). */
  logPath?: string
}

const providerSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().role('secret').default(''),
  name: z.string().default(''),
  models: z.array(z.string().min(1)).default([]),
  defaultModel: z.string().min(1).default(DEFAULT_MODEL),
  relay: z.boolean().default(false),
})

export const Config: z<Config> = z.object({
  providers: z.dict(providerSchema).default({}),
  logPath: z.string().min(1).default(DEFAULT_LOG_PATH),
})

/** Minimal structural view of the `seagull-identity` service (optional dep). */
interface IdentityLike {
  getClaims(): readonly { agentBotId: string; name?: string; model?: { model?: string } }[]
  getAssistants(): readonly { agentBotId: string; name?: string; model?: { model?: string } }[]
  toolBindingOf(id: string): string | undefined
}

/** Host-side surface exposed as `ctx.rockLlmAdapter` for the console's adapter log tab. */
export class RockLlmAdapterService {
  constructor(private readonly logStore: RotatingJsonlLog<LlmRequestLog>) {}

  /**
   * Recent request logs, newest first.
   * @returns the in-memory ring of recorded requests, newest first.
   */
  recentLogs(): LlmRequestLog[] {
    return this.logStore.recent()
  }

  /**
   * Total persisted request-log entries, optionally scoped to one agent bot.
   * @param botId - filter to requests from this bot; omitted counts every request.
   * @returns the number of persisted entries in scope.
   */
  logCount(botId?: string): Promise<number> {
    return this.logStore.count(botId)
  }

  /**
   * One newest-first page of persisted request logs.
   * @param offset - 0-based number of in-scope entries to skip.
   * @param limit - maximum entries to return.
   * @param botId - filter to requests from this bot; omitted pages every request.
   * @returns the requested page, newest first.
   */
  logPage(offset: number, limit: number, botId?: string): Promise<LlmRequestLog[]> {
    return this.logStore.page(offset, limit, botId)
  }
}

/** Register one adapter instance for every configured provider route. */
export function apply(ctx: Context, config: Config): void {
  const providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([id, route]) => [id, {
      baseUrl: route.baseUrl,
      ...route.apiKey === undefined || route.apiKey === '' ? {} : { apiKey: route.apiKey },
      ...route.name === undefined || route.name === '' ? {} : { name: route.name },
      ...route.models === undefined || route.models.length === 0 ? {} : { models: route.models },
      defaultModel: route.defaultModel ?? DEFAULT_MODEL,
      relay: route.relay === true,
    }]),
  )
  if (Object.keys(providers).length === 0) return

  const logStore = new RotatingJsonlLog<LlmRequestLog>({
    path: config.logPath ?? DEFAULT_LOG_PATH,
    keyOf: log => log.agentBotId ?? '',
    onError: (error: unknown) => {
      ctx.logger.warn(`rock-cloud-llm-adapter: failed to persist request log: ${messageOf(error)}`)
    },
  })
  void logStore.load()
  ctx.provide('rockLlmAdapter', new RockLlmAdapterService(logStore))

  const adapter = new CloudLlmAdapter({
    providers,
    resolveConnectorKey: () => {
      const onboarding = ctx.get('rockOnboarding') as { getRecord(): { key: string } | null } | undefined
      return onboarding?.getRecord()?.key
    },
    resolveSupportedProtocols: (agentId: string) => {
      const identity = ctx.get('seagullIdentity') as { supportedProtocolsOf(agentBotId: string): string[] | undefined } | undefined
      return identity?.supportedProtocolsOf(agentId)
    },
    onRequest: (log) => { logStore.append(enrichRequestLog(log, ctx.get('seagullIdentity') as IdentityLike | undefined)) },
  })
  ctx.llm.registerAdapter(Object.keys(providers), adapter)
}

/** A safe, secret-free diagnostic for an unknown thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/**
 * Attach the bot's name, bound model, and bound tool from the identity, when resolvable.
 * @param log - the recorded request.
 * @param identity - the `seagull-identity` service surface, or `undefined` when absent.
 * @returns a new record carrying any resolvable `botName`, `boundModel`, and `toolType`.
 */
export function enrichRequestLog(log: LlmRequestLog, identity: IdentityLike | undefined): LlmRequestLog {
  if (identity === undefined || log.agentBotId === undefined) return log
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
    /** The Rock LLM adapter request-log service (paged adapter request history). */
    rockLlmAdapter: RockLlmAdapterService
  }
}
