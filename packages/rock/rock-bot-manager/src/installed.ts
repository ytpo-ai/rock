/**
 * Installed-tool resolution: merge assistant-detected statuses over the live
 * fast probe and list the tool ids reported installed. The detection result is
 * authoritative (it probes install AND running state); the fast probe fills the
 * gap for tools the detection never covered. Pure so the controller stays thin
 * and the logic is unit-testable without a live inventory.
 *
 * @module @rock/rock-bot-manager/installed
 */

/** Minimal status shape the merge needs; shared across the two tool sources. */
export interface InstalledStatus {
  /** Stable tool type id. */
  id: string
  /** Whether the tool resolved on this machine. */
  installed: boolean
}

/**
 * Tool ids reported installed, preferring `detected` over `fast` per id.
 * @param fast - live fast-probe statuses; supplies the order and any gap.
 * @param detected - merged assistant/persisted detection statuses (authoritative).
 * @returns installed tool ids, in `fast` declaration order.
 */
export function installedToolIds(
  fast: readonly InstalledStatus[],
  detected: readonly InstalledStatus[],
): string[] {
  const detectedById = new Map(detected.map(status => [status.id, status]))
  return fast
    .map(status => detectedById.get(status.id) ?? status)
    .filter(status => status.installed)
    .map(status => status.id)
}
