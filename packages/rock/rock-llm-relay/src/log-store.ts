/**
 * Size-rotating JSONL log for relay forwards. Keeps a bounded in-memory ring
 * for fast recent reads and a lazily built newest-first cache for full-history
 * paging across the active file and its rotated fragments. Disk IO is
 * best-effort: a failed write or read never breaks forwarding.
 *
 * @module @rock/rock-llm-relay/log-store
 */
import { appendFile, mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { RelayForwardLog } from './types.ts'

/** Defaults keep one fragment small and the UI read bounded. */
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_ENTRIES = 500
const DEFAULT_MAX_FRAGMENTS = 10

/** Owns the append-only relay forward log: in-memory ring + rotating JSONL + full-history cache. */
export class RelayLogStore {
  private readonly entries: RelayForwardLog[] = []
  private readonly maxFileBytes: number
  private readonly maxEntries: number
  private readonly maxFragments: number
  private readonly activePath: string
  private readonly onError: ((error: unknown) => void) | undefined
  private activeSize = 0
  private seq = 0
  private fragments: number[] = []
  private fullCache: RelayForwardLog[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    path: string,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxFragments = DEFAULT_MAX_FRAGMENTS,
    onError?: (error: unknown) => void,
  ) {
    this.activePath = path
    this.maxFileBytes = maxFileBytes
    this.maxEntries = maxEntries
    this.maxFragments = maxFragments
    this.onError = onError
  }

  /** Record one entry into the ring, the full-history cache, and (best-effort) the JSONL. */
  append(entry: RelayForwardLog): void {
    this.entries.push(entry)
    while (this.entries.length > this.maxEntries) this.entries.shift()
    if (this.fullCache !== null) this.fullCache.unshift(entry)
    this.writeChain = this.writeChain.then(() => this.persist(entry))
  }

  /** Most recent entries, newest first. */
  recent(): RelayForwardLog[] {
    return [...this.entries].reverse()
  }

  /** Total persisted entries across the active file and rotated fragments. */
  async count(): Promise<number> {
    await this.buildFullCache()
    return this.fullCache?.length ?? 0
  }

  /** One newest-first page of persisted entries; `offset` is a 0-based skip. */
  async page(offset: number, limit: number): Promise<RelayForwardLog[]> {
    await this.buildFullCache()
    return this.fullCache?.slice(offset, offset + limit) ?? []
  }

  /** Resolve once all pending disk writes have settled (tests and graceful shutdown). */
  flush(): Promise<void> {
    return this.writeChain
  }

  /** Seed the ring, current size, and fragment set from disk (best-effort on boot). */
  async load(): Promise<void> {
    await this.scanFragments()
    let raw: string
    try {
      raw = await readFile(this.activePath, 'utf8')
    } catch {
      return
    }
    this.activeSize = raw.length
    this.entries.length = 0
    this.entries.push(...parseLines(raw).slice(-this.maxEntries))
  }

  /** Build the newest-first full-history cache once, reading active + fragments in order. */
  private async buildFullCache(): Promise<void> {
    if (this.fullCache !== null) return
    const all: RelayForwardLog[] = []
    for (const file of this.orderedFiles()) {
      try {
        all.push(...parseLines(await readFile(file, 'utf8')).reverse())
      } catch {
        // A missing or unreadable fragment contributes nothing.
      }
    }
    this.fullCache = all
  }

  /** Newest-first file order: active file, then rotated fragments newest → oldest. */
  private orderedFiles(): string[] {
    const rotated = [...this.fragments].sort((a, b) => b - a).map(seq => fragmentPath(this.activePath, seq))
    return [this.activePath, ...rotated]
  }

  /** Discover existing rotated fragments and resume `seq` past the newest one. */
  private async scanFragments(): Promise<void> {
    try {
      const dir = dirname(this.activePath)
      const base = basename(this.activePath)
      const dot = base.lastIndexOf('.')
      const prefix = dot <= 0 ? base : base.slice(0, dot)
      const suffix = dot <= 0 ? '' : base.slice(dot)
      const seqs: number[] = []
      for (const name of await readdir(dir)) {
        const mid = fragmentSeq(name, prefix, suffix)
        if (mid !== null) seqs.push(mid)
      }
      seqs.sort((a, b) => a - b)
      this.fragments = seqs
      this.seq = seqs.at(-1) ?? 0
    } catch {
      // A missing directory is fine; fragments stay empty.
    }
  }

  private async persist(entry: RelayForwardLog): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`
    try {
      if (this.activeSize > 0 && this.activeSize + line.length > this.maxFileBytes) {
        await this.rotate()
      }
      await mkdir(dirname(this.activePath), { recursive: true })
      await appendFile(this.activePath, line, 'utf8')
      this.activeSize += line.length
    } catch (error) {
      // Log persistence must never break forwarding; report and drop on failure.
      this.onError?.(error)
    }
  }

  private async rotate(): Promise<void> {
    this.seq += 1
    this.fragments.push(this.seq)
    this.fragments.sort((a, b) => a - b)
    try {
      await rename(this.activePath, fragmentPath(this.activePath, this.seq))
    } catch {
      // Rename failed (e.g. the active file vanished); continue with a fresh active.
    }
    this.activeSize = 0
    while (this.fragments.length > this.maxFragments) {
      const oldest = this.fragments.shift()
      if (oldest === undefined) break
      try {
        await unlink(fragmentPath(this.activePath, oldest))
      } catch {
        // A missing oldest fragment is fine.
      }
    }
  }
}

/** Parse one JSONL string into entries, skipping blank or malformed lines. */
function parseLines(raw: string): RelayForwardLog[] {
  const parsed: RelayForwardLog[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      parsed.push(JSON.parse(line) as RelayForwardLog)
    } catch {
      // Skip a torn or malformed line without dropping the rest.
    }
  }
  return parsed
}

/** Return the rotation sequence number a directory entry names, or `null`. */
function fragmentSeq(name: string, prefix: string, suffix: string): number | null {
  if (!name.startsWith(`${prefix}.`) || !name.endsWith(suffix)) return null
  const mid = name.slice(prefix.length + 1, name.length - suffix.length)
  return /^\d+$/.test(mid) ? Number(mid) : null
}

/** Insert a rotation sequence number before the file extension, e.g. `x.jsonl` → `x.1.jsonl`. */
function fragmentPath(basePath: string, seq: number): string {
  const dot = basePath.lastIndexOf('.')
  if (dot <= basePath.lastIndexOf('/')) return `${basePath}.${seq}`
  return `${basePath.slice(0, dot)}.${seq}${basePath.slice(dot)}`
}
