/**
 * Unit tests for the OpenCode REST client: discovery-file reading, Basic
 * authorization, request error classification, and wire-boundary validation.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { basicAuthorization, OpencodeClient, readServiceFile } from '../src/client.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'subagent-opencode-'))
}

function jsonResponse(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function failingFetch(error: Error): typeof fetch {
  return async () => { throw error }
}

describe('readServiceFile', () => {
  it('reads url and password', () => {
    const dir = tempDir()
    try {
      const path = join(dir, 'service.json')
      writeFileSync(path, JSON.stringify({ url: 'http://127.0.0.1:49374', password: 'secret' }))
      expect(readServiceFile(path)).toEqual({ url: 'http://127.0.0.1:49374', password: 'secret' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loud when the file is missing', () => {
    expect(() => readServiceFile('/definitely/missing/service.json')).toThrow(/cannot read the OpenCode service file/)
  })

  it('fails loud on invalid JSON', () => {
    const dir = tempDir()
    try {
      const path = join(dir, 'service.json')
      writeFileSync(path, 'not json')
      expect(() => readServiceFile(path)).toThrow(/not valid JSON/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loud when url or password is missing', () => {
    const dir = tempDir()
    try {
      const path = join(dir, 'service.json')
      writeFileSync(path, JSON.stringify({ url: 'http://127.0.0.1:49374' }))
      expect(() => readServiceFile(path)).toThrow(/missing url or password/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('basicAuthorization', () => {
  it('builds the Basic header for the fixed opencode user', () => {
    expect(basicAuthorization('secret'))
      .toBe(`Basic ${Buffer.from('opencode:secret', 'utf8').toString('base64')}`)
  })
})

describe('OpencodeClient', () => {
  const client = (fetchFn: typeof fetch) => new OpencodeClient(
    'http://127.0.0.1:49374',
    'Basic dG9rZW4=',
    { fetchFn },
  )
  const signal = new AbortController().signal

  it('createSession returns the created id', async () => {
    const fetchFn = jsonResponse(200, { data: { id: 'ses_abc' } })
    await expect(client(fetchFn).createSession({ location: { directory: '/tmp' } }, signal))
      .resolves.toEqual({ id: 'ses_abc' })
  })

  it('classifies 401 as an auth failure', async () => {
    const fetchFn = jsonResponse(401, { _tag: 'UnauthorizedError' })
    await expect(client(fetchFn).createSession({ location: { directory: '/tmp' } }, signal))
      .rejects.toMatchObject({
        name: 'OpencodeRunFailure',
        facts: { stage: 'session-create', category: 'auth', httpStatus: 401 },
      })
  })

  it('classifies 500 as a product failure', async () => {
    const fetchFn = jsonResponse(500, { _tag: 'InternalServerError' })
    await expect(client(fetchFn).createSession({ location: { directory: '/tmp' } }, signal))
      .rejects.toMatchObject({
        name: 'OpencodeRunFailure',
        facts: { stage: 'session-create', category: 'product', httpStatus: 500 },
      })
  })

  it('classifies a fetch rejection as a transport failure', async () => {
    const fetchFn = failingFetch(new Error('ECONNREFUSED'))
    await expect(client(fetchFn).createSession({ location: { directory: '/tmp' } }, signal))
      .rejects.toMatchObject({
        name: 'OpencodeRunFailure',
        facts: { stage: 'session-create', category: 'transport' },
      })
  })

  it('classifies non-JSON success as an invalid result', async () => {
    const fetchFn: typeof fetch = async () => new Response('plain text', { status: 200 })
    await expect(client(fetchFn).createSession({ location: { directory: '/tmp' } }, signal))
      .rejects.toMatchObject({
        name: 'OpencodeRunFailure',
        facts: { stage: 'session-create', category: 'invalid-result' },
      })
  })

  it('listMessages parses assistant, idle, and other records', async () => {
    const fetchFn = jsonResponse(200, {
      data: [
        { type: 'user', id: 'msg_1', time: { created: 1 } },
        { type: 'assistant', id: 'msg_2', time: { created: 2 }, content: [{ type: 'text', text: 'done' }], finish: 'stop' },
        { type: 'idle', id: 'msg_3', time: { created: 3 }, outcome: 'succeeded' },
      ],
    })
    const messages = await client(fetchFn).listMessages('ses_abc', signal)
    expect(messages).toEqual([
      { type: 'other', id: 'msg_1', time: { created: 1 } },
      { type: 'assistant', id: 'msg_2', time: { created: 2 }, content: [{ type: 'text', text: 'done' }], finish: 'stop' },
      { type: 'idle', id: 'msg_3', time: { created: 3 }, outcome: 'succeeded' },
    ])
  })
})
