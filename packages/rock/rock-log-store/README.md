# @rock/rock-log-store

Rock 本地日志存储：**按大小滚动的 appender-only JSONL 日志** + 有界内存环 + 跨「活动文件 + 已滚动分片」的 newest-first 翻页。Rock 的转发日志（`rock-llm-relay`）与 LLM adapter 请求日志（`cloud-llm-adapter`）共用这一份实现。

## 用途

给 Rock 插件提供统一的本地可观测落盘：写日志不阻断主链路，读日志能翻完整历史。

```ts
const store = new RotatingJsonlLog<RelayForwardLog>({
  path: '../.rock/llm-relay-logs.jsonl',
  keyOf: entry => entry.agentBotId,
  onError: error => { ctx.logger.warn(`failed to persist log: ${String(error)}`) },
})
await store.load()
store.append(entry)
const page = await store.page(0, 50, 'agent-bot-a')
```

## API

| 成员 | 说明 |
|---|---|
| `append(entry)` | 写入内存环 + 前插全量缓存 + 异步落盘（不等待） |
| `recent()` | 内存环内容，newest first |
| `count(key?)` | 落盘条目总数，可按 key 过滤 |
| `page(offset, limit, key?)` | 一页 newest-first 条目；`offset` 为 0 基跳过数 |
| `keys()` | 历史中出现过的 key（newest first-seen 去重）；未配置 `keyOf` 时为空 |
| `load()` | 启动时从磁盘恢复内存环、活动文件大小与分片集合 |
| `flush()` | 等待所有待写盘操作落定（测试与优雅退出） |

## 行为

- **滚动**：单文件超过 `maxFileBytes`（默认 1MB）时把活动文件改名为 `<name>.<seq>.jsonl`，只保留最近 `maxFragments`（默认 10）个分片。
- **内存环**：默认保留最近 `maxEntries`（500）条，供快速读最近日志。
- **全量翻页**：首次 `page`/`count`/`keys` 时按「活动文件 → 分片降序」读取并构建 newest-first 缓存；`append` 时前插缓存。
- **失败容忍**：写盘/读盘失败只经 `onError` 上报，不抛出——日志不能影响被观测的主链路。

## Known Limitations and Deferred Work

- 全量缓存首次构建会把活动文件与最多 `maxFragments` 个分片（默认约 11MB 上限）读入内存；调大上限需重新评估内存占用。
- 读日志时会跳过被截断或格式损坏的行（例如进程在写一半时被杀）；这些行不计入 `count()`，不做修复。
- 按 key 过滤在内存里做，磁盘上无索引；历史量级超出默认上限后需改为分片级预筛选。
