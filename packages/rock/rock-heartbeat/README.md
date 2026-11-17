# @rock/rock-heartbeat

Rock ConnectorClient 的心跳插件：解析 `rock-onboarding` 的 connector 身份，周期性向 Seagull ConnectorGateway 发送存活心跳，云端据此推导每个 Rock 的在线/离线状态并记录来源 IP。

## 用途

在 Rock preset 中挂载本插件，让云端知道该工作台在线。

```yaml
- id: rock-heartbeat
  name: '@rock/rock-heartbeat'
  config:
    heartbeatIntervalMs: 30000
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `heartbeatIntervalMs` | `30000` | 心跳间隔（毫秒） |

## 行为

- 每次心跳 `POST ${baseUrl}/v1/connectors/heartbeat`，携带 `Authorization: Bearer <connector key>`。
- 身份每次心跳时重新解析（`rock-onboarding.getRecord()`），未添加 key 时静默跳过；key 添加后自动开始。
- 心跳失败静默重试（下一周期重发），不影响工作台运行。
- 卸载时清理定时器。

## Known Limitations and Deferred Work

- 心跳间隔当前由 config 提供；云端在线判定窗口（默认 90s）在 Seagull 侧配置（`ROCK_ONLINE_WINDOW_MS`）。
- 心跳体为空，IP 由 Seagull 从请求源地址捕获。
