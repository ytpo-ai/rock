# @rock/rock-observability

Rock 本地可观测插件：把 Harness 的 `session/event` 流折成**每 session 的轮数 / 步数 / 输出 token**，并把两个日志源（relay 转发、LLM adapter 请求）以 Remote 分页暴露给工作台的「日志」面板。会话口径与 DSH 现成的 `sessionStats` projection 一致（`step/end` 计步、`assistant/message` 的 `usage.outputTokens` 计输出 token）。

## 用途

本地闭环「执行后可见」：哪些 session 跑了几轮、几步、用了多少输出 token，哪些模型请求打到哪个 bot，全程不依赖 Seagull。

```yaml
- id: rock-observability
  name: '@rock/rock-observability'
```

## 服务

`ctx.rockObservability`（Remote）：

- `observe(session, event)` — 折入一条已提交的 session 事件（由插件订阅 `session/event` 驱动）
- `rows(): ObservabilityRow[]` — 每 session 一行 `{ sessionId, turns, steps, outputTokens }`
- `rowOf(sessionId): ObservabilityRow | undefined`
- `relayLogs(offset, limit, botId?)` / `relayLogCount(botId?)` — relay 转发日志的一页与该范围内的总数（读 `ctx.rockLlmRelay`，缺失时为空 / 0）
- `adapterLogs(offset, limit, botId?)` / `adapterLogCount(botId?)` — LLM adapter 请求日志的一页与该范围内的总数（读 `ctx.rockLlmAdapter`，缺失时为空 / 0）
- `bots(): BotOption[]` — 日志页 Bot 筛选的选项：seat claims → assistants → `rockBots` 本地 bot，按 id 去重

`botId` 省略或为空串表示不筛选。relay 日志在读取时用 `seagull-identity` 补齐旧 JSONL 记录缺失的 `botName` / `boundModel` / `toolType`（只补空，不覆盖已落盘值）。

## 面板（Client）

侧边栏「日志」→ 顶部工具条 + 三个 Tab：

| 控件 / Tab | 行为 |
|---|---|
| 刷新 | 清空已加载页并从第一页重取（保留 Bot 筛选与每页条数）；两个日志都在加载时禁用 |
| Bot | `全部 Bot` + `bots()` 选项；选中后**服务端按 bot 过滤再分页**，relay 与 adapter 同时生效 |
| 每页条数 | 打开 `LogDisplayDialog`：推荐 20 / 50 / 100 / 200，或手动填写 1–500（默认 50）；非法值给错误提示并禁用「应用」 |
| 转发日志 | 时间 / Bot / 工具 / 会话 / 路径 / 模型映射 / 状态 / 用时柱图，滚到底加载更早一页 |
| Adapter 请求 | 时间 / Bot / Provider / 会话 / 模型 / 输入→输出 token（title 含缓存与 reasoning）/ 状态 / 用时柱图 |
| 会话 | 每 session 的轮数 / 步数 / 输出 token |

## Known Limitations and Deferred Work

- 输出 token 口径仅含 `usage.outputTokens`（对齐 `sessionStats` 的 `decodeTokens`）；input+output 总量需扩展 projection 后补齐。
- 当前未做「bot → session」归属标注：session 与其 agent bot 的映射依赖 agent-loop 配置，属后续接线。
- 日志页没有自动轮询：靠手动刷新与筛选/条数变化重取，避免与本地日志文件的读取竞争。
- Bot 筛选只列当前身份与本地注册表里的 bot：历史日志里出现过但已删除的 bot 不会出现在下拉中（其日志行在「全部 Bot」下仍可见）。
- 两个日志的 `total` 与 `page` 是两次独立读取，期间若有新条目落盘，`total` 可能比实际可翻页数大一条，滚到底时表现为多请求一次空页。
