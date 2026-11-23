# @rock/rock-bot-manager

Rock 本地 bot 管理器：在员工工作台上持久化并服务**本地自定义 agent bot**（`BotDefinition`）。bot 管理 UI 与 `seagull-identity` 都通过 `ctx.rockBots` 读写；变更落到 JSON 文件，重启不丢。

## 用途

让本地闭环不再依赖 Seagull：用户在工作台新增自定义 bot，在右侧抽屉里完整定义它自己的上游 Provider（Provider ID / 显示名 / API 地址 / 协议 / 密钥）与单个模型（模型 ID / 上下文窗口 / 输入类型 / 推理档位等）；执行后端**默认不绑定**，需要时再选，绑好即形成「agent bot → 执行」闭环。

管理面板对齐 Seagull 的 Bot 卡片：名片头（图标 + 可点击名称 + 角色 + 来源标签 + 运行状态）、指标 chips（模型 / 执行工具 / 部署状态）、footer（所属项目 + 「…」菜单）。卡片只放**待办动作**——未绑定显示「待绑定」，已绑定未部署显示「部署」+「调试」，已部署后卡片不再出现按钮；全部操作（换绑、部署/重新部署、调试、LLM 代理、编辑、删除）集中在点击名称打开的 Bot 详情抽屉里。专属助理不绑定外部工具，卡片与详情页都不提供这些操作。支持关键词搜索与来源筛选；本地 bot 可编辑/删除，认领 bot 可重绑执行器（专属助理不可重绑）。

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
| `bindingsPath` | `.rock/bindings.json` | 云端 bot 的工具绑定 JSON 文件 |

## 服务

`ctx.rockBots`（`RockBotService`）：

- `list(): BotDefinition[]` — 全部本地 bot
- `get(id): BotDefinition | undefined`
- `create(input): Promise<BotDefinition>` — 重复 id 抛 `DUPLICATE_BOT`
- `update(id, patch): Promise<BotDefinition>` — 未知 id 抛 `UNKNOWN_BOT`
- `remove(id): Promise<void>` — 未知 id 抛 `UNKNOWN_BOT`

`BotDefinition`：`{ id, name, role?, llm: BotLlm, tool?: { toolType } }`。`tool` 缺省表示未绑定执行后端（新建 bot 的默认状态）。`role` 是角色/人格标签（本地 bot 自由填写）；`apiKey` 存用户输入的明文 key（仅不落日志，文件仍为明文），`apiKeyRef` 保留兼容。

`BotLlm` 承载一条完整的上游定义：`provider`（Provider ID）、`name?`（Provider 显示名）、`baseUrl?`（API 地址）、`protocol?`（API 协议，`openai-chat`/`openai-responses`/`anthropic`/`gemini`，缺省 openai-chat）、`apiKey?`/`apiKeyRef?`（密钥）、`model`（模型 ID）、`modelName?`、`contextWindow?`、`maxOutputTokens?`、`inputTypes?`（`text`/`image`）、`reasoning?`（`{ enabled, levels: [{ level, value }] }`）。

## Remote（管理面板）

- `listBotsUnified(): BotRow[]` — 本地/认领/专属助理三源合并的卡片行（含 `llm` 模型、`projectId`/`projectName` 所属项目、`canRebind`/`canDelete` 权限；未绑定时不含 `tool`）
- `createBot` / `updateBot` / `removeBot` / `rebindBot` — bot CRUD 与工具绑定
- `toolTypes()` / `installedTools()` — 可选工具类型与已安装状态；`installedTools()` 将「执行器检测」的助理结果合并覆盖到快速 `--version` 探测之上（检测结果优先、快速探测补齐空缺）
- `watchDetected()` — 检测完成时推送修订号的流；面板订阅后在检测结束后即时刷新已安装工具，无需轮询
- `testBot(id): BotDebugState` / `testState(): BotDebugState` — 未绑定的 bot 抛 `rockBots/unbound`（客户端提示「请先绑定执行工具再调试」）； 对绑定工具发起一次 smoke test（固定 prompt「查询当前北京天气」，前缀 `调试Bot【bot名】` 使会话标题清晰）；本地 bot 走自己的 `llm`，云端 bot 走 seagull-cloud 路由（model 用其绑定模型名 `BotModelInfo.model`，缺省回退 `seagull-relay`），并按 `agentId` 定位 bot；`testBot` 立即返回 `running: true`，进度与结果经 `testState()` 轮询，`sessionId` 用于「查看会话详情」
- `getLlmProxy(id): LlmProxyChecklist | null` — 为**云端 bot**（claimed/assistant）生成 DSH「自定义模型 API」填写清单（providerId/displayName/baseUrl/protocol/apiKey/modelId/modelName），本地 bot 返回 null；数据来自 `ctx.rockLlmRelay.getFacts()`

权限矩阵：本地 bot 全权（编辑/删除/重绑）；认领 bot 只读但可重绑（`canRebind=true`）；专属助理只读且不可重绑（`canRebind=false`）。

动作矩阵（`client/bot-card-state.ts`，卡片与详情抽屉共用）：

| 状态 / 来源 | 卡片动作 | 详情抽屉动作 |
|---|---|---|
| 未绑定（本地或认领） | 「待绑定」（选执行工具） | 绑定、调试（禁用并说明）、LLM 代理（仅认领）、编辑（仅本地）、删除（可删） |
| 已绑定、未部署 | 「部署」+「调试」 | 换绑、部署、调试、LLM 代理（仅认领）、编辑（仅本地）、删除（可删） |
| 已部署 | 无 | 换绑、重新部署、调试、LLM 代理（仅认领）、编辑（仅本地）、删除（可删） |
| 部署中 | 「部署」（禁用） | 同上 |
| 专属助理 | 无 | 无（仅只读信息 + 一行说明） |

云端 bot 的「LLM 代理」入口在 Bot 详情抽屉里，打开后展示上述清单，每项带复制按钮；`API 协议` 固定 `OpenAI Chat Completions`，`模型 ID` 填 bot 的真实模型 id（仅用于展示；无模型时回退占位符 `seagull-relay`），`模型名` 为 `{模型ID}/{bot名}`，`API 密钥` 为 `rock-llm-relay` 生成的本地 relay key（与 connector key 无关）。`rock-llm-relay` 转发时会把请求体里的 `model` 无条件替换为 `seagull-relay`，使 Seagull 始终按 bot 绑定模型路由。

## Known Limitations and Deferred Work

- 持久化用 JSON 文件；尚未切到 `storage-sqlite`。`apiKey` 明文落盘 `bots.json`，属产品决策，未接凭据存储。
- 新增的 `protocol`/`reasoning`/`contextWindow`/`maxOutputTokens`/`inputTypes` 字段目前仅落盘 `bots.json`，尚未接入实际 LLM 请求路由（`cloud-llm-adapter` 仍按 OpenAI-compatible 处理）。
- `testBot` 通过 thin-relay preset 路由（`codex`/`dsh`/`opencode` 有对应 preset），未配置 preset 的**已绑定**工具类型回退到 `codex` preset；未绑定的 bot 在前置校验即被拒绝，不会走到 preset 解析。
- 变更不广播「hot reload」事件，`seagull-identity` 的运行时重渲染属后续接线。
