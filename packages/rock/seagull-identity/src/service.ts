/**
 * Seagull identity service: syncs seat claims (agent bot ↔ employee) from the
 * ConnectorGateway (with a local file fallback), resolves local tool bindings,
 * and renders the `dsh-agent-loop` agent entries for the claimed bots.
 *
 * @module @rock/seagull-identity/service
 */
import { readFile } from 'node:fs/promises'
import type { BotDefinition } from '@rock/rock-bot-manager'
import type { AgentLoopPatch, AssistantRef, RenderedAgent, SeatClaim, ToolBinding, ToolType } from './types.ts'

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
  private assistants: AssistantRef[] = []
  private onboardingStatus: string | undefined
  private localBots: readonly BotDefinition[]
  private claimedBindingOf: ((id: string) => string | undefined) | undefined
  private runtimeBaseUrl?: string
  private runtimeEmployeeId?: string

  constructor(private readonly options: SeagullIdentityOptions) {
    this.localBots = options.botDefinitions ?? []
  }

  /** Current seat claims (empty before {@link sync} completes). */
  getClaims(): readonly SeatClaim[] {
    return this.claims
  }

  /** Current dedicated assistants (empty before {@link sync} completes). */
  getAssistants(): readonly AssistantRef[] {
    return this.assistants
  }

  /** Current onboarding status (`pending`/`in-progress`/`done`/`skipped`), or undefined before sync. */
  getOnboardingStatus(): string | undefined {
    return this.onboardingStatus
  }

  /** Replace the locally-defined custom bots (live update from `rock-bot-manager`). */
  setBotDefinitions(bots: readonly BotDefinition[]): void {
    this.localBots = bots
  }

  /** Resolve claimed-bot bindings from the manager (runtime-persisted), else static config. */
  setClaimedBindingOf(resolver: ((id: string) => string | undefined) | undefined): void {
    this.claimedBindingOf = resolver
  }

  /** Set the runtime identity resolved from the connector key (REQ-013). */
  setIdentity(baseUrl: string, employeeId: string): void {
    this.runtimeBaseUrl = baseUrl
    this.runtimeEmployeeId = employeeId
  }

  /** Load the claim list from the gateway, falling back to the local file. */
  async sync(): Promise<void> {
    const result = await this.loadClaims()
    this.claims = result.claims
    this.assistants = result.assistants
    this.onboardingStatus = result.onboarding
  }

  /** Resolve the tool type an agent bot binds to (local tool binding). */
  toolBindingOf(agentBotId: string): ToolType {
    const local = this.localBots.find(bot => bot.id === agentBotId)
    if (local !== undefined) return local.tool.toolType
    return this.claimedBindingOf?.(agentBotId) ?? this.options.bindings[agentBotId] ?? this.options.defaultToolType
  }

  /** Render the agent-loop agent entries for every claimed bot and local bot. */
  renderAgents(): RenderedAgent[] {
    const byId = new Map<string, RenderedAgent>()
    for (const claim of this.claims) {
      byId.set(claim.agentBotId, {
        id: claim.agentBotId,
        provider: this.options.defaultProvider,
        model: this.options.defaultModel,
        sessionId: claim.agentBotId,
      })
    }
    for (const bot of this.localBots) {
      byId.set(bot.id, {
        id: bot.id,
        provider: bot.llm.provider,
        model: bot.llm.model,
        sessionId: bot.id,
      })
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

  private async loadClaims(): Promise<{ claims: SeatClaim[]; assistants: AssistantRef[]; onboarding: string | undefined }> {
    const url = this.claimsUrl()
    if (url !== undefined) {
      try {
        const data = await this.fetchJson(url)
        const envelope = (data as {
          data?: { claims?: SeatClaim[]; assistants?: AssistantRef[]; onboarding?: { status?: string } | null }
        }).data
        return {
          claims: envelope?.claims ?? [],
          assistants: envelope?.assistants ?? [],
          onboarding: typeof envelope?.onboarding?.status === 'string' ? envelope.onboarding.status : undefined,
        }
      } catch (error) {
        if (this.options.claimFile === undefined) throw error
      }
    }
    if (this.options.claimFile !== undefined) {
      const raw = await readFile(this.options.claimFile, 'utf8')
      return { claims: JSON.parse(raw) as SeatClaim[], assistants: [], onboarding: undefined }
    }
    return { claims: [], assistants: [], onboarding: undefined }
  }

  /** The claims endpoint URL, preferring the runtime connector-key identity. */
  private claimsUrl(): string | undefined {
    if (this.runtimeBaseUrl !== undefined && this.runtimeEmployeeId !== undefined) {
      return `${this.runtimeBaseUrl}/v1/connectors/claims?employeeId=${encodeURIComponent(this.runtimeEmployeeId)}`
    }
    if (this.options.gatewayUrl !== undefined && this.options.employeeId !== undefined) {
      return `${this.options.gatewayUrl}?employeeId=${encodeURIComponent(this.options.employeeId)}`
    }
    return undefined
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
