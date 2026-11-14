# @rock/rock-preset

Rock（ConnectorClient）的委派器化组合示例：把「clone DSH + 3 插件 + agent-loop 委派器化」串成一个 web profile。

## 组成

| 层 | 插件 | 作用 |
|---|---|---|
| Host | `@rock/cloud-llm-adapter` | LLM 路由到 Seagull 云端 LLM Proxy |
| Host | `@rock/seagull-identity` | 同步认领关系 + 工具绑定 + 渲染 agent 条目 |
| Host | `@rock/gateway-reporter` | session 事件出站上报 + 离线补传 |
| Host | `@deepseek-ai/dsh-subagent` + `dsh-subagent-codex` | spawn Codex 的 subagent 底座 |
| Host | `@deepseek-ai/dsh-agent-loop` | 调度骨架（委派器化） |
| Preset | `@deepseek-ai/dsh-persona`（thin relay）+ `dsh-tool-subagent` | 每个 agent 唯一工具 = 委派工具 |

## 委派器化语义

- 每个认领的 agent bot 映射为 agent-loop 的一个 `agents` 条目，`provider: seagull-cloud`（LLM 走云端）。
- 该 agent 的 preset 只挂 `tool-subagent`（provider=绑定的 Codex/Pi/DSH），persona 声明「只委派、不思考」。
- parent agent 不自己做执行，只把任务委派给绑定工具并回传结果。

## 注意

- 本文件是**集成示例**，`${...}` 占位需替换为真实连接信息；挂载前需在 Rock web profile 运行时验证（依赖 Phase 2 云端 Gateway + 本地 Codex）。
- `agents` 条目由 `seagull-identity` 的 `renderAgents()` 生成，示例中静态写出仅为说明结构。
