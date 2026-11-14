# @rock/cloud-llm-adapter

Rock ConnectorClient 的 LLM adapter：把 Harness LLM seam（`ctx.llm`）的模型调用按 **per-provider** 路由到对应的 OpenAI-compatible 端点——任意官方 API（DeepSeek / OpenAI / Qwen / …）+ apiKey 直连，`seagull-cloud` 只是其中一个 provider。

## 用途

在 Rock preset 中挂载本插件，使 Rock 内每个 agent（含委派器化后的 parent agent）的模型调用都按它自己声明的 `provider` 走对应上游：自定义 bot 可直连官方 API，认领 bot 可走云端 Seagull LLM Proxy。

```yaml
- id: llm-cloud
  name: '@rock/cloud-llm-adapter'
  config:
    providers:
      seagull-cloud:
        baseUrl: http://127.0.0.1:3000
        apiKey: sk-agent-xxxx
        defaultModel: seagull-relay
      deepseek:
        baseUrl: https://api.deepseek.com
        apiKey: sk-deepseek-xxxx
        models: [deepseek-chat, deepseek-reasoner]
        defaultModel: deepseek-chat
```

## 配置

`providers` 为 provider id → 连接事实的映射，每个 provider：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | —（必填） | OpenAI-compatible 端点 origin（追加 `/v1/chat/completions`） |
| `apiKey` | — | 提交给该 provider 的 Bearer key（`role: secret`，不落明文配置日志） |
| `name` | provider id | 显示名 |
| `models` | — | 目录展示的模型 id 列表；缺省回退 `defaultModel` 单条 |
| `defaultModel` | `rock-model` | 目录/缺省请求使用的占位模型 id |

## 实现

- 实现 `@deepseek-ai/dsh-llm` 的抽象类 `LlmAdapter`，`stream()` 按 `options.provider` 解析对应 `baseUrl`/`apiKey`，把 `GenerateOptions` 翻译为 OpenAI `/v1/chat/completions` 请求，SSE 流式解析回 `StreamChunk`。
- 携带 `attributionHeaders()` + `Authorization: Bearer <apiKey>`。
- 支持 text / reasoning / tool-call 增量、`usage`、`finish`（`stop`/`tool_calls`/`length` → harness 语义）。

## Known Limitations and Deferred Work

- 只支持文本模态：`image` / `file` 内容块当前被忽略（Relay 场景无需多模态）。
- `listModels` 返回静态配置的模型，不调用 provider `/v1/models` 发现。
- `tool-addition` / `tool-removal` 块不投影（Relay 请求无工具更新历史）。
