/**
 * The rock-app bundle's substance is its patch file: the `dsh.bundle.patch`
 * manifest field must name a real, parseable patch that registers the codex and
 * DSH subagent providers and exposes them through per-tool thin-relay presets.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'

interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

interface Patch {
  id?: string
  disabled?: boolean
  insert?: PatchRow[]
}

interface PresetConfig {
  id?: string
  order?: number
  plugins?: PatchRow[]
}

interface ToolSubagentConfig {
  provider?: string
  toolName?: string
}

describe('dsh-rock-app bundle', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  const patches = parseEntryYaml(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8')) as Patch[]
  const rows = patches.flatMap(patch => patch.insert ?? [])

  it('declares the DSH subagent backend as a dependency', () => {
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subagent-dsh-sdk')
  })

  it('registers codex and DSH subagent providers without a host-level delegation tool', () => {
    const codex = rows.find(row => row.id === 'subagent-codex')
    expect(codex?.name).toBe('@deepseek-ai/dsh-subagent-codex')
    expect(codex?.config).toMatchObject({ providerName: 'codex', transport: 'socket' })
    const dsh = rows.find(row => row.id === 'subagent-dsh-sdk')
    expect(dsh?.name).toBe('@deepseek-ai/dsh-subagent-dsh-sdk')
    expect(dsh?.config).toMatchObject({ providerName: 'dsh' })
    // Delegation tools live in the per-tool presets, not at host level.
    expect(rows.filter(row => row.id === 'tool-subagent')).toHaveLength(0)
  })

  it('mounts one thin-relay preset per execution backend', () => {
    const presets = rows
      .filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
      .map(row => ({ row, config: row.config as PresetConfig | undefined }))

    const codex = presets.find(({ config }) => config?.id === 'rock-codex')
    const dsh = presets.find(({ config }) => config?.id === 'rock-dsh')
    expect(codex).toBeDefined()
    expect(dsh).toBeDefined()

    const codexTool = codex?.config?.plugins?.find(plugin => plugin.id === 'tool-subagent')
    expect((codexTool?.config as ToolSubagentConfig | undefined)).toMatchObject({
      provider: 'codex',
      toolName: 'subagent',
    })

    const dshTool = dsh?.config?.plugins?.find(plugin => plugin.id === 'tool-subagent')
    expect((dshTool?.config as ToolSubagentConfig | undefined)).toMatchObject({
      provider: 'dsh',
      toolName: 'subagent',
    })
  })
})
