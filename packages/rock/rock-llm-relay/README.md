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

## 服务暴露

- `ctx.rockLlmRelay.getFacts()` → `{ host, port, baseUrl, apiKey }`，供 `rock-bot-manager` 等插件读取并组装 DSH 模型 API 填写清单。

## Known Limitations and Deferred Work

- 仅处理 `chat/completions` 路径后缀（`wire_api = chat`）；`responses` API 路径后续扩展。
- 云端认领校验（`seat_claims[agentId]==employeeId`）依赖 REQ-002 `seat_claims`，本插件只注入溯源。
- 多一跳 + Rock 单点（127.0.0.1 回环，延迟可忽略）。
- 本地 key 明文落盘（与 `connector-key.json` 一致），不写入日志。
