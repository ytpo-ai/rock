# @rock/gateway-reporter

Rock ConnectorClient 的出站上报插件：订阅 Harness 的 `session/event` 事件流，给每条事件打上 Rock 溯源字段，批量 POST 到 Seagull 云端 ConnectorGateway，并用 JSONL 文件做离线缓冲 + 重启补传。

## 用途

在 Rock preset 中挂载本插件，把本地 agent 执行过程回流传给云端，供记忆整理 / 评价闭环消费。

```yaml
- id: gateway-reporter
  name: '@rock/gateway-reporter'
  config:
    gatewayUrl: http://127.0.0.1:3000/v1/connectors/report
    connectorClientId: rock-employee-a
    employeeId: employee-a
    bufferPath: .rock/events.jsonl
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `gatewayUrl` | — | 云端 Gateway 上报端点（POST batch） |
| `connectorClientId` | — | Rock 实例身份，打在每条事件上 |
| `employeeId` | — | 认领员工身份，打在每条事件上 |
| `bufferPath` | — | JSONL 离线缓冲文件（缺省则仅内存） |
| `flushIntervalMs` | `5000` | 定时 flush 间隔 |
| `maxBatchSize` | `100` | 每批最大事件数 |

## 出站事件（契约冻结）

复用 M3 事件 schema + Rock 溯源字段（见 `docs/technical/ROCK_CONNECTOR_CLIENT_DSH_EXTENSION.MD` §4）：

```ts
{ eventId, sessionId, type, timestamp, payload, employeeId?, connectorClientId, relayed: true }
```

- `eventId` 由 `sessionId:seq` 派生，幂等去重。
- 上报失败不丢事件，重启后从 `bufferPath` 补传。

## Known Limitations and Deferred Work

- `type` 目前透传 DSH 内部 session 事件类型；到 M3 四类（session.*/llm.*/tool.*/step.*）的映射为后续细化。
- 缓冲文件的 append 与 flush 重写之间可能短暂不一致（进程崩溃时个别事件可能重复/丢失），幂等 eventId 兜底去重。
- 长连接（WSS/MCP/A2A）未实现，第一版为短连接批量上报 + 定时拉取降级。
