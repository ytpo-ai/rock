---
description: "OpenCode v2 子代理后端：面向选择委派 provider、配置本机 OpenCode 服务器或排查本地嵌套子运行的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-opencode

[English](README.md) | 中文

## 摘要

`dsh-subagent-opencode` 把每个委派任务运行在本机 OpenCode v2 服务器的一个会话中。provider 从服务文件（或显式的 url/password）发现服务器，用 HTTP Basic 鉴权，在父工作区创建会话，派发纯文本任务，并轮询持久化消息列表直到 idle 消息结束该 turn。它从不拉起或停止 OpenCode 服务器，会话保留在服务器上，因此 OpenCode UI 可以列出并恢复它。当委派应运行在单独安装的 OpenCode 桌面服务器、而非 Harness 管理的进程上时，选择此后端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择它

当子任务必须是单独安装的 OpenCode v2 服务器上的完整会话——拥有自己的模型、工具和可在 OpenCode UI 中看到的持久化转写——而不是 Harness 管理的进程或进程内 agent 时，选择此后端。provider 不声明任何 start-time 能力（`agentOptions`/`agentPreset`/`outputSchema`/`depthLimit` 均为 false），且 `inheritsParentContext: false`。父方请求不支持的 capability 时会在 start 阶段被拒绝，而非被静默忽略。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `opencode` | `ctx.subagents` 上的注册名 |
| `servicePath` | `~/.local/state/opencode/service.json` | 携带 `url` 与 `password` 的发现文件 |
| `url` | — | 显式服务器 URL；需与 `password` 成对，并覆盖 `servicePath` |
| `password` | — | 显式服务器密码；需与 `url` 成对，并覆盖 `servicePath` |
| `agent` | — | 为创建的会话固定的 OpenCode agent id |
| `pollIntervalMs` | `500` | 持久化消息轮询间隔 |

发现过程读取 OpenCode 服务文件（`~/.local/state/opencode/service.json`）拿到服务器 URL 与密码，随后在每个请求上发送 `Authorization: Basic base64("opencode:" + password)`。当 `url` 与 `password` 都设置时，跳过发现并使用这两个值。服务文件缺失或不可读、或凭据缺失，会在 start 阶段令该运行失败。

```yaml
- id: subagent-opencode
  name: '@deepseek-ai/dsh-subagent-opencode'
  config:
    providerName: opencode
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: opencode, toolName: subagent, maxDepth: 'provider-managed' }
```

### 你会得到什么

成功的运行返回子任务的最终 assistant 文本作为结果输出。turn 的 idle 结果映射到 seam 词汇表：`succeeded` 变为 `completed`（`length` finish 映射为 `max-tokens`，`content-filter` 映射为 `refusal`），`failed` 变为带安全诊断的 `error`，`interrupted` 变为 `error`。父方取消时，`aborted` 结果保持为 aborted。

### 失败与恢复

发现失败（服务文件或凭据缺失）与工作目录失败会在发布前拒绝。`401`/`403` 响应映射为 `auth` 类别，网络失败映射为 `transport`，非 2xx 映射为带 HTTP 状态的 `product`。诊断只暴露固定的 product、stage、category 与 HTTP 状态——绝不暴露响应体、路径、任务内容或凭据。dispose 会尽力中断活跃运行，且从不停止 OpenCode 服务器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、发现、provider 注册 |
| [`src/run.ts`](src/run.ts) | 运行生命周期、输出选择与 stop-reason 映射 |
| [`src/client.ts`](src/client.ts) | REST 客户端：发现文件读取、Basic 鉴权、session/prompt/message/interrupt 调用 |
| [`src/failure.ts`](src/failure.ts) | 固定安全诊断与结构化运行失败 |
| [`src/types.ts`](src/types.ts) | 共享 wire 与配置类型 |

### 运行流程

start 解析工作目录、发现服务器并构建带 Basic 鉴权的客户端。它创建单个会话（`location` = 父工作区，外加配置的 title/agent/model/permissions），派发文本任务，然后轮询 `GET /api/session/{id}/message` 直到 idle 消息出现。输出为最后一个非空 assistant 消息的文本部分。HTTP JSON wire 是校验边界：畸形响应会被拒绝而非被信任。

-----

<a id="model-experience"></a>
## 模型体验

### 子 agent 请求

#### 模型看到什么

OpenCode 子任务的模型收到独立任务作为其用户消息，外加 OpenCode 服务器自身配置的系统提示、agent、工具与全新会话。它收不到任何父对话。

#### Token 影响

子任务为独立的完整上下文及其多步历史付费。这些 token 永不进入父上下文。

#### KV Cache 影响

与父请求缓存相互独立；OpenCode 服务器拥有子任务的缓存与历史。

### 父工具结果（间接）

#### 模型看到什么

通过 `dsh-tool-subagent`，父模型先收到子任务名称，随后收到包含最终或部分 assistant 文本、stop reason 与安全诊断的完成通知。

#### Token 影响

父输入因 start 确认与完成通知而增长，其大小取决于结果数据。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **仅本机服务器**——发现读取本机服务文件并复用服务器根密码；跨机委派需要 OpenCode 配对与 session token，本 provider 未实现。
- **轮询式收结果**——provider 轮询消息列表，不消费 `/api/event` SSE 流，因此超长 turn 只在观察到 idle 消息后才结束。
- **权限姿态尚未接入**——provider 以 OpenCode 服务器的默认权限姿态创建会话；显式的会话级 `permissions` 与固定 `model` 选择将推迟到其在运行中的服务器上验证语义后再接入。
- **此处未接入 LLM 代理**——把 OpenCode 子任务的 provider `baseURL` 指向 Seagull gateway 属于部署级 OpenCode 配置，而非本 provider 设置的字段。
