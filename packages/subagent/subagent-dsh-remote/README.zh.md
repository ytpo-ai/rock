---
description: "dsh web Remote API 子代理后端：面向选择委派 provider、配置运行中的 dsh web Host 或排查本地嵌套子运行的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-dsh-remote

[English](README.md) | 中文

## 摘要

`dsh-subagent-dsh-remote` 把每个委派任务运行在单独运行的 `dsh web` Host 的一个会话中。provider 用 Host 的 launch token 连接（换取签名 cookie），在父工作区创建会话，派发纯文本任务，并轮询 `session/wait` 直到该 turn 到达停止状态。它从不拉起或停止 Host，会话保留在共享 Host 上，因此 dsh Web GUI 可以看到它。当委派应运行在持久 Host 上的完整 Harness 会话、而非 Harness 管理的子进程时，选择此后端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选择它

当子任务必须是单独运行的 `dsh web` Host 上的完整 Harness 会话——拥有自己的 preset、模型、工具和可在 dsh Web GUI 中看到的持久化转写——而不是 Harness 管理的进程时，选择此后端。provider 不声明任何 start-time 能力（`agentOptions`/`agentPreset`/`outputSchema`/`depthLimit` 均为 false），且 `inheritsParentContext: false`。父方请求不支持的 capability 时会在 start 阶段被拒绝。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `dsh-remote` | `ctx.subagents` 上的注册名 |
| `baseUrl` | `http://127.0.0.1:3080` | `dsh web` Host 基础 URL（不含末尾斜杠） |
| `token` | — | Host launch token（打印在 Host 启动 URL 中） |
| `agentPreset` | — | 为创建的会话固定的子 preset id |
| `waitTimeoutMs` | `30000` | 每次 `session/wait` 轮询的截止时间 |

launch token 只打印在 Host 的 stdout 启动 URL 里（`dsh web: http://127.0.0.1:3080/?token=...`）；在此通过部署环境传入。token 缺失或无效会在 start 阶段以 `auth` 诊断失败。

```yaml
- id: subagent-dsh-remote
  name: '@deepseek-ai/dsh-subagent-dsh-remote'
  config:
    providerName: dsh-remote
    baseUrl: http://127.0.0.1:3080
    token: !!js process.env.ROCK_DSH_REMOTE_TOKEN
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: dsh-remote, toolName: subagent, maxDepth: 'provider-managed' }
```

### 你会得到什么

成功的运行返回子任务的最终 assistant 文本作为结果输出。`session/wait` 的停止条件映射到 seam 词汇表：`idle` 变为 `completed`，`input-required` 变为带安全诊断的 `error`。父方取消时，`aborted` 结果保持为 aborted。

### 失败与恢复

工作目录失败、token 缺失与 connect/鉴权失败会在发布前拒绝。非 2xx 的 connect 映射为 `auth`，网络失败映射为 `transport`，Remote 错误码映射为 `gateway`。诊断只暴露固定的 product、stage、category、HTTP 状态与 Remote code——绝不暴露错误消息、路径、任务内容或凭据。dispose 会尽力取消活跃 turn，且从不停止 Host。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、连接、provider 注册 |
| [`src/run.ts`](src/run.ts) | 运行生命周期与停止条件映射 |
| [`src/client.ts`](src/client.ts) | Typert unary 客户端：token→cookie、信封、会话调用、输出提取 |
| [`src/failure.ts`](src/failure.ts) | 固定安全诊断与结构化运行失败 |
| [`src/types.ts`](src/types.ts) | 共享 wire 与配置类型 |

### 运行流程

start 解析工作目录、用 launch token 换取签名 cookie，并通过 Typert unary 协议连接 Host。它创建单个会话（`cwd` = 父工作区，外加配置的 preset），派发文本任务，然后轮询 `session/wait` 直到停止条件为 `idle` 或 `input-required`。输出为最新非空已提交 `assistant/message` 事件的文本部分。HTTP JSON wire 是校验边界：畸形信封或响应会被拒绝而非被信任。

-----

<a id="model-experience"></a>
## 模型体验

### 子 agent 请求

#### 模型看到什么

dsh web 子任务的模型收到独立任务作为其用户消息，外加 Host 自身配置的 preset、系统提示、工具与全新会话。它收不到任何父对话。

#### Token 影响

子任务为独立的完整上下文及其多步历史付费。这些 token 永不进入父上下文。

#### KV Cache 影响

与父请求缓存相互独立；Host 拥有子任务的缓存与历史。

### 父工具结果（间接）

#### 模型看到什么

通过 `dsh-tool-subagent`，父模型先收到子任务名称，随后收到包含最终或部分 assistant 文本、stop reason 与安全诊断的完成通知。

#### Token 影响

父输入因 start 确认与完成通知而增长，其大小取决于结果数据。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **launch token 只能从 stdout 获取**——Host 仅通过启动 URL 暴露其 token，因此部署必须捕获该 URL 并经环境传入 token；没有文件或 CLI 出口。
- **unary 式收结果**——provider 轮询 `session/wait`，不消费 `session/follow` 的 WebSocket 流，且不从会话级 `idle` 条件区分模型级 stop reason（`max-tokens` vs `completed`）。
- **交互输入不被应答**——provider 以 `interactions=none` 连接，并把 `input-required` 的 wait 映射为 `error`；若子任务的 preset 请求交互式审批，则会阻塞而非自动批准。
- **无会话销毁端点**——Remote API 没有 dispose/close，因此 dispose 只取消 turn 并让会话驻留在共享 Host 上。
