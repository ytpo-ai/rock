/**
 * Assistant-LLM detection vocabulary: build the dedicated-assistant probe
 * prompt, parse its JSON answer into tool statuses, merge assistant results
 * over the fast `--version` probe, and track which targets a shell command
 * touches. Pure functions so the controller stays thin and the logic is
 * unit-testable without a live LLM.
 *
 * @module @rock/rock-tool-inventory/detect
 */
import type { DebugResult, ToolDescriptor, ToolStatus } from './types.ts'

/**
 * Build the dedicated-assistant probe prompt for the given tools.
 * @param tools - probe targets.
 * @returns a prompt that asks for a strict JSON array.
 */
export function detectPrompt(tools: readonly ToolDescriptor[]): string {
  const ids = tools.map(tool => tool.id).join(', ')
  return [
    '执行器检测',
    '',
    '你是员工工作台的专属助理。请探测以下执行器是否已安装、以及是否有长驻服务/daemon 或监听端口正在运行：',
    ids,
    '',
    '对每个执行器：',
    '- installed：运行 `which <command>` 或 `<command> --version` 判断是否已安装；',
    '- running：判断是否有长驻服务/daemon 或监听端口在运行（如 `pgrep -f`、`lsof -i`、端口健康检查等）。',
    '',
    '完成后输出两部分：',
    '1. 一个 Markdown 表格，列：执行器 | 是否安装 | 是否运行 | 版本；',
    '2. 一个 ```json 代码块，内含 JSON 数组，每个元素为 {"id":"<执行器id>","installed":true/false,"running":true/false,"version":"<版本或省略>"}。',
  ].join('\n')
}

/** Extract the first JSON array literal from assistant output, or null. */
export function extractJsonArray(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced?.[1] === undefined ? text : fenced[1]
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Extract the first JSON object literal from assistant output, or null. */
function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced?.[1] === undefined ? text : fenced[1]
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Build the dedicated-assistant debug prompt for one tool. Asks the assistant
 * to smoke-test the tool's resident service/daemon channel (the way Rock
 * delegates tasks to it), diagnose a failure, attempt a fix (or request human
 * action through `ask-user`), re-test, and report a strict JSON object. It
 * deliberately forbids the one-shot CLI-subprocess shortcut, which bypasses the
 * product's service-communication model.
 * @param tool - the probe target to debug.
 * @returns a prompt that asks for a single JSON object.
 */
export function debugPrompt(tool: ToolDescriptor): string {
  const lines = [
    '执行器调试',
    '',
    `你是员工工作台的专属助理。请调试执行器「${tool.id}」的「服务通信」通道——即 Rock 委派任务给它的常驻服务/daemon，而不是一次性 CLI 子进程。`,
    '',
  ]
  if (tool.serviceHint !== undefined && tool.serviceHint !== '') {
    lines.push(`服务通信方式：${tool.serviceHint}`, '')
  }
  lines.push(
    '步骤：',
    '1. 冒烟测试：走上述服务通道实际派发一个最小任务并收回结果（用 curl/HTTP 或对应 socket/端口探测，验证「建会话 → 派发 → 收结果」全链路）；',
    '2. 诊断：若失败，定位原因（服务未启动、端口/socket 不可达、token/凭据缺失或过期、配置错误等）；',
    '3. 修复：尝试可行的修复（启动常驻服务、补齐凭据、修正配置等）；需要人工操作（如粘贴 token/key）时用 ask-user 明确请求；',
    '4. 复测：修复后重新走服务通道冒烟，确认真正跑通。',
    '',
    '注意：不要用「' + tool.command + ' …」拉起全新的一次性子进程冒烟；目标是与外部工具的服务通信通道本身。',
  )
  if (tool.installDocUrl !== undefined && tool.installDocUrl !== '') {
    lines.push(`安装文档：${tool.installDocUrl}`)
  }
  lines.push(
    '',
    '最后输出一个 ```json 代码块，内含单个 JSON 对象：',
    '{"ok": true/false, "summary": "<一句话结论>", "diagnostic": "<失败原因或下一步，成功时省略>"}',
  )
  return lines.join('\n')
}

/**
 * Parse the assistant's debug JSON object into a result for the known tool.
 * A missing or malformed object settles as `ok: false` with no summary so the
 * controller still records the run without throwing.
 * @param text - assistant message text.
 * @param tool - the probe target that was debugged.
 * @returns the debug result, always carrying the tool id.
 */
export function parseDebugResult(text: string, tool: ToolDescriptor): DebugResult {
  const raw = extractJsonObject(text)
  const finishedAt = new Date().toISOString()
  if (raw === null || typeof raw !== 'object') return { id: tool.id, ok: false, finishedAt }
  const record = raw as { ok?: unknown; summary?: unknown; diagnostic?: unknown }
  const summary = typeof record.summary === 'string' && record.summary.length > 0 ? record.summary : undefined
  const diagnostic = typeof record.diagnostic === 'string' && record.diagnostic.length > 0 ? record.diagnostic : undefined
  return {
    id: tool.id,
    ok: record.ok === true,
    ...(summary === undefined ? {} : { summary }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    finishedAt,
  }
}

/**
 * Parse the assistant's JSON array into statuses for the known tools. Unknown
 * ids and entries without a boolean `installed` are dropped.
 * @param text - assistant message text.
 * @param tools - probe targets (determines the accepted id set).
 * @returns assistant-detected statuses, possibly empty.
 */
export function parseDetectStatuses(text: string, tools: readonly ToolDescriptor[]): ToolStatus[] {
  const raw = extractJsonArray(text)
  if (!Array.isArray(raw)) return []
  const known = new Set(tools.map(tool => tool.id))
  const installDocById = new Map(tools.map(tool => [tool.id, tool.installDocUrl]))
  const now = new Date().toISOString()
  const out: ToolStatus[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const id = (item as { id?: unknown }).id
    const installed = (item as { installed?: unknown }).installed
    const running = (item as { running?: unknown }).running
    const version = (item as { version?: unknown }).version
    if (typeof id !== 'string' || !known.has(id)) continue
    if (typeof installed !== 'boolean') continue
    const installDocUrl = installDocById.get(id)
    out.push({
      id,
      installed,
      ...(typeof running === 'boolean' ? { running } : {}),
      ...(typeof version === 'string' && version.length > 0 ? { version } : {}),
      ...(installDocUrl === undefined || installDocUrl === '' ? {} : { installDocUrl }),
      lastCheckedAt: now,
      detectedBy: 'assistant',
    })
  }
  return out
}

/** Merge assistant results over the fast probe, keeping declaration order. */
export function mergeStatuses(fast: readonly ToolStatus[], assistant: readonly ToolStatus[]): ToolStatus[] {
  const assistantById = new Map(assistant.map(status => [status.id, status]))
  return fast.map(status => assistantById.get(status.id) ?? status)
}

/** The tool ids whose CLI command appears as a token in one executed shell command. */
export function touchedToolIds(command: string, tools: readonly ToolDescriptor[]): ReadonlySet<string> {
  const touched = new Set<string>()
  for (const tool of tools) {
    if (hasToken(command, tool.command)) touched.add(tool.id)
  }
  return touched
}

/** Whether `token` appears in `text` as a whole alphanumeric token. */
function hasToken(text: string, token: string): boolean {
  if (token.length === 0) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`).test(text)
}

/** Best-effort plain-text projection of an assistant message. */
export function assistantMessageText(message: unknown): string {
  if (message === null || message === undefined) return ''
  const content = (message as { content?: unknown }).content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const text = (block as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      })
      .filter(text => text.length > 0)
      .join('\n')
  }
  return JSON.stringify(message)
}

/** Best-effort command string from a shell tool-call argument (JSON string or object). */
export function commandOf(args: unknown): string | undefined {
  let parsed: unknown = args
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const command = (parsed as { command?: unknown }).command
  return typeof command === 'string' ? command : undefined
}
