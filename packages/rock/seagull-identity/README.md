# @rock/seagull-identity

Rock ConnectorClient 的身份插件：同步 Seagull 云端认领关系（`SeatClaim`：agent bot ↔ 员工，D-033）到本地，解析本地工具绑定，并渲染 `dsh-agent-loop` 的 agent 条目（每个认领 bot 一条）。

## 用途

在 Rock preset 中挂载本插件，使员工工作台「认领」哪些 agent bot、每个 bot 绑定哪个执行后端（Codex/Pi/DSH）都可由配置/云端决定。

```yaml
- id: seagull-identity
  name: '@rock/seagull-identity'
  config:
    gatewayUrl: http://127.0.0.1:3000/v1/connectors/clients/claims
    employeeId: employee-a
    claimFile: .rock/claims.json
    bindings:
      agent-bot-C: codex
      agent-bot-D: pi
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `gatewayUrl` | — | 云端认领关系端点（追加 `?employeeId=...`） |
| `employeeId` | — | 认领员工身份 |
| `claimFile` | — | 离线降级用的本地 `SeatClaim[]` JSON 文件 |
| `bindings` | `{}` | 静态工具绑定：`agentBotId → toolType` |
| `defaultToolType` | `codex` | 未显式绑定的 bot 使用的默认后端 |
| `providerName` | `seagull-cloud` | 渲染的 agent 条目 LLM 路由（cloud-llm-adapter） |
| `defaultModel` | `seagull-relay` | 渲染的 agent 条目占位模型 |

## 实现

- 挂载后 `ctx.provide('seagullIdentity', service)`，暴露 `getClaims()` / `toolBindingOf()` / `renderAgents()`。
- `sync()` 先走网关，失败降级读 `claimFile`；两者都没有则空认领（standalone 本地自定义 bot 场景）。

## Known Limitations and Deferred Work

- 认领排他 / 离线不解除 / 长期绑定（D-033）的强制在**云端**（REQ-002 `seat_claims`），本插件只消费认领关系。
- `renderAgents()` 只渲染 agent 条目；将其真正注入 `dsh-agent-loop` 的 `Config.agents`（动态配置/launcher 注入）为 Phase 1 后续细化。
- standalone 本地自定义 bot（无认领时声明本地 bot）分支未在本插件落地，由 preset 静态声明。
