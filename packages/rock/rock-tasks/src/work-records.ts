/**
 * Durable per-task archive store. It writes one append-only JSONL file per
 * task under the Rock workspace (`tasks/<taskId>.jsonl` or
 * `projects/<projectId>/tasks/<taskId>.jsonl`), recording the task definition
 * snapshot, the execution events, and the terminal task receipt, and it scans
 * the workspace tree to index history for the task-detail and history panels.
 *
 * Reads go through the file so an executing bot's direct receipt append is
 * always visible; the in-memory maps are only a history index.
 *
 * @module @rock/rock-tasks/work-records
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ArchivedTaskSummary, TaskHeader, TaskReceipt, TaskSummary, TaskWorkRecord } from './types.ts'

/** Constructor options owned by the plugin's `apply`. */
export interface TaskArchiveOptions {
  /** Resolves a task's absolute archive file path. */
  resolvePath: (taskId: string, projectId?: string | null) => string
  /** The absolute workspace root, or null when not yet initialized. */
  rootPath: () => string | null
}

/** Parsed content of one task archive file. */
interface TaskFile {
  header: TaskHeader | null
  records: TaskWorkRecord[]
  receipt: TaskReceipt | null
  summary: TaskSummary | null
}

/** Map one harness session event into a work record, or null when not a tracked event. */
function eventRecord(sessionId: string, taskId: string, event: SessionEvent): TaskWorkRecord | null {
  switch (event.type) {
    case 'tool/call':
      return {
        taskId,
        sessionId,
        type: 'tool.call',
        timestamp: new Date().toISOString(),
        toolId: event.data.name,
        args: event.data.arguments,
        stepId: event.data.step,
      }
    case 'tool/result':
      return {
        taskId,
        sessionId,
        type: 'tool.result',
        timestamp: new Date().toISOString(),
        toolId: String(event.data.message.toolCallId),
        ok: event.data.message.isError !== true,
        ...(event.data.error?.reason === undefined ? {} : { error: event.data.error.reason }),
        stepId: event.data.step,
      }
    case 'step/start':
      return {
        taskId,
        sessionId,
        type: 'step.start',
        timestamp: new Date().toISOString(),
        turn: event.data.turn,
        stepId: event.data.step,
      }
    case 'step/end':
      return {
        taskId,
        sessionId,
        type: 'step.end',
        timestamp: new Date().toISOString(),
        turn: event.data.turn,
        stepId: event.data.step,
      }
    case 'turn/start':
      return {
        taskId,
        sessionId,
        type: 'turn.start',
        timestamp: new Date().toISOString(),
        turn: event.data.turn,
      }
    case 'turn/end':
      return {
        taskId,
        sessionId,
        type: 'turn.end',
        timestamp: new Date().toISOString(),
        turn: event.data.turn,
        reason: String(event.data.reason),
      }
    case 'assistant/message':
      return {
        taskId,
        sessionId,
        type: 'assistant.message',
        timestamp: new Date().toISOString(),
        turn: event.data.turn,
        stepId: event.data.step,
        text: messageText(event.data.message),
        ...(event.data.usage === undefined ? {} : { usage: event.data.usage }),
      }
    default:
      return null
  }
}

/** Best-effort plain-text projection of an assistant message. */
function messageText(message: unknown): string {
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

/** Append-only per-task archive store, keyed by taskId. */
export class TaskArchiveStore {
  private readonly sessionTask = new Map<string, string>()
  private readonly taskPath = new Map<string, string>()
  private readonly index = new Map<string, ArchivedTaskSummary & { createdAt: number }>()

  constructor(private readonly options: TaskArchiveOptions) {}

  /** Create the archive file for a task and record its definition + first run. */
  openTask(task: TaskSummary, botId: string, sessionId: string): void {
    const path = this.options.resolvePath(task.id, task.projectId || null)
    mkdirSync(dirname(path), { recursive: true })
    const header: TaskHeader = {
      type: 'task',
      version: 1,
      taskId: task.id,
      projectId: task.projectId || null,
      createdAt: Date.now(),
      cwd: this.options.rootPath() ?? '',
    }
    writeFileSync(path, `${JSON.stringify(header)}\n`, 'utf8')
    this.taskPath.set(task.id, path)
    this.linkSession(sessionId, task.id)
    this.appendLine(path, {
      taskId: task.id,
      type: 'task.definition',
      timestamp: new Date().toISOString(),
      data: task,
    })
    this.appendLine(path, {
      taskId: task.id,
      sessionId,
      type: 'run.start',
      timestamp: new Date().toISOString(),
      runId: sessionId,
      botId,
    })
  }

  /** Bind a launched session id to its task id. */
  linkSession(sessionId: string, taskId: string): void {
    this.sessionTask.set(sessionId, taskId)
  }

  /** Record one session event for the owning session, when it maps to a tracked task. */
  record(sessionId: string, event: SessionEvent): void {
    const taskId = this.sessionTask.get(sessionId)
    if (taskId === undefined) return
    const path = this.taskPath.get(taskId)
    if (path === undefined) return
    const record = eventRecord(sessionId, taskId, event)
    if (record === null) return
    this.appendLine(path, record)
  }

  /** Close the current run for a session (appended when a run settles). */
  endRun(sessionId: string): void {
    const taskId = this.sessionTask.get(sessionId)
    if (taskId === undefined) return
    const path = this.taskPath.get(taskId)
    if (path === undefined) return
    this.appendLine(path, {
      taskId,
      sessionId,
      type: 'run.end',
      timestamp: new Date().toISOString(),
      runId: sessionId,
    })
  }

  /** Append the terminal receipt for a task. */
  writeReceipt(taskId: string, receipt: TaskReceipt): void {
    const path = this.taskPath.get(taskId) ?? this.options.resolvePath(taskId, this.projectOf(taskId))
    mkdirSync(dirname(path), { recursive: true })
    this.appendLine(path, {
      taskId,
      type: 'task.receipt',
      timestamp: new Date().toISOString(),
      ...(receipt.usage === undefined ? {} : { usage: receipt.usage }),
      data: receipt,
    })
  }

  /** Append a receipt only when the archive has none yet (harness fallback). */
  ensureReceipt(taskId: string, receipt: TaskReceipt): void {
    const path = this.taskPath.get(taskId) ?? this.options.resolvePath(taskId, this.projectOf(taskId))
    const parsed = readTaskFile(path)
    if (parsed.receipt !== null) return
    this.writeReceipt(taskId, receipt)
  }

  /** Records for one task, read fresh from its archive file. */
  list(taskId: string): TaskWorkRecord[] {
    const path = this.taskPath.get(taskId) ?? this.options.resolvePath(taskId, this.projectOf(taskId))
    return readTaskFile(path).records
  }

  /** Replay persisted archives into the history index (across restarts). */
  replay(): void {
    this.refresh()
  }

  /** Index entries for the history tab, newest first (re-scanning the workspace). */
  listArchived(): ArchivedTaskSummary[] {
    this.refresh()
    return [...this.index.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ createdAt: _createdAt, ...entry }) => entry)
  }

  /** Full archive for one task: its summary plus all recorded lines. */
  getArchived(taskId: string): { summary: ArchivedTaskSummary | null; records: TaskWorkRecord[] } {
    const summary = this.index.get(taskId) ?? null
    const entry = summary === null
      ? null
      : {
        id: summary.id,
        projectId: summary.projectId,
        title: summary.title,
        status: summary.status,
        ...(summary.resolution === undefined ? {} : { resolution: summary.resolution }),
        ...(summary.executorId === undefined ? {} : { executorId: summary.executorId }),
        ...(summary.receipt === undefined ? {} : { receipt: summary.receipt }),
      }
    const path = this.taskPath.get(taskId) ?? this.options.resolvePath(taskId, this.projectOf(taskId))
    return { summary: entry, records: readTaskFile(path).records }
  }

  /** Project id remembered for a task (used when its file path must be re-resolved). */
  private projectOf(taskId: string): string | null {
    return this.index.get(taskId)?.projectId ?? null
  }

  /** Append one JSON line to an archive file. */
  private appendLine(path: string, record: TaskWorkRecord): void {
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
  }

  /** Re-scan the workspace tree and rebuild the history index. */
  private refresh(): void {
    const root = this.options.rootPath()
    if (root === null) return
    for (const path of scanTaskFiles(root)) {
      const parsed = readTaskFile(path)
      const summary = parsed.summary
      if (summary === null) continue
      this.taskPath.set(summary.id, path)
      this.index.set(summary.id, {
        id: summary.id,
        projectId: parsed.header?.projectId ?? summary.projectId ?? null,
        title: summary.title || summary.id,
        status: summary.status,
        createdAt: parsed.header?.createdAt ?? 0,
        ...(summary.resolution === undefined ? {} : { resolution: summary.resolution }),
        ...(summary.executorId === undefined ? {} : { executorId: summary.executorId }),
        ...(parsed.receipt === null ? {} : { receipt: parsed.receipt }),
      })
    }
  }
}

/** Parse one archive file into its header, records, definition summary, and receipt. */
function readTaskFile(path: string): TaskFile {
  const result: TaskFile = { header: null, records: [], receipt: null, summary: null }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return result
  }
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let record: TaskWorkRecord | TaskHeader
    try {
      record = JSON.parse(line) as TaskWorkRecord | TaskHeader
    } catch {
      continue
    }
    if (record.type === 'task') {
      result.header = record as TaskHeader
      continue
    }
    const work = record as TaskWorkRecord
    result.records.push(work)
    if (work.type === 'task.definition' && work.data !== undefined) {
      result.summary = work.data as TaskSummary
    }
    if (work.type === 'task.receipt' && work.data !== undefined) {
      result.receipt = work.data as TaskReceipt
    }
  }
  return result
}

/** Walk the workspace tree and return every task archive file path. */
function scanTaskFiles(root: string): string[] {
  const files: string[] = []
  const globalDir = join(root, 'tasks')
  if (existsSync(globalDir)) {
    for (const name of readdirSync(globalDir)) {
      if (name.endsWith('.jsonl')) files.push(join(globalDir, name))
    }
  }
  const projectsDir = join(root, 'projects')
  if (existsSync(projectsDir)) {
    for (const projectName of readdirSync(projectsDir)) {
      const projectTasksDir = join(projectsDir, projectName, 'tasks')
      if (existsSync(projectTasksDir)) {
        for (const name of readdirSync(projectTasksDir)) {
          if (name.endsWith('.jsonl')) files.push(join(projectTasksDir, name))
        }
      }
    }
  }
  return files
}
