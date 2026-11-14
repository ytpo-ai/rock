# @deepseek-ai/dsh-rock-app

Rock（ConnectorClient）的 profile bundle：在 dsh web 面之上挂载 codex 委派层、三个 Rock 插件，以及 thin-relay 的 `rock` agent preset。

## 组成

| 层 | 插件 | 作用 |
|---|---|---|
| Host | `@deepseek-ai/dsh-subagent-codex` | 注册 `codex` subagent provider |
| Host | `@deepseek-ai/dsh-tool-subagent`（`tool-subagent-codex`） | 全局 `subagent_codex` 委派工具 |
| Host | `@rock/cloud-llm-adapter` | LLM 路由到 Seagull 云端 LLM Proxy（需 `SEAGULL_AGENT_API_KEY`） |
| Host | `@rock/seagull-identity` | 认领关系同步 + 工具绑定（需 `SEAGULL_EMPLOYEE_ID`） |
| Host | `@rock/gateway-reporter` | session 事件出站上报 + 本地 JSONL 缓冲 |
| Preset | `@deepseek-ai/dsh-persona`（thin relay） | 只委派、不思考 |

## 启动

本 bundle 注册为 shipped profile `rock`：

```sh
dsh rock          # 等同 dsh --profile rock
```

standalone 下可直接启动：`cloud-llm-adapter` 与 `seagull-identity` 在对应环境变量缺失时保持 disabled，`gateway-reporter` 会把回流事件缓冲到本地 `.rock/events.jsonl`。

## 环境变量

| 变量 | 作用 | 缺省 |
|---|---|---|
| `SEAGULL_AGENT_API_KEY` | 启用 cloud-llm-adapter 并作为云端 Bearer 凭据 | 未设则禁用 |
| `SEAGULL_CLOUD_BASE_URL` | 云端 LLM Proxy origin | `http://127.0.0.1:3000` |
| `SEAGULL_EMPLOYEE_ID` | 启用 seagull-identity 的认领员工身份 | 未设则禁用 |
| `SEAGULL_GATEWAY_URL` | 云端 ConnectorGateway origin | `http://127.0.0.1:3000` |
| `ROCK_CLAIM_FILE` | seagull-identity 的本地认领 JSON 降级文件 | `.rock/claims.json` |
| `ROCK_CONNECTOR_CLIENT_ID` | Rock 实例身份 | `rock-employee-a` |
| `ROCK_BUFFER_PATH` | gateway-reporter 的离线缓冲 JSONL | `.rock/events.jsonl` |

## Known Limitations and Deferred Work

- `cloud-llm-adapter` 与 `seagull-identity` 是云端链路，standalone 下不激活；完整云端闭环（`ConnectorGateway` 端点 + 前端查看页）见 `docs/technical/ROCK_CONNECTOR_CLIENT_DSH_EXTENSION.MD`。
- `@rock/rock-llm-relay`（D-034）是独立的内网 LLM 转发端点，不在本 bundle 内挂载，实现中。
- gateway-reporter 上报契约仍为透传 DSH 内部 session 事件类型，到 M3 四类的映射为后续细化。
