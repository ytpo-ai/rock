import { describe, expect, it } from 'vitest'
import { commandOf, debugPrompt, detectPrompt, extractJsonArray, mergeStatuses, parseDebugResult, parseDetectStatuses, touchedToolIds } from '../src/detect.ts'
import type { ToolDescriptor, ToolStatus } from '../src/types.ts'

const TOOLS: readonly ToolDescriptor[] = [
  { id: 'codex', command: 'codex', installDocUrl: 'https://docs/codex', serviceHint: '通过 daemon socket 委派' },
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

  it('targets the service-communication channel, not a one-shot subprocess', () => {
    const prompt = debugPrompt(TOOLS[0])
    expect(prompt).toContain('服务通信')
    expect(prompt).toContain('不是一次性 CLI 子进程')
  })

  it('instructs the assistant to retrieve the runner skill', () => {
    const prompt = debugPrompt(TOOLS[0])
    expect(prompt).toContain('rock-runner-<tool>')
  })

  it('does not embed the service hint or install doc url inline', () => {
    const prompt = debugPrompt(TOOLS[0])
    expect(prompt).not.toContain('通过 daemon socket 委派')
    expect(prompt).not.toContain('https://docs/codex')
  })

  it('injects the configured url and token', () => {
    const prompt = debugPrompt(TOOLS[0], { url: 'http://127.0.0.1:3087', token: 'SECRET' })
    expect(prompt).toContain('http://127.0.0.1:3087')
    expect(prompt).toContain('SECRET')
  })

  it('asks to auto-detect the url and read the token when neither is configured', () => {
    const prompt = debugPrompt(TOOLS[1])
    expect(prompt).toContain('请自行检测')
    expect(prompt).toContain('请自行从发现文件读取')
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
