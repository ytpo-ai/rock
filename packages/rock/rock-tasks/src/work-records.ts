/**
 * Durable per-task agent-tool work-record store. It persists `tool.call` /
 * `tool.result` records keyed by taskId to a JSONL file (append-only, never
 * cleared on report flush) and serves them back by task for the task-detail
 * panel.
 *
 * @module @rock/rock-tasks/work-records
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TaskWorkRecord } from './types.ts'

/** Map one harness tool event into a work record, or null when not a tool event. */
function toolRecord(sessionId: string, taskId: string, event: SessionEvent): TaskWorkRecord | null {
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
    default:
      return null
  }
}

/** Append-only durable work-record store, keyed by taskId. */
export class TaskWorkRecordStore {
  private readonly sessionTask = new Map<string, string>()
  private readonly records = new Map<string, TaskWorkRecord[]>()

  constructor(private readonly filePath?: string) {}

  /** Replay persisted records into memory (offline durability across restarts). */
  replay(): void {
    if (this.filePath === undefined || !existsSync(this.filePath)) return
    const raw = readFileSync(this.filePath, 'utf8')
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        this.push(JSON.parse(line) as TaskWorkRecord, false)
      } catch {
        // Skip a malformed line; the durable log is best-effort.
      }
    }
  }

  /** Bind a launched session id to its task id. */
  linkSession(sessionId: string, taskId: string): void {
    this.sessionTask.set(sessionId, taskId)
  }

  /** Record one tool event for the owning session, when it maps to a tracked task. */
  record(sessionId: string, event: SessionEvent): void {
    const taskId = this.sessionTask.get(sessionId)
    if (taskId === undefined) return
    const record = toolRecord(sessionId, taskId, event)
    if (record === null) return
    this.push(record, true)
  }

  /** Records for one task, in insertion order. */
  list(taskId: string): TaskWorkRecord[] {
    return this.records.get(taskId) ?? []
  }

  private push(record: TaskWorkRecord, persist: boolean): void {
    const list = this.records.get(record.taskId) ?? []
    list.push(record)
    this.records.set(record.taskId, list)
    if (persist && this.filePath !== undefined) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    }
  }
}
