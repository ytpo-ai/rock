/**
 * Rock local log store: an append-only JSONL log that rotates by file size and
 * keeps a bounded in-memory ring for fast recent reads. Full-history paging
 * reads the active file plus its rotated fragments once into a newest-first
 * cache. Disk IO is best-effort: a failed write or read never breaks the caller.
 *
 * @module @rock/rock-log-store
 */
import { appendFile, mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/** Defaults keep one fragment small and the UI read bounded. */
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_ENTRIES = 500
const DEFAULT_MAX_FRAGMENTS = 10

/** Construction options for {@link RotatingJsonlLog}. */
export interface RotatingJsonlLogOptions<T> {
  /** Path of the active JSONL file; rotated fragments sit beside it. */
  path: string
  /** Read one entry's filter key (e.g. the agent bot id), enabling keyed paging. */
  keyOf?: (entry: T) => string
  /** Rotate the active file before a write would exceed this byte size. */
  maxFileBytes?: number
  /** Keep at most this many entries in the in-memory ring. */
  maxEntries?: number
  /** Keep at most this many rotated fragments on disk. */
  maxFragments?: number
  /** Report a failed disk operation; the store stays silent when omitted. */
  onError?: (error: unknown) => void
}

/** Append-only, size-rotating JSONL log with a bounded ring and newest-first paging. */
export class RotatingJsonlLog<T> {
  private readonly entries: T[] = []
  private readonly maxFileBytes: number
  private readonly maxEntries: number
  private readonly maxFragments: number
  private readonly activePath: string
  private readonly keyOf: ((entry: T) => string) | undefined
  private readonly onError: ((error: unknown) => void) | undefined
  private activeSize = 0
  private seq = 0
  private fragments: number[] = []
  private fullCache: T[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: RotatingJsonlLogOptions<T>) {
    this.activePath = options.path
    this.keyOf = options.keyOf
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxFragments = options.maxFragments ?? DEFAULT_MAX_FRAGMENTS
    this.onError = options.onError
  }

  /**
   * Record one entry into the ring, the full-history cache, and (best-effort) the JSONL.
   * @param entry - the entry to record; persistence failures are reported through `onError`.
   */
  append(entry: T): void {
    this.entries.push(entry)
    while (this.entries.length > this.maxEntries) this.entries.shift()
    if (this.fullCache !== null) this.fullCache.unshift(entry)
    this.writeChain = this.writeChain.then(() => this.persist(entry))
  }

  /**
   * Most recent entries, newest first.
   * @returns the in-memory ring, newest first.
   */
  recent(): T[] {
    return [...this.entries].reverse()
  }

  /**
   * Total persisted entries, optionally scoped to one key.
   * @param key - filter to entries whose `keyOf` value equals this; omitted counts every entry.
   * @returns the number of persisted entries in scope.
   */
  async count(key?: string): Promise<number> {
    return scoped(await this.history(), this.keyOf, key).length
  }

  /**
   * Distinct keys across the persisted history, newest first-seen first.
   * @returns the distinct `keyOf` values, or an empty list when no `keyOf` was supplied.
   */
  async keys(): Promise<string[]> {
    const keyOf = this.keyOf
    if (keyOf === undefined) return []
    const seen = new Set<string>()
    for (const entry of await this.history()) seen.add(keyOf(entry))
    return [...seen]
  }

  /**
   * One newest-first page of persisted entries.
   * @param offset - 0-based number of in-scope entries to skip.
   * @param limit - maximum entries to return.
   * @param key - filter to entries whose `keyOf` value equals this; omitted pages every entry.
   * @returns the requested page, newest first.
   */
  async page(offset: number, limit: number, key?: string): Promise<T[]> {
    return scoped(await this.history(), this.keyOf, key).slice(offset, offset + limit)
  }

  /**
   * Resolve once all pending disk writes have settled (tests and graceful shutdown).
   * @returns a promise settling after the last queued write.
   */
  flush(): Promise<void> {
    return this.writeChain
  }

  /**
   * Seed the ring, current size, and fragment set from disk (best-effort on boot).
   * @returns a promise settling once the boot read finished.
   */
  async load(): Promise<void> {
    await this.scanFragments()
    let raw: string
    try {
      raw = await readFile(this.activePath, 'utf8')
    } catch {
      // A missing active file just means no history yet.
      return
    }
    this.activeSize = raw.length
    this.entries.length = 0
    this.entries.push(...parseLines<T>(raw).slice(-this.maxEntries))
  }

  /** The newest-first full-history cache, built on first read. */
  private async history(): Promise<T[]> {
    await this.buildFullCache()
    return this.fullCache ?? []
  }

  /** Build the newest-first full-history cache once, reading active + fragments in order. */
  private async buildFullCache(): Promise<void> {
    if (this.fullCache !== null) return
    // Entries appended since the last disk write live only in the ring; settle
    // them first so a cache built at that moment still covers the whole history.
    await this.writeChain
    const all: T[] = []
    for (const file of this.orderedFiles()) {
      try {
        all.push(...parseLines<T>(await readFile(file, 'utf8')).reverse())
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
      // A missing log directory means no history yet; fragments stay empty.
    }
  }

  private async persist(entry: T): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`
    try {
      if (this.activeSize > 0 && this.activeSize + line.length > this.maxFileBytes) {
        await this.rotate()
      }
      await mkdir(dirname(this.activePath), { recursive: true })
      await appendFile(this.activePath, line, 'utf8')
      this.activeSize += line.length
    } catch (error) {
      // Log persistence must never break the caller; report and drop on failure.
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

/** Narrow a newest-first history to one key, or return it unchanged when no key is selected. */
function scoped<T>(entries: T[], keyOf: ((entry: T) => string) | undefined, key: string | undefined): T[] {
  if (key === undefined || key === '' || keyOf === undefined) return entries
  return entries.filter(entry => keyOf(entry) === key)
}

/** Parse one JSONL string into entries, skipping blank or malformed lines. */
function parseLines<T>(raw: string): T[] {
  const parsed: T[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      parsed.push(JSON.parse(line) as T)
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
