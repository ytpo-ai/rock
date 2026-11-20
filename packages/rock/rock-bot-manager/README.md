# @rock/rock-bot-manager

Rock 本地 bot 管理器：在员工工作台上持久化并服务**本地自定义 agent bot**（`BotDefinition`）。bot 管理 UI 与 `seagull-identity` 都通过 `ctx.rockBots` 读写；变更落到 JSON 文件，重启不丢。

## 用途

让本地闭环不再依赖 Seagull：用户在工作台新增自定义 bot，指定它自己的上游 LLM（官方 OpenAI-compatible provider + apiKey）和执行后端，即可形成「agent bot → 执行」闭环。管理面板以卡片列表展示每个 bot 的名称/角色/状态/模型/所属项目，支持关键词搜索与来源筛选；本地 bot 可编辑/删除，认领 bot 可重绑执行器（专属助理不可重绑）。

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
| `toolRun` | 见下 | 每个工具类型的非交互一次性运行命令；`{prompt}` 会被替换为测试 prompt |
| `bindingsPath` | `.rock/bindings.json` | 云端 bot 的工具绑定 JSON 文件 |

`toolRun` 默认映射（均为尽力而为的起点，可在 cordis.yml 覆盖）：

| toolType | command | args |
|---|---|---|
| `codex` | `codex` | `exec -- {prompt}` |
| `pi` | `pi` | `exec {prompt}` |
| `opencode` | `opencode` | `run {prompt}` |
| `dsh` | `dsh` | `--profile headless {prompt}` |
| `claude-code` | `claude` | `-p {prompt}` |

## 服务

`ctx.rockBots`（`RockBotService`）：

- `list(): BotDefinition[]` — 全部本地 bot
- `get(id): BotDefinition | undefined`
- `create(input): Promise<BotDefinition>` — 重复 id 抛 `DUPLICATE_BOT`
- `update(id, patch): Promise<BotDefinition>` — 未知 id 抛 `UNKNOWN_BOT`
- `remove(id): Promise<void>` — 未知 id 抛 `UNKNOWN_BOT`

`BotDefinition`：`{ id, name, role?, llm: { provider, baseUrl?, apiKeyRef?, apiKey?, model }, tool: { toolType } }`。`role` 是角色/人格标签（本地 bot 自由填写）；`apiKey` 存用户输入的明文 key（仅不落日志，文件仍为明文），`apiKeyRef` 保留兼容。

## Remote（管理面板）

- `listBotsUnified(): BotRow[]` — 本地/认领/专属助理三源合并的卡片行（含 `llm` 模型、`projectId`/`projectName` 所属项目、`canRebind`/`canDelete` 权限）
- `createBot` / `updateBot` / `removeBot` / `rebindBot` — bot CRUD 与工具绑定
- `toolTypes()` / `installedTools()` — 可选工具类型与已安装状态；`installedTools()` 将「执行器检测」的助理结果合并覆盖到快速 `--version` 探测之上（检测结果优先、快速探测补齐空缺）
- `watchDetected()` — 检测完成时推送修订号的流；面板订阅后在检测结束后即时刷新已安装工具，无需轮询
- `providers()` — 已注册的 LLM provider 路由（供新增/编辑表单的 provider 下拉）
- `testBot(id): BotTestResult` — 用固定 prompt「查询当前北京天气」对绑定工具做一次非交互 smoke test，返回 `{ ok, toolType, answer?, error? }`
- `getLlmProxy(id): LlmProxyChecklist | null` — 为**云端 bot**（claimed/assistant）生成 DSH「自定义模型 API」填写清单（providerId/displayName/baseUrl/protocol/apiKey/modelId/modelName），本地 bot 返回 null；数据来自 `ctx.rockLlmRelay.getFacts()`

权限矩阵：本地 bot 全权（编辑/删除/重绑）；认领 bot 只读但可重绑（`canRebind=true`）；专属助理只读且不可重绑（`canRebind=false`）。

云端 bot 卡片提供「LLM 代理」按钮，打开右侧抽屉展示上述清单，每项带复制按钮；`API 协议` 固定 `OpenAI Chat Completions`，`模型 ID` 填 bot 的真实模型 id（仅用于展示；无模型时回退占位符 `seagull-relay`），`模型名` 为 `{模型ID}/{bot名}`，`API 密钥` 为 `rock-llm-relay` 生成的本地 relay key（与 connector key 无关）。`rock-llm-relay` 转发时会把请求体里的 `model` 无条件替换为 `seagull-relay`，使 Seagull 始终按 bot 绑定模型路由。

## Known Limitations and Deferred Work

- 持久化用 JSON 文件；尚未切到 `storage-sqlite`。`apiKey` 明文落盘 `bots.json`，属产品决策，未接凭据存储。
- `testBot` 的默认 `toolRun` 命令是尽力而为的起点，`acp` 无默认 CLI 命令；实际命令随部署在 `config.toolRun` 覆盖。
- 变更不广播「hot reload」事件，`seagull-identity` 的运行时重渲染属后续接线。
