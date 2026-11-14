# @rock/rock-observability

Rock 本地可观测插件：把 Harness 的 `session/event` 流折成**每 session 的轮数 / 步数 / 输出 token**，供工作台仪表盘展示。口径与 DSH 现成的 `sessionStats` projection 一致（`step/end` 计步、`assistant/message` 的 `usage.outputTokens` 计输出 token）。

## 用途

本地闭环「执行后可见」：哪些 session 跑了几轮、几步、用了多少输出 token，全程不依赖 Seagull。

```yaml
- id: rock-observability
  name: '@rock/rock-observability'
```

## 服务

`ctx.rockObservability`（`RockObservabilityService`）：

- `observe(session, event)` — 折入一条已提交的 session 事件（由插件订阅 `session/event` 驱动）
- `rows(): ObservabilityRow[]` — 每 session 一行 `{ sessionId, turns, steps, outputTokens }`
- `rowOf(sessionId): ObservabilityRow | undefined`

## Known Limitations and Deferred Work

- 输出 token 口径仅含 `usage.outputTokens`（对齐 `sessionStats` 的 `decodeTokens`）；input+output 总量需扩展 projection 后补齐。
- 当前未做「bot → session」归属标注：session 与其 agent bot 的映射依赖 agent-loop 配置，属后续接线。
- Client 仪表盘页面未在本 package 内实现（Host 数据面先行）。
