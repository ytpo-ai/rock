import { describe, expect, it } from 'vitest'
import { toolStatusFrom } from '../src/probe.ts'

describe('toolStatusFrom', () => {
  it('reports installed with a version on success', () => {
    expect(toolStatusFrom('codex', 'codex 0.1.2\n', undefined)).toEqual({ id: 'codex', installed: true, version: 'codex 0.1.2' })
  })

  it('reports not installed on ENOENT', () => {
    const error = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })
    expect(toolStatusFrom('codex', undefined, error)).toEqual({ id: 'codex', installed: false })
  })

  it('reports installed without a version on other errors', () => {
    expect(toolStatusFrom('pi', undefined, new Error('boom'))).toEqual({ id: 'pi', installed: true })
  })

  it('drops an empty version', () => {
    expect(toolStatusFrom('dsh', '  \n', undefined)).toEqual({ id: 'dsh', installed: true })
  })
})
