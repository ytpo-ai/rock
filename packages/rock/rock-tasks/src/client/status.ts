/** Shared work-queue status presentation for the Rock task console panels. */
import type { RockTasksKey } from './locales.ts'

/** Canonical status order for grouping and filtering. */
export const STATUS_ORDER = ['pending', 'in-progress', 'awaiting-review', 'blocked', 'done'] as const

/** Localized status label, falling back to the raw status. */
export function statusLabel(t: (key: RockTasksKey) => string, status: string): string {
  const key = `status.${status}` as RockTasksKey
  return (STATUS_ORDER as readonly string[]).includes(status) ? t(key) : status
}
