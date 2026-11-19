import { describe, expect, it } from 'vitest'
import { detectPrompt, extractJsonArray, mergeStatuses, parseDetectStatuses } from '../src/detect.ts'
import type { ToolDescriptor, ToolStatus } from '../src/types.ts'

const TOOLS: readonly ToolDescriptor[] = [
  { id: 'codex', command: 'codex', installDocUrl: 'https://docs/codex' },
  { id: 'pi', command: 'pi' },
]

describe('extractJsonArray', () => {
  it('parses a raw JSON array', () => {
    expect(extractJsonArray('[{"id":"codex","installed":true}]')).toEqual([{ id: 'codex', installed: true }])
  })

  it('parses a fenced json block', () => {
    expect(extractJsonArray('```json\n[{"id":"pi","installed":false}]\n```')).toEqual([{ id: 'pi', installed: false }])
  })

  it('parses an array embedded in prose', () => {
    expect(extractJsonArray('结果如下：[{"id":"codex","installed":true}] 完成')).toEqual([{ id: 'codex', installed: true }])
  })

  it('returns null without an array', () => {
    expect(extractJsonArray('no array here')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(extractJsonArray('[{"id":broken]')).toBeNull()
  })
})

describe('parseDetectStatuses', () => {
  it('maps a valid entry and stamps the assistant source', () => {
    const [status] = parseDetectStatuses('[{"id":"codex","installed":true,"running":true,"version":"1.2.3"}]', TOOLS)
    expect(status).toMatchObject({
      id: 'codex',
      installed: true,
      running: true,
      version: '1.2.3',
      installDocUrl: 'https://docs/codex',
      detectedBy: 'assistant',
    })
    expect(status?.lastCheckedAt).toBeTypeOf('string')
  })

  it('drops unknown ids and entries without a boolean installed', () => {
    const statuses = parseDetectStatuses(
      '[{"id":"unknown","installed":true},{"id":"codex","installed":"yes"},{"id":"pi","installed":false}]',
      TOOLS,
    )
    expect(statuses).toEqual([expect.objectContaining({ id: 'pi', installed: false })])
    expect(statuses[0]).not.toHaveProperty('running')
  })

  it('omits empty versions and empty install docs', () => {
    const [status] = parseDetectStatuses('[{"id":"pi","installed":true,"running":false,"version":""}]', TOOLS)
    expect(status).toMatchObject({ id: 'pi', installed: true, running: false })
    expect(status).not.toHaveProperty('version')
    expect(status).not.toHaveProperty('installDocUrl')
  })
})

describe('mergeStatuses', () => {
  it('prefers the assistant result and keeps the fast probe for gaps', () => {
    const fast: ToolStatus[] = [
      { id: 'codex', installed: true },
      { id: 'pi', installed: false },
    ]
    const assistant: ToolStatus[] = [{ id: 'codex', installed: true, running: true, detectedBy: 'assistant' }]
    expect(mergeStatuses(fast, assistant)).toEqual([
      { id: 'codex', installed: true, running: true, detectedBy: 'assistant' },
      { id: 'pi', installed: false },
    ])
  })
})

describe('detectPrompt', () => {
  it('names every tool id', () => {
    const prompt = detectPrompt(TOOLS)
    expect(prompt).toContain('codex')
    expect(prompt).toContain('pi')
    expect(prompt).toContain('JSON')
  })
})
