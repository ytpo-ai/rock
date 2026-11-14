/**
 * Rock ConnectorClient identity plugin. It syncs the Seagull seat claims for
 * one employee and exposes the identity service (claims, bindings, rendered
 * agent-loop entries) to the rest of the Rock composition.
 *
 * ```yaml
 * - id: seagull-identity
 *   name: '@rock/seagull-identity'
 *   config:
 *     gatewayUrl: http://127.0.0.1:3000/v1/connectors/clients/claims
 *     employeeId: employee-a
 *     claimFile: .rock/claims.json
 *     bindings:
 *       agent-bot-C: codex
 *       agent-bot-D: pi
 * ```
 *
 * @module @rock/seagull-identity
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { BotDefinition } from '@rock/rock-bot-manager'
import { SeagullIdentityService } from './service.ts'
import type { ToolType } from './types.ts'

export const name = 'rock-seagull-identity'
export const inject = []

const DEFAULT_TOOL_TYPE = 'codex'
const DEFAULT_PROVIDER = 'seagull-cloud'
const DEFAULT_MODEL = 'seagull-relay'

/** Deployment-owned identity facts; every field is patchable from cordis.yml. */
export interface Config {
  /** Claims endpoint origin; the service appends `?employeeId=...`. */
  gatewayUrl?: string
  /** Claiming employee identity. */
  employeeId?: string
  /** Local JSON file of `SeatClaim[]` used when the gateway is unreachable. */
  claimFile?: string
  /** Static tool bindings keyed by agent bot id. */
  bindings?: Record<string, ToolType>
  /** Default tool type for bots without an explicit binding. */
  defaultToolType?: ToolType
  /** LLM provider route for rendered agent entries (cloud-llm-adapter). */
  providerName?: string
  /** Placeholder model id for rendered agent entries. */
  defaultModel?: string
  /** Locally-defined custom bots (static fallback; `ctx.rockBots` overrides when mounted). */
  botDefinitions?: BotDefinition[]
}

const botSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  llm: z.object({
    provider: z.string().min(1),
    baseUrl: z.string().min(1).default(''),
    apiKeyRef: z.string().role('secret').default(''),
    model: z.string().min(1),
  }),
  tool: z.object({ toolType: z.string().min(1) }),
})

export const Config: z<Config> = z.object({
  gatewayUrl: z.string().min(1),
  employeeId: z.string().min(1),
  claimFile: z.string().min(1),
  bindings: z.dict(z.string().min(1)).default({}),
  defaultToolType: z.string().min(1).default(DEFAULT_TOOL_TYPE),
  providerName: z.string().min(1).default(DEFAULT_PROVIDER),
  defaultModel: z.string().min(1).default(DEFAULT_MODEL),
  botDefinitions: z.array(botSchema).default([]),
})

/** Mount the identity service: sync claims and expose it on the context. */
export function apply(ctx: Context, config: Config): void {
  const service = new SeagullIdentityService({
    ...config.gatewayUrl === undefined ? {} : { gatewayUrl: config.gatewayUrl },
    ...config.employeeId === undefined ? {} : { employeeId: config.employeeId },
    ...config.claimFile === undefined ? {} : { claimFile: config.claimFile },
    bindings: config.bindings ?? {},
    defaultToolType: config.defaultToolType ?? DEFAULT_TOOL_TYPE,
    defaultProvider: config.providerName ?? DEFAULT_PROVIDER,
    defaultModel: config.defaultModel ?? DEFAULT_MODEL,
    ...config.botDefinitions === undefined || config.botDefinitions.length === 0
      ? {}
      : { botDefinitions: config.botDefinitions.map(cleanBot) },
  })
  // Live local bots from the optional `rock-bot-manager` service override the
  // static config fallback; the manager UI is the primary editor.
  const rockBots = ctx.get('rockBots') as { list(): readonly BotDefinition[] } | undefined
  if (rockBots !== undefined) service.setBotDefinitions(rockBots.list())
  void service.sync().then(() => {
    ctx.logger.info(`seagull-identity: synced ${service.getClaims().length} seat claim(s) + ${service.renderAgents().length - service.getClaims().length} local bot(s)`)
  })
  ctx.provide('seagullIdentity', service)
}

/** Normalize config-declared bots: empty optional strings become absent. */
function cleanBot(bot: BotDefinition): BotDefinition {
  return {
    id: bot.id,
    name: bot.name,
    llm: {
      provider: bot.llm.provider,
      ...bot.llm.baseUrl === undefined || bot.llm.baseUrl === '' ? {} : { baseUrl: bot.llm.baseUrl },
      ...bot.llm.apiKeyRef === undefined || bot.llm.apiKeyRef === '' ? {} : { apiKeyRef: bot.llm.apiKeyRef },
      model: bot.llm.model,
    },
    tool: { toolType: bot.tool.toolType },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Rock identity service (claims, bindings, rendered agents). */
    seagullIdentity: SeagullIdentityService
  }
}
