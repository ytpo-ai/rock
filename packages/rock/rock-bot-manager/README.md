# @rock/rock-bot-manager

Rock 本地 bot 管理器：在员工工作台上持久化并服务**本地自定义 agent bot**（`BotDefinition`）。bot 管理 UI 与 `seagull-identity` 都通过 `ctx.rockBots` 读写；变更落到 JSON 文件，重启不丢。

## 用途

让本地闭环不再依赖 Seagull：用户在工作台新增自定义 bot，指定它自己的上游 LLM（官方 OpenAI-compatible provider + apiKey 引用）和执行后端，即可形成「agent bot → 执行」闭环。

```yaml
- id: rock-bot-manager
  name: '@rock/rock-bot-manager'
  config:
    storePath: .rock/bots.json
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `storePath` | `.rock/bots.json` | 本地 bot 列表 JSON 文件（原子写入） |

## 服务

`ctx.rockBots`（`RockBotService`）：

- `list(): BotDefinition[]` — 全部本地 bot
- `get(id): BotDefinition | undefined`
- `create(input): Promise<BotDefinition>` — 重复 id 抛 `DUPLICATE_BOT`
- `update(id, patch): Promise<BotDefinition>` — 未知 id 抛 `UNKNOWN_BOT`
- `remove(id): Promise<void>` — 未知 id 抛 `UNKNOWN_BOT`

`BotDefinition`：`{ id, name, llm: { provider, baseUrl?, apiKeyRef?, model }, tool: { toolType } }`。`apiKeyRef` 只存凭据引用，不落明文 key。

## Known Limitations and Deferred Work

- 持久化用 JSON 文件；尚未切到 `storage-sqlite`。
- 变更不广播「hot reload」事件，`seagull-identity` 的运行时重渲染属后续接线。
