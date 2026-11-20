import { describe, expect, it } from 'vitest'
import { presetForToolType } from '../src/tool-preset.ts'

describe('presetForToolType', () => {
  it('routes codex, dsh, and opencode to their thin-relay presets', () => {
    expect(presetForToolType('codex')).toBe('rock-codex')
    expect(presetForToolType('dsh')).toBe('rock-dsh-remote')
    expect(presetForToolType('opencode')).toBe('rock-opencode')
  })

  it('falls back to codex for unknown bindings', () => {
    expect(presetForToolType('pi')).toBe('rock-codex')
    expect(presetForToolType('acp')).toBe('rock-codex')
    expect(presetForToolType('')).toBe('rock-codex')
  })
})
