# @rock/seagull-identity

Rock ConnectorClient 的身份插件：同步 Seagull 云端认领关系（`SeatClaim`：agent bot ↔ 员工，D-033）到本地，合并**本地自定义 bot**（`BotDefinition`，来自 `rock-bot-manager`），解析工具绑定，并渲染 `dsh-agent-loop` 的 agent 条目（每个 bot 一条，per-bot `provider/model`）。

## 用途

在 Rock preset 中挂载本插件，使员工工作台「认领」哪些 agent bot、每个 bot 绑定哪个执行后端（Codex/Pi/DSH）、走哪个 LLM 路由（官方 provider 或 `seagull-cloud`），都可由配置 / 云端 / 本地 bot 管理器决定。

```yaml
- id: seagull-identity
  name: '@rock/seagull-identity'
  config:
    gatewayUrl: http://127.0.0.1:3000/v1/connectors/clients/claims
    employeeId: employee-a
    claimFile: .rock/claims.json
    bindings:
      agent-bot-C: codex
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `gatewayUrl` | — | 云端认领关系端点（追加 `?employeeId=...`） |
| `employeeId` | — | 认领员工身份 |
| `claimFile` | — | 离线降级用的本地 `SeatClaim[]` JSON 文件 |
| `bindings` | `{}` | 静态工具绑定：`agentBotId → toolType` |
| `defaultToolType` | — | 显式指定未绑定 bot 的后端；不配置时未绑定即「待绑定」，不隐式回退任何工具 |
| `providerName` | `seagull-cloud` | 认领 bot 的 LLM 路由（cloud-llm-adapter） |
| `defaultModel` | `seagull-relay` | 认领 bot 的占位模型 |
| `botDefinitions` | `[]` | 本地自定义 bot（静态兜底；挂载 `rock-bot-manager` 时由其 `ctx.rockBots.list()` 覆盖） |

## 实现

- 挂载后 `ctx.provide('seagullIdentity', service)`，暴露 `getClaims()` / `toolBindingOf()` / `renderAgents()` / `renderAgentLoopPatch()` / `setBotDefinitions()`。
- `toolBindingOf()` 返回 `ToolType | undefined`：本地 bot 读自身 `tool`，云端 bot 依次走 `rockBots.getBinding()`、静态 `bindings`、`defaultToolType`；都没有就是未绑定（不再回退 `codex`）。
- `SeatClaim` / `AssistantRef` 现额外透传 `model`（provider/model/name）与 `projectId`，供 `rock-bot-manager` 卡片展示真实模型与所属项目（Seagull `seat-claim` 端点下发，兼容旧契约）。
- `sync()` 先走网关，失败降级读 `claimFile`；两者都没有则空认领。
- `renderAgents()` 输出「认领 bot（默认 provider/model）∪ 本地自定义 bot（各自 provider/model）」的并集，本地 bot 同 id 时覆盖认领条目。
- `renderAgentLoopPatch()` 生成完整的 `@deepseek-ai/dsh-agent-loop` cordis patch 行（含 `agents`），供 launcher 在认领同步时写回 Rock profile 并 reload（配置生成式注入）。

## Known Limitations and Deferred Work

- 认领排他 / 离线不解除 / 长期绑定（D-033）的强制在**云端**（REQ-002 `seat_claims`），本插件只消费认领关系。
- `renderAgentLoopPatch()` 是**配置生成**式注入（launcher 写回 + reload）；DSH agent-loop 暂无「运行期动态增删 agent 条目」的机制，如需热更新需扩展 agent-loop 核心。
- `ctx.rockBots` 变更到 `renderAgents()` 的**运行期热刷新**属后续接线（当前 `apply` 只读一次）。
