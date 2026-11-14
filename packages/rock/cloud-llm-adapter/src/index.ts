/**
 * Rock ConnectorClient LLM adapter plugin. One plugin instance owns one
 * provider route (default `seagull-cloud`) and streams every model call through
 * the Seagull cloud LLM Proxy over an OpenAI-compatible `/v1/chat/completions`
 * endpoint, so external tools running inside Rock keep the cloud's identity,
 * memory, quota, and routing pipeline.
 *
 * ```yaml
 * - id: llm-cloud
 *   name: '@rock/cloud-llm-adapter'
 *   config:
 *     providerName: seagull-cloud
 *     baseUrl: http://127.0.0.1:3000
 *     apiKey: sk-agent-xxxx
 * ```
 *
 * @module @rock/cloud-llm-adapter
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CloudLlmAdapter } from './adapter.ts'

export const name = 'rock-cloud-llm-adapter'
export const inject = ['llm']

const DEFAULT_PROVIDER_NAME = 'seagull-cloud'
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const DEFAULT_MODEL = 'seagull-relay'

/** Deployment-owned connection facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Provider route name on `ctx.llm` (default `seagull-cloud`). */
  providerName?: string
  /** Cloud LLM Proxy origin; the adapter appends `/v1/chat/completions`. */
  baseUrl?: string
  /** Bearer agent API key presented to the cloud Proxy. */
  apiKey?: string
  /** Placeholder model id used when a request names none (relay passthrough). */
  defaultModel?: string
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  baseUrl: z.string().min(1).default(DEFAULT_BASE_URL),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1).default(DEFAULT_MODEL),
})

/** Register the cloud-backed adapter for one provider route. */
export function apply(ctx: Context, config: Config): void {
  const adapter = new CloudLlmAdapter({
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    ...config.apiKey === undefined ? {} : { apiKey: config.apiKey },
    defaultModel: config.defaultModel ?? DEFAULT_MODEL,
  })
  ctx.llm.registerAdapter([config.providerName ?? DEFAULT_PROVIDER_NAME], adapter)
}
