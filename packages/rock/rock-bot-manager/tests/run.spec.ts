import { describe, expect, it } from 'vitest'
import { runTool, TEST_PROMPT } from '../src/run.ts'

describe('runTool', () => {
  it('replaces the prompt placeholder and returns trimmed stdout as the answer', async () => {
    const result = await runTool({ command: 'node', args: ['-e', 'console.log("answer: {prompt}")'] }, TEST_PROMPT)
    expect(result.ok).toBe(true)
    expect(result.answer).toBe(`answer: ${TEST_PROMPT}`)
  })

  it('fails with a diagnostic when the command exits non-zero', async () => {
    const result = await runTool({ command: 'node', args: ['-e', 'console.error("boom"); process.exit(1)'] }, TEST_PROMPT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })

  it('fails when the command is missing', async () => {
    const result = await runTool({ command: 'rock-no-such-tool', args: [] }, TEST_PROMPT)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOENT')
  })
})
