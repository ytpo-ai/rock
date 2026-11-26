/**
 * Shared reading state for the Rock console's log tables: one newest-first page
 * plus optional older pages, a manual reload, and a bot scope. Both the relay
 * forward log and the adapter request log read through the same state so their
 * tables behave identically.
 *
 * @module @rock/rock-observability/client/paged-logs
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Distance from the scroll bottom, in pixels, that requests one older page. */
const LOAD_OLDER_THRESHOLD = 64

/** Page-size presets the console offers beside the manual entry. */
export const PAGE_SIZE_PRESETS: readonly number[] = [20, 50, 100, 200]
/** Default page size before the operator changes it. */
export const DEFAULT_PAGE_SIZE = 50
/** Largest page size the manual entry accepts. */
export const MAX_PAGE_SIZE = 500

/** One log table's reading state. */
export interface PagedLogs<Entry> {
  /** Loaded entries, newest first. */
  entries: Entry[]
  /** Matching entries across the whole log, or null before the count lands. */
  total: number | null
  /** Whether a page is in flight. */
  loading: boolean
  /** Whether every matching entry is loaded. */
  exhausted: boolean
  /** Whether the last read failed. */
  loadFailed: boolean
  /** Append the next older page. */
  loadOlder: () => Promise<void>
}

/**
 * Read one newest-first page and then page older entries on demand.
 * @param load - one page read, keyed by a 0-based skip and a page size.
 * @param count - the total number of entries matching the current scope.
 * @param pageSize - entries per page; changing it restarts from page one.
 * @param revision - a counter the owner bumps to reload from page one.
 * @returns the table's entries and paging state.
 */
export function usePagedLogs<Entry>(
  load: (offset: number, limit: number) => Promise<RemoteResult<Entry[]>>,
  count: () => Promise<RemoteResult<number>>,
  pageSize: number,
  revision: number,
): PagedLogs<Entry> {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    loadingRef.current = true
    setLoading(true)
    void Promise.all([load(0, pageSize), count()]).then(([page, countResult]) => {
      if (cancelled) return
      const value = page.ok ? page.value : []
      const totalValue = countResult.ok ? countResult.value : value.length
      offsetRef.current = value.length
      setEntries(value)
      setTotal(totalValue)
      setLoadFailed(!page.ok || !countResult.ok)
      setLoading(false)
      loadingRef.current = false
    })
    return () => { cancelled = true }
  }, [load, count, pageSize, revision])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (loadingRef.current || total === null || offsetRef.current >= total) return
    loadingRef.current = true
    setLoading(true)
    setLoadFailed(false)
    const result = await load(offsetRef.current, pageSize)
    const value = result.ok ? result.value : []
    offsetRef.current += value.length
    if (result.ok) {
      setEntries(previous => [...previous, ...value])
      setLoading(false)
    } else {
      setLoadFailed(true)
      setLoading(false)
    }
    loadingRef.current = false
  }, [load, pageSize, total])

  return {
    entries,
    total,
    loading,
    exhausted: total !== null && (total === 0 || entries.length >= total),
    loadFailed,
    loadOlder,
  }
}

/**
 * Identify the scroll position that requests one older page.
 * @param event - the scrolling element's scroll event.
 * @returns whether the reader reached the bottom threshold.
 */
export function reachedLoadOlderThreshold(event: { currentTarget: HTMLElement }): boolean {
  const element = event.currentTarget
  return element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_OLDER_THRESHOLD
}

/**
 * Format one ISO timestamp as a compact local `MM-DD HH:MM:SS` cell.
 * @param iso - the logged ISO-8601 timestamp.
 * @returns the compact local time, or the input when it does not parse.
 */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Format one duration: minutes past a minute, seconds past a second, milliseconds below.
 * @param value - elapsed milliseconds, or undefined when the request never completed.
 * @returns the formatted duration, or an em dash when unknown.
 */
export function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)} min`
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} s` : `${Math.round(value)} ms`
}

/**
 * Resolve one duration bar's fill share on a square-root scale.
 * @param total - this row's elapsed milliseconds.
 * @param scale - the longest loaded duration, which fills the bar.
 * @returns the fill share in 0…1.
 */
export function barShare(total: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  if (total <= 0) return 0
  return Math.min(1, Math.sqrt(total / scale))
}

/**
 * Resolve the longest loaded duration, which scales every duration bar.
 * @param entries - the loaded log entries.
 * @returns the largest `durationMs` across the entries, or 0 when none carries one.
 */
export function durationScale(entries: readonly { durationMs?: number }[]): number {
  return entries.reduce((max, entry) => {
    const duration = entry.durationMs ?? 0
    return duration > max ? duration : max
  }, 0)
}
