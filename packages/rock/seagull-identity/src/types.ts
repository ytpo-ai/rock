/**
 * Rock identity vocabulary: the Seagull seat claim (D-033) and the local tool
 * binding that maps a claimed agent bot to an execution backend.
 */

/** One Seagull seat claim: an agent bot claimed by one employee (D-033). */
export interface SeatClaim {
  /** Seagull-registered agent bot id. */
  agentBotId: string
  /** Claiming employee id. */
  employeeId: string
  /** Claim time (ISO-8601). */
  claimedAt: string
}

/** Local tool type an agent bot binds to on the employee workbench (e.g. codex / pi / dsh / acp / claude-code). */
export type ToolType = string

/** One local tool binding: agent bot → execution backend. */
export interface ToolBinding {
  /** Claimed agent bot id (or a local standalone bot id). */
  agentBotId: string
  /** Execution backend the bot delegates to. */
  toolType: ToolType
}

/** One rendered agent-loop agent entry (the `dsh-agent-loop` `Config.agents` row). */
export interface RenderedAgent {
  /** Stable config id; also the agent bot id. */
  id: string
  /** LLM route: cloud Proxy provider from `cloud-llm-adapter`. */
  provider: string
  /** Placeholder model id; the cloud Proxy resolves the real route. */
  model: string
  /** Exact session identity pinned to the bot id, so observability can attribute a session to its bot. */
  sessionId: string
}

/** A cordis patch row a launcher writes to inject the agent-loop agent entries. */
export interface AgentLoopPatch {
  id: string
  name: string
  config: { agents: RenderedAgent[] }
}
