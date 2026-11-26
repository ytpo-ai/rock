# @rock/rock-llm-relay

Rock ConnectorClient 的 LLM 内网转发端点（D-034）。外部工具（Codex/Pi）把 base_url 指向 Rock 本地端点（每 bot 独立路径），Rock 解析 agent bot、注入溯源、转发云端 LLM Proxy，并流式透传回外部工具。入站请求用本地 relay key 鉴权，出站用 connector key 鉴权，两段凭据隔离。

## 用途

把外部工具的 LLM 调用从「直连云端」改为「经 Rock 中转」，使 LLM 链路也带认领溯源，云端可做认领校验，且 AgentApiKey 不再暴露给每个本地工具。

```yaml
- id: llm-relay
  name: '@rock/rock-llm-relay'
  config:
    host: 127.0.0.1
    port: 4090
    cloudBaseUrl: http://127.0.0.1:3000
    connectorClientId: rock-employee-a
    keyPath: ../.rock/relay-key.json
```

外部工具 base_url 配置为 `http://127.0.0.1:4090/v1/bots/{agentBotId}`，并携带 `Authorization: Bearer <relay-key>`（本地 key 由 Rock 启动时生成并持久化到 `keyPath`，供 `ctx.rockLlmRelay.getFacts()` 读取）。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `host` | `127.0.0.1` | 回环监听地址 |
| `port` | `4090` | 回环监听端口 |
| `cloudBaseUrl` | — | 云端 LLM Proxy origin（追加 `/v1/bots/{agentBotId}<path-suffix>`） |
| `connectorClientId` | — | Rock 实例身份 |
| `keyPath` | `../.rock/relay-key.json` | 本地 relay key 的持久化 JSON 文件 |

## 鉴权

- **入站**：外部工具 → Rock relay，必须携带 `Authorization: Bearer <本地 relay key>`；缺失/不符返回 401。本地 key 在 `keyPath` 首次缺失时生成（`sk-rock-<hex>`）并原子持久化，重启复用。
- **出站**：Rock relay → Seagull，仍用 `rockOnboarding` 的 connector key 作为 `Authorization: Bearer`，与本地 key 无关。

## 路由与溯源

- 路由：`POST /v1/bots/{agentBotId}/chat/completions`（`{agentBotId}` 来自 base_url 路径）。
- 注入 header：`x-seagull-agent-bot-id` / `x-seagull-employee-id`（查 seagull-identity 认领）/ `x-seagull-connector-client-id` / `x-seagull-relayed: true`。
- **会话头透传**：入站 `x-rock-session-id`（Rock/DSH 会话 id）/ `x-session-id` / `x-conversation-id`（外部工具会话 id）原样转发到云端，供 Seagull 按会话归并 LLM 调用。
- **模型强制**：无论入站请求体里的 `model` 是什么，转发前都替换为 `seagull-relay`，使 Seagull 始终按 bot 绑定模型路由，忽略外部工具传入的模型（不触发 `allowOverride`）。

## 服务暴露

- `ctx.rockLlmRelay.getFacts()` → `{ host, port, baseUrl, apiKey }`，供 `rock-bot-manager` 等插件读取并组装 DSH 模型 API 填写清单。
- `ctx.rockLlmRelay.recentLogs()` — 内存环内最近的转发记录，newest first。
- `ctx.rockLlmRelay.logPage(offset, limit, botId?)` / `logCount(botId?)` — 覆盖落盘完整历史的一页与该范围内的总数；`botId` 省略表示不过滤。
- `ctx.rockLlmRelay.logBotIds()` — 历史中出现过的 agent bot id。
- 日志落盘在 `logPath`（默认 `../.rock/llm-relay-logs.jsonl`），由 `@rock/rock-log-store` 的 `RotatingJsonlLog` 管理：1MB 滚动、保留 10 个分片、500 条内存环。

## Known Limitations and Deferred Work

- 转发记录**不含 usage / token / 缓存字段**：`record()` 在拿到上游 status 后立即落盘，且响应是逐块字节透传、不解析 SSE，因此拿不到 `usage`。需要 token 口径时读 `@rock/cloud-llm-adapter` 的请求日志（adapter 自己解析 SSE）或云端 `llm_logs`；给 relay 补 token 需要改造响应管道做旁路嗅探并重排记录时机。
- 仅处理 `chat/completions` 路径后缀（`wire_api = chat`）；`responses` API 路径后续扩展。
- 云端认领校验（`seat_claims[agentId]==employeeId`）依赖 REQ-002 `seat_claims`，本插件只注入溯源。
- 多一跳 + Rock 单点（127.0.0.1 回环，延迟可忽略）。
- 本地 key 明文落盘（与 `connector-key.json` 一致），不写入日志。
