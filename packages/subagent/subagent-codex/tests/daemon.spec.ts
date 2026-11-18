import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import * as codex from '../src/index.ts'
import {
  DEFAULT_CODEX_PERMISSION_MODE,
  codexDaemonStartArgv,
} from '../src/run.ts'
import {
  defaultDaemonSocketPath,
  startCodexDaemonRun,
  type CodexDaemonRunSpec,
} from '../src/daemon.ts'

type JsonObject = Record<string, unknown>

const fakeParent = { id: 'parent' } as unknown as Agent

function request(
  prompt: ContentBlock[] = [{ type: 'text', text: 'do the task' }],
  signal = new AbortController().signal,
): SubagentStartRequest {
  return { prompt, parent: fakeParent, signal }
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

interface FakeDaemonServer {
  readonly socketPath: string
  readonly threadStartParams: JsonObject[]
  close(): Promise<void>
}

async function startFakeDaemon(): Promise<FakeDaemonServer> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-daemon-'))
  const socketPath = join(dir, 'control.sock')
  const threadStartParams: JsonObject[] = []
  const server = createServer((socket) => {
    const transport = new JsonRpcLineTransport(socket, socket)
    transport.onRequest(async (method, params) => {
      if (method === 'initialize') return { userAgent: 'codex-cli 0.153.4' }
      if (method === 'thread/start') {
        threadStartParams.push(params)
        return { thread: { id: 'thread-1', ephemeral: false } }
      }
      if (method === 'turn/start') {
        transport.notify('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-1' },
        })
        transport.notify('item/completed', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          item: { type: 'agentMessage', text: 'done', phase: 'final_answer' },
        })
        transport.notify('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        })
        return { turn: { id: 'turn-1' } }
      }
      throw new Error(`unexpected method: ${method}`)
    })
    transport.start()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  cleanup.push(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    socketPath,
    threadStartParams,
    close: async () => {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function daemonSpec(socketPath: string): CodexDaemonRunSpec {
  return {
    cwd: '/workspace',
    permissionMode: DEFAULT_CODEX_PERMISSION_MODE,
    socketPath,
    ensureDaemon: false,
    env: {},
    spawn: () => {
      throw new Error('spawn must not be called when ensureDaemon is false')
    },
  }
}

describe('daemon transport', () => {
  it('builds the daemon-start argv over the package-local wrapper', () => {
    const [node, bin, ...rest] = codexDaemonStartArgv()
    expect(node).toBe(process.execPath)
    expect(bin).toMatch(/codex\.js$/)
    expect(rest).toEqual(['app-server', 'daemon', 'start'])
  })

  it('resolves the daemon socket path from CODEX_HOME then HOME', () => {
    const previousCodexHome = process.env.CODEX_HOME
    const previousHome = process.env.HOME
    try {
      process.env.CODEX_HOME = '/tmp/codex-home'
      expect(defaultDaemonSocketPath())
        .toBe('/tmp/codex-home/app-server-control/app-server-control.sock')
      delete process.env.CODEX_HOME
      process.env.HOME = '/tmp/home'
      expect(defaultDaemonSocketPath())
        .toBe('/tmp/home/.codex/app-server-control/app-server-control.sock')
      delete process.env.HOME
      expect(defaultDaemonSocketPath()).toBeUndefined()
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousCodexHome
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('defaults the transport config to stdio and accepts the socket fields', () => {
    expect(codex.Config({}).transport).toBe('stdio')
    expect(codex.Config({}).socketPath).toBeUndefined()
    expect(codex.Config({}).ensureDaemon).toBe(false)
    expect(codex.Config({ transport: 'socket' }).transport).toBe('socket')
    expect(codex.Config({ socketPath: '/tmp/codex.sock' }).socketPath)
      .toBe('/tmp/codex.sock')
    expect(codex.Config({ ensureDaemon: true }).ensureDaemon).toBe(true)
  })

  it('drives one persistent thread over the daemon socket and closes only the connection', async () => {
    const server = await startFakeDaemon()
    const run = await startCodexDaemonRun(request(), daemonSpec(server.socketPath))
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'done' }])
    expect(server.threadStartParams[0]).toEqual({
      cwd: '/workspace',
      ephemeral: false,
      approvalPolicy: 'never',
    })
    await run.dispose()
    await server.close()
  })

  it('fails loud with a safe initialize diagnostic when the socket is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-nosock-'))
    cleanup.push(async () => { rmSync(dir, { recursive: true, force: true }) })
    const spec = daemonSpec(join(dir, 'missing.sock'))
    await expect(startCodexDaemonRun(request(), spec))
      .rejects.toThrow('stage: initialize; category: unknown')
  })
})
