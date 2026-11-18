# @deepseek-ai/dsh-rock-app

Rock（ConnectorClient）的 profile bundle：在 dsh web 面之上挂载 codex + DSH 委派层、三个 Rock 插件，以及 per-tool thin-relay 的 `rock-codex` / `rock-dsh` agent preset。

## 组成

| 层 | 插件 | 作用 |
|---|---|---|
| Host | `@deepseek-ai/dsh-subagent-codex` | 注册 `codex` subagent provider |
| Host | `@deepseek-ai/dsh-subagent-dsh-sdk` | 注册 `dsh` subagent provider（spawn 嵌套 DSH 子进程） |
| Host | `@rock/cloud-llm-adapter` | LLM 路由到 Seagull 云端 LLM Proxy（需 `SEAGULL_AGENT_API_KEY`） |
| Host | `@rock/seagull-identity` | 认领关系同步 + 工具绑定（需 `SEAGULL_EMPLOYEE_ID`） |
| Host | `@rock/gateway-reporter` | session 事件出站上报 + 本地 JSONL 缓冲 |
| Preset | `rock-codex`（persona + tool-subagent codex） | 绑定 codex 的 bot 委派 |
| Preset | `rock-dsh`（persona + tool-subagent dsh） | 绑定 dsh 的 bot 委派 |

委派工具下沉到 per-tool preset（isolated scope），toolName 统一 `subagent`；`rock-tasks` 按 bot 的 `toolType` 绑定选择 `rock-codex` / `rock-dsh`（未知绑定回退 codex）。

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
| `ROCK_DSH_HOME` | 嵌套 DSH 子进程的隔离 Harness home（绝对路径） | `$HOME/.rock-dsh-home` |
| `ROCK_DSH_PROVIDER` | 嵌套 DSH 子进程的 LLM provider | `deepseek-official` |
| `ROCK_DSH_MODEL` | 嵌套 DSH 子进程的 LLM model | `deepseek-v4-flash` |
| `DEEPSEEK_API_KEY` | 嵌套 DSH 子进程的 LLM 凭据 | 未设则为空 |

## Known Limitations and Deferred Work

- `cloud-llm-adapter` 与 `seagull-identity` 是云端链路，standalone 下不激活；完整云端闭环（`ConnectorGateway` 端点 + 前端查看页）见 `docs/technical/ROCK_CONNECTOR_CLIENT_DSH_EXTENSION.MD`。
- `@rock/rock-llm-relay`（D-034）是独立的内网 LLM 转发端点，不在本 bundle 内挂载，实现中。
- gateway-reporter 上报契约仍为透传 DSH 内部 session 事件类型，到 M3 四类的映射为后续细化。
