import { describe, expect, it } from 'vitest'
import { installedToolIds } from '../src/installed.ts'
import type { InstalledStatus } from '../src/installed.ts'

const FAST: readonly InstalledStatus[] = [
  { id: 'codex', installed: true },
  { id: 'pi', installed: false },
  { id: 'opencode', installed: true },
]

describe('installedToolIds', () => {
  it('lists fast-probe installed ids when nothing is detected', () => {
    expect(installedToolIds(FAST, [])).toEqual(['codex', 'opencode'])
  })

  it('prefers a detected install over a missing fast probe', () => {
    expect(installedToolIds(FAST, [{ id: 'pi', installed: true }])).toEqual(['codex', 'pi', 'opencode'])
  })

  it('prefers a detected absence over an installed fast probe', () => {
    expect(installedToolIds(FAST, [{ id: 'opencode', installed: false }])).toEqual(['codex'])
  })

  it('keeps fast-probe order and fills gaps the detection never covered', () => {
    const detected: readonly InstalledStatus[] = [{ id: 'pi', installed: true }]
    expect(installedToolIds(FAST, detected)).toEqual(['codex', 'pi', 'opencode'])
  })

  it('ignores detected ids absent from the fast probe', () => {
    expect(installedToolIds(FAST, [{ id: 'dsh', installed: true }])).toEqual(['codex', 'opencode'])
  })

  it('returns an empty list with no fast rows', () => {
    expect(installedToolIds([], [{ id: 'codex', installed: true }])).toEqual([])
  })
})
