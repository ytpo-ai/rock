/**
 * Assistant-LLM detection vocabulary: build the dedicated-assistant probe
 * prompt, parse its JSON answer into tool statuses, merge assistant results
 * over the fast `--version` probe, and track which targets a shell command
 * touches. Pure functions so the controller stays thin and the logic is
 * unit-testable without a live LLM.
 *
 * @module @rock/rock-tool-inventory/detect
 */
import type { DebugResult, ToolClientType, ToolConnectionConfig, ToolConnectionPatch, ToolDescriptor, ToolStatus } from './types.ts'

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
    '你是员工工作台的专属助理。请检测以下执行器是否已安装、以及是否有长驻服务/daemon 或监听端口正在运行：',
    ids,
    '',
    '先在你的技能目录中检索工具检测相关 skill（`rock-tool-detect` 与对应 `rock-runner-<tool>`），取回全文后按其方法执行。',
    '',
    '完成后输出两部分：',
    '1. 一个 Markdown 表格，列：执行器 | 是否安装 | 是否运行 | 版本 | 客户端类型；',
    '2. 一个 ```json 代码块，内含 JSON 数组，每个元素为 {"id":"<执行器id>","installed":true/false,"running":true/false,"version":"<版本或省略>","clientType":"gui|tui（能确定才填）","rootDir":"<根目录或省略>","startupCommand":"<启动命令或省略>"}。clientType/rootDir/startupCommand 若能确定就填，不能确定则省略。',
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
 * @param connection - the user-supplied url/token, when configured.
 * @returns a prompt that asks for a single JSON object.
 */
export function debugPrompt(tool: ToolDescriptor, connection?: ToolConnectionConfig): string {
  const lines = [
    '执行器调试',
    '',
    `你是员工工作台的专属助理。请调试执行器「${tool.id}」的「服务通信」通道——即 Rock 委派任务给它的常驻服务/daemon，而不是一次性 CLI 子进程。`,
    '',
  ]
  if (connection !== undefined && connection.url !== undefined) {
    lines.push(`连接地址（已配置）：${connection.url}`)
  } else {
    lines.push('连接地址未配置，请自行检测（探测监听端口、读发现文件）。')
  }
  if (connection !== undefined && connection.token !== undefined) {
    lines.push(`连接凭据（已配置）：${connection.token}`)
  } else if (tool.requiresToken === true) {
    lines.push('连接凭据（token）未配置，请用 ask-user 请求用户提供 token 后再继续。')
  } else {
    lines.push('连接凭据未配置，请自行从发现文件读取。')
  }
  if (connection !== undefined && connection.clientType !== undefined) {
    lines.push(`客户端类型（已配置）：${connection.clientType === 'gui' ? '界面客户端' : 'TUI'}`)
  }
  if (connection !== undefined && connection.rootDir !== undefined) {
    lines.push(`根目录（已配置）：${connection.rootDir}`)
  }
  if (connection !== undefined && connection.startupCommand !== undefined) {
    lines.push(`启动命令（已配置）：${connection.startupCommand}`)
  }
  lines.push(
    '',
    '先在你的技能目录中检索该执行器的调试 skill（`rock-runner-<tool>`），取回全文后按其协议与步骤执行。',
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

/**
 * Parse the assistant's JSON array into connection patches (clientType /
 * rootDir / startupCommand) for the known tools. Unknown ids and entries with
 * no patch fields are dropped; a reported clientType must be a known value and
 * the string fields must be non-empty.
 * @param text - assistant message text.
 * @param tools - probe targets (determines the accepted id set).
 * @returns connection patches, possibly empty.
 */
export function parseDetectConnectionPatches(text: string, tools: readonly ToolDescriptor[]): ToolConnectionPatch[] {
  const raw = extractJsonArray(text)
  if (!Array.isArray(raw)) return []
  const known = new Set(tools.map(tool => tool.id))
  const out: ToolConnectionPatch[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !known.has(id)) continue
    const clientType = parseClientType((item as { clientType?: unknown }).clientType)
    const rootDir = nonEmptyString((item as { rootDir?: unknown }).rootDir)
    const startupCommand = nonEmptyString((item as { startupCommand?: unknown }).startupCommand)
    if (clientType === undefined && rootDir === undefined && startupCommand === undefined) continue
    out.push({
      id,
      ...(clientType === undefined ? {} : { clientType }),
      ...(rootDir === undefined ? {} : { rootDir }),
      ...(startupCommand === undefined ? {} : { startupCommand }),
    })
  }
  return out
}

/** A known client-type value, or undefined for anything else. */
function parseClientType(value: unknown): ToolClientType | undefined {
  return value === 'gui' || value === 'tui' ? value : undefined
}

/** A non-empty string value, or undefined. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
