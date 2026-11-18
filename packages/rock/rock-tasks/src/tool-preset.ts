/**
 * Thin-relay preset routing: map a bot's bound execution backend (`toolType`)
 * to the rock-app thin-relay preset id. Unknown bindings fall back to codex.
 *
 * @module @rock/rock-tasks/tool-preset
 */

/** Thin-relay preset ids keyed by bot toolType; unknown bindings fall back to codex. */
const TOOL_PRESETS: Readonly<Record<string, string>> = {
  codex: 'rock-codex',
  dsh: 'rock-dsh',
}

/** The thin-relay preset id for a bot's bound execution backend. */
export function presetForToolType(toolType: string): string {
  return TOOL_PRESETS[toolType] ?? 'rock-codex'
}
