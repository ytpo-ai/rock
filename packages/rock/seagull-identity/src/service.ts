/**
 * Seagull identity service: syncs seat claims (agent bot ↔ employee) from the
 * ConnectorGateway (with a local file fallback), resolves local tool bindings,
 * and renders the `dsh-agent-loop` agent entries for the claimed bots.
 *
 * @module @rock/seagull-identity/service
 */
import { readFile } from 'node:fs/promises'
import type { RenderedAgent, SeatClaim, ToolBinding, ToolType } from './types.ts'

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
  /** Fetch-like transport for the claims endpoint, injectable for tests. */
  fetchJson?: (url: string) => Promise<unknown>
}

/** Synced Seagull identity state plus rendering helpers. */
export class SeagullIdentityService {
  private claims: SeatClaim[] = []

  constructor(private readonly options: SeagullIdentityOptions) {}

  /** Current seat claims (empty before {@link sync} completes). */
  getClaims(): readonly SeatClaim[] {
    return this.claims
  }

  /** Load the claim list from the gateway, falling back to the local file. */
  async sync(): Promise<void> {
    this.claims = await this.loadClaims()
  }

  /** Resolve the tool type an agent bot binds to (local tool binding). */
  toolBindingOf(agentBotId: string): ToolType {
    return this.options.bindings[agentBotId] ?? this.options.defaultToolType
  }

  /** Render the agent-loop agent entries for every claimed bot. */
  renderAgents(): RenderedAgent[] {
    return this.claims.map(claim => ({
      id: claim.agentBotId,
      provider: this.options.defaultProvider,
      model: this.options.defaultModel,
    }))
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
