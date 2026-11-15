/**
 * Rock ConnectorClient LLM adapter plugin. One instance owns many
 * OpenAI-compatible provider routes (each with its own `baseUrl + apiKey +
 * models`), so a custom agent bot can route to any official API (DeepSeek /
 * OpenAI / Qwen / ...) directly, while `seagull-cloud` remains one configured
 * route among them.
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
import { CloudLlmAdapter } from './adapter.ts'

export const name = 'rock-cloud-llm-adapter'
export const inject = ['llm']

const DEFAULT_MODEL = 'rock-model'

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
})

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
  const adapter = new CloudLlmAdapter({
    providers,
    resolveConnectorKey: () => {
      const onboarding = ctx.get('rockOnboarding') as { getRecord(): { key: string } | null } | undefined
      return onboarding?.getRecord()?.key
    },
  })
  ctx.llm.registerAdapter(Object.keys(providers), adapter)
}
