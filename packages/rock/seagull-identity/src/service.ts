/**
 * Seagull identity service: syncs seat claims (agent bot ↔ employee) from the
 * ConnectorGateway (with a local file fallback), resolves local tool bindings,
 * and renders the `dsh-agent-loop` agent entries for the claimed bots.
 *
 * @module @rock/seagull-identity/service
 */
import { readFile } from 'node:fs/promises'
import type { BotDefinition } from '@rock/rock-bot-manager'
import type { AgentLoopPatch, RenderedAgent, SeatClaim, ToolBinding, ToolType } from './types.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface SeagullIdentityOptions {
  /** Claims endpoint origin; the service appends `?employeeId=...`. */
  gatewayUrl?: string
  /** Claiming employee identity. */
  employeeId?: string
  /** Local JSON file of `SeatClaim[]` used when the gateway is unreachable. */
  claimFile?: string
  /** Static tool bindings keyed by agent bot id. */
  bindings: Record<string, ToolType>
  /** Default tool type for bots without an explicit binding. */
  defaultToolType: ToolType
  /** LLM provider route for rendered agent entries (cloud-llm-adapter). */
  defaultProvider: string
  /** Placeholder model id for rendered agent entries. */
  defaultModel: string
  /** Locally-defined custom bots merged with the cloud seat claims. */
  botDefinitions?: readonly BotDefinition[]
  /** Fetch-like transport for the claims endpoint, injectable for tests. */
  fetchJson?: (url: string) => Promise<unknown>
}

/** Synced Seagull identity state plus rendering helpers. */
export class SeagullIdentityService {
  private claims: SeatClaim[] = []
  private localBots: readonly BotDefinition[]

  constructor(private readonly options: SeagullIdentityOptions) {
    this.localBots = options.botDefinitions ?? []
  }

  /** Current seat claims (empty before {@link sync} completes). */
  getClaims(): readonly SeatClaim[] {
    return this.claims
  }

  /** Replace the locally-defined custom bots (live update from `rock-bot-manager`). */
  setBotDefinitions(bots: readonly BotDefinition[]): void {
    this.localBots = bots
  }

  /** Load the claim list from the gateway, falling back to the local file. */
  async sync(): Promise<void> {
    this.claims = await this.loadClaims()
  }

  /** Resolve the tool type an agent bot binds to (local tool binding). */
  toolBindingOf(agentBotId: string): ToolType {
    const local = this.localBots.find(bot => bot.id === agentBotId)
    if (local !== undefined) return local.tool.toolType
    return this.options.bindings[agentBotId] ?? this.options.defaultToolType
  }

  /** Render the agent-loop agent entries for every claimed bot and local bot. */
  renderAgents(): RenderedAgent[] {
    const byId = new Map<string, RenderedAgent>()
    for (const claim of this.claims) {
      byId.set(claim.agentBotId, {
        id: claim.agentBotId,
        provider: this.options.defaultProvider,
        model: this.options.defaultModel,
      })
    }
    for (const bot of this.localBots) {
      byId.set(bot.id, { id: bot.id, provider: bot.llm.provider, model: bot.llm.model })
    }
    return [...byId.values()]
  }

  /**
   * Render the full `dsh-agent-loop` cordis patch row a launcher can write to
   * the Rock profile to inject the claimed agents (config generation; the
   * launcher persists this and reloads on claim sync).
   */
  renderAgentLoopPatch(): AgentLoopPatch {
    return {
      id: 'agent-loop',
      name: '@deepseek-ai/dsh-agent-loop',
      config: { agents: this.renderAgents() },
    }
  }

  private async loadClaims(): Promise<SeatClaim[]> {
    if (this.options.gatewayUrl !== undefined && this.options.employeeId !== undefined) {
      const url = `${this.options.gatewayUrl}?employeeId=${encodeURIComponent(this.options.employeeId)}`
      try {
        const data = await this.fetchJson(url)
        return (data as { claims?: SeatClaim[] }).claims ?? []
      } catch (error) {
        if (this.options.claimFile === undefined) throw error
      }
    }
    if (this.options.claimFile !== undefined) {
      const raw = await readFile(this.options.claimFile, 'utf8')
      return JSON.parse(raw) as SeatClaim[]
    }
    return []
  }

  private async fetchJson(url: string): Promise<unknown> {
    if (this.options.fetchJson !== undefined) return this.options.fetchJson(url)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`claims fetch failed: ${response.status}`)
    return response.json()
  }
}

/** A tool-binding registry helper, kept separate for consumers that only need bindings. */
export function bindingsOf(bindings: readonly ToolBinding[]): Record<string, ToolType> {
  return Object.fromEntries(bindings.map(binding => [binding.agentBotId, binding.toolType]))
}
