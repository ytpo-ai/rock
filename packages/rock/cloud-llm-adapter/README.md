# @rock/cloud-llm-adapter

Rock ConnectorClient 的 LLM adapter：把 Harness LLM seam（`ctx.llm`）的模型调用路由到 Seagull 云端 LLM Proxy（OpenAI-compatible `/v1/chat/completions`）。

## 用途

在 Rock preset 中挂载本插件，使 Rock 内所有 agent（含委派器化后的 parent agent）的模型调用都走云端，复用云端的身份 / 记忆 / 额度 / 路由流水线。

```yaml
- id: llm-cloud
  name: '@rock/cloud-llm-adapter'
  config:
    providerName: seagull-cloud
    baseUrl: http://127.0.0.1:3000
    apiKey: sk-agent-xxxx
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `providerName` | `seagull-cloud` | 注册到 `ctx.llm` 的 provider 路由名 |
| `baseUrl` | `http://127.0.0.1:3000` | 云端 LLM Proxy origin（追加 `/v1/chat/completions`） |
| `apiKey` | — | 提交给云端的 Bearer agent API key |
| `defaultModel` | `seagull-relay` | 目录/缺省请求使用的占位模型 id |

## 实现

- 实现 `@deepseek-ai/dsh-llm` 的抽象类 `LlmAdapter`，唯一 provider 路由，`stream()` 把 `GenerateOptions` 翻译为 OpenAI `/v1/chat/completions` 请求，SSE 流式解析回 `StreamChunk`。
- 携带 `attributionHeaders()` + `Authorization: Bearer <agentApiKey>`。
- 支持 text / reasoning / tool-call 增量、`usage`、`finish`（`stop`/`tool_calls`/`length` → harness 语义）。

## Known Limitations and Deferred Work

- 只支持文本模态：`image` / `file` 内容块当前被忽略（Relay 场景无需多模态）。
- `listModels` 返回单个占位模型，不调用云端 `/v1/models` 发现。
- `tool-addition` / `tool-removal` 块不投影（Relay 请求无工具更新历史）。
