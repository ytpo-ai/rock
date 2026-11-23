// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayLogTable, SessionsTable } from '../src/client/RockObservabilitySection.tsx'
import type { RockObservabilityKey } from '../src/client/locales.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservabilityRow, RelayForwardLog } from '../src/types.ts'

afterEach(cleanup)

/** Return the key verbatim so assertions target structural copy, not localized text. */
const t = (key: RockObservabilityKey): string => key

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

const LOG: RelayForwardLog = {
  timestamp: '2026-11-23T06:10:00.000Z',
  startedAt: '2026-11-23T06:10:00.000Z',
  durationMs: 1250,
  agentBotId: 'bot-a',
  botName: 'Bot A',
  toolType: 'codex',
  pathSuffix: '/chat/completions',
  mappedModel: 'seagull-relay',
  boundModel: 'gpt-5',
  status: 200,
}

describe('RelayLogTable', () => {
  it('renders relay rows with bot name, tool, and duration', async () => {
    const remote = {
      rows: vi.fn(),
      relayLogs: vi.fn(async () => ok([LOG])),
      relayLogCount: vi.fn(async () => ok(1)),
    }
    render(<RelayLogTable t={t} remote={remote} />)

    expect(await screen.findByText('Bot A')).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByText('1.25 s')).toBeTruthy()
    expect(remote.relayLogs).toHaveBeenCalledWith(0, 50)
  })

  it('shows the empty state when there are no logs', async () => {
    const remote = {
      rows: vi.fn(),
      relayLogs: vi.fn(async () => ok([])),
      relayLogCount: vi.fn(async () => ok(0)),
    }
    render(<RelayLogTable t={t} remote={remote} />)

    expect(await screen.findByText('relay.empty')).toBeTruthy()
  })
})

describe('SessionsTable', () => {
  it('renders session rows with their aggregate figures', async () => {
    const row: ObservabilityRow = { sessionId: 's1', turns: 2, steps: 3, outputTokens: 40 }
    const remote = {
      rows: vi.fn(async () => ok([row])),
      relayLogs: vi.fn(),
      relayLogCount: vi.fn(),
    }
    render(<SessionsTable t={t} remote={remote} />)

    expect(await screen.findByText('s1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('40')).toBeTruthy()
  })
})
