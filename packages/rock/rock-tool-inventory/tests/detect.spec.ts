import { describe, expect, it } from 'vitest'
import { commandOf, debugPrompt, detectPrompt, extractJsonArray, mergeStatuses, parseDebugResult, parseDetectStatuses, touchedToolIds } from '../src/detect.ts'
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
  it('starts with the runner-detection title on its own line', () => {
    expect(detectPrompt(TOOLS).split('\n')[0]).toBe('执行器检测')
  })

  it('names every tool id', () => {
    const prompt = detectPrompt(TOOLS)
    expect(prompt).toContain('codex')
    expect(prompt).toContain('pi')
    expect(prompt).toContain('JSON')
  })
})

describe('debugPrompt', () => {
  it('starts with the runner-debug title on its own line', () => {
    expect(debugPrompt(TOOLS[0]).split('\n')[0]).toBe('执行器调试')
  })

  it('names the target tool id and command', () => {
    const prompt = debugPrompt(TOOLS[0])
    expect(prompt).toContain('codex')
    expect(prompt).toContain('冒烟测试')
  })

  it('includes the install doc url when present', () => {
    expect(debugPrompt(TOOLS[0])).toContain('https://docs/codex')
  })
})

describe('parseDebugResult', () => {
  it('parses a pass result with a summary', () => {
    const result = parseDebugResult('```json\n{"ok":true,"summary":"codex answered"}\n```', TOOLS[0])
    expect(result).toMatchObject({ id: 'codex', ok: true, summary: 'codex answered' })
    expect(result.finishedAt).toBeTypeOf('string')
  })

  it('parses a fail result with a diagnostic', () => {
    const result = parseDebugResult('{"ok":false,"summary":"codex failed","diagnostic":"missing token"}', TOOLS[0])
    expect(result).toMatchObject({ id: 'codex', ok: false, summary: 'codex failed', diagnostic: 'missing token' })
  })

  it('settles as not-ok without a summary on malformed JSON', () => {
    const result = parseDebugResult('no json here', TOOLS[1])
    expect(result).toMatchObject({ id: 'pi', ok: false })
    expect(result.summary).toBeUndefined()
  })
})

describe('touchedToolIds', () => {
  it('matches a whole-token command', () => {
    expect([...touchedToolIds('which codex', TOOLS)]).toEqual(['codex'])
  })

  it('does not match a token embedded in a longer word', () => {
    expect([...touchedToolIds('echo pipe', TOOLS)]).toEqual([])
  })

  it('matches several tools in one combined command', () => {
    expect([...touchedToolIds('for t in codex pi; do echo $t; done', TOOLS)].sort()).toEqual(['codex', 'pi'])
  })
})

describe('commandOf', () => {
  it('extracts command from a JSON string argument', () => {
    expect(commandOf('{"command":"which codex","description":"detect codex"}')).toBe('which codex')
  })

  it('extracts command from an object argument', () => {
    expect(commandOf({ command: 'pgrep -f opencode' })).toBe('pgrep -f opencode')
  })

  it('returns undefined for malformed JSON', () => {
    expect(commandOf('not json')).toBeUndefined()
  })
})
