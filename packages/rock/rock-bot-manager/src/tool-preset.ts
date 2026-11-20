/**
 * Thin-relay preset routing: map a bot's bound execution backend (`toolType`)
 * to the rock-app thin-relay preset id. The preset's only tool is `subagent`
 * scoped to the matching `subagent-*` provider, so a bot delegates through the
 * service channel instead of a one-shot CLI. Unknown bindings fall back to
 * codex.
 *
 * @module @rock/rock-bot-manager/tool-preset
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
