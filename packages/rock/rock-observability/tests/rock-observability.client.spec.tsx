// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AdapterLogTable,
  RelayLogTable,
  RockObservabilitySection,
} from '../src/client/RockObservabilitySection.tsx'
import { LogDisplayDialog, parsePageSize } from '../src/client/LogDisplayDialog.tsx'
import { usePagedLogs } from '../src/client/paged-logs.ts'
import type { RockObservabilityKey } from '../src/client/locales.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AdapterRequestLog, ObservabilityRow, RelayForwardLog } from '../src/types.ts'

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

const ADAPTER_LOG: AdapterRequestLog = {
  timestamp: '2026-11-26T10:20:00.000Z',
  startedAt: '2026-11-26T10:20:00.000Z',
  durationMs: 820,
  agentBotId: 'bot-a',
  botName: 'Bot A',
  provider: 'seagull-cloud',
  wireProtocol: 'chat-completions',
  requestModel: 'seagull-relay',
  messageCount: 3,
  toolCount: 2,
  status: 200,
  tokens: { input: 1200, output: 300, cacheRead: 400, total: 1500 },
}

/** A paged-log fixture that never pages further, so tables render their first page alone. */
function fixedLogs<Entry>(entries: Entry[], overrides: Partial<ReturnType<typeof usePagedLogs<Entry>>> = {}) {
  return {
    entries,
    total: entries.length,
    loading: false,
    exhausted: true,
    loadFailed: false,
    loadOlder: vi.fn(async () => undefined),
    ...overrides,
  }
}

/** The complete Remote fixture, with per-call overrides for the assertions that need them. */
function remoteFixture(overrides: Record<string, unknown> = {}) {
  return {
    rows: vi.fn(async () => ok([] as ObservabilityRow[])),
    relayLogs: vi.fn(async () => ok([LOG])),
    relayLogCount: vi.fn(async () => ok(1)),
    adapterLogs: vi.fn(async () => ok([ADAPTER_LOG])),
    adapterLogCount: vi.fn(async () => ok(1)),
    bots: vi.fn(async () => ok([{ id: 'bot-a', name: 'Bot A' }])),
    ...overrides,
  }
}

describe('RelayLogTable', () => {
  it('renders relay rows with bot name, tool, and duration', () => {
    render(<RelayLogTable t={t} logs={fixedLogs([LOG])} />)

    expect(screen.getByText('Bot A')).toBeTruthy()
    expect(screen.getByText('codex')).toBeTruthy()
    expect(screen.getByText('1.25 s')).toBeTruthy()
  })

  it('shows the empty state when there are no logs', () => {
    render(<RelayLogTable t={t} logs={fixedLogs<RelayForwardLog>([])} />)
    expect(screen.getByText('relay.empty')).toBeTruthy()
  })

  it('shows a retry hint instead of the empty state when the read failed', () => {
    render(<RelayLogTable t={t} logs={fixedLogs<RelayForwardLog>([], { loadFailed: true })} />)
    expect(screen.getByText('loadOlder.failed')).toBeTruthy()
  })

  it('renders relay rows newest-first', async () => {
    const newer: RelayForwardLog = { ...LOG, timestamp: '2026-11-23T06:12:00.000Z', agentBotId: 'bot-new', botName: 'New Bot' }
    const older: RelayForwardLog = { ...LOG, timestamp: '2026-11-23T06:10:00.000Z', agentBotId: 'bot-old', botName: 'Old Bot' }
    render(<RelayLogTable t={t} logs={fixedLogs([newer, older])} />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2 data rows
    expect(within(rows[1]!).getByText('New Bot')).toBeTruthy()
    expect(within(rows[2]!).getByText('Old Bot')).toBeTruthy()
  })

  it('requests one older page when the reader reaches the bottom', async () => {
    const logs = fixedLogs([LOG], { exhausted: false })
    render(<RelayLogTable t={t} logs={logs} />)

    const scroll = screen.getByRole('table', { name: 'tab.relay' }).parentElement!
    Object.defineProperty(scroll, 'scrollHeight', { value: 100, configurable: true })
    Object.defineProperty(scroll, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, configurable: true })
    fireEvent.scroll(scroll)

    await waitFor(() => { expect(logs.loadOlder).toHaveBeenCalledTimes(1) })
  })
})

describe('AdapterLogTable', () => {
  it('renders one request with its provider, model, tokens, and duration', () => {
    render(<AdapterLogTable t={t} logs={fixedLogs([ADAPTER_LOG])} />)

    expect(screen.getByText('seagull-cloud')).toBeTruthy()
    expect(screen.getByText('seagull-relay')).toBeTruthy()
    expect(screen.getByText('1.2k → 300')).toBeTruthy()
    expect(screen.getByText('820 ms')).toBeTruthy()
  })

  it('shows a dash when the request reported no usage', () => {
    const { tokens: _tokens, ...withoutTokens } = ADAPTER_LOG
    render(<AdapterLogTable t={t} logs={fixedLogs([withoutTokens])} />)

    // Column 6 is the input → output token cell; without usage it reads as a dash.
    const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')
    expect(cells[5]!.textContent).toBe('—')
  })

  it('shows the empty state when there are no requests', () => {
    render(<AdapterLogTable t={t} logs={fixedLogs<AdapterRequestLog>([])} />)
    expect(screen.getByText('adapter.empty')).toBeTruthy()
  })

  it('surfaces a failure diagnostic in the status cell', () => {
    render(<AdapterLogTable t={t} logs={fixedLogs([{ ...ADAPTER_LOG, status: undefined, error: 'HTTP_503' }])} />)
    expect(screen.getByText('HTTP_503')).toBeTruthy()
  })
})

describe('RockObservabilitySection', () => {
  it('loads the first page of both logs and the bot choices', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)

    await waitFor(() => { expect(remote.relayLogs).toHaveBeenCalledWith(0, 50, undefined) })
    expect(remote.adapterLogs).toHaveBeenCalledWith(0, 50, undefined)
    expect(remote.bots).toHaveBeenCalled()
  })

  it('offers only the relay and adapter tabs', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)

    const tabs = screen.getAllByRole('tab').map(tab => tab.textContent)
    expect(tabs).toEqual(['tab.relay', 'tab.adapter'])
  })

  it('reads the adapter log from the adapter tab', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)

    fireEvent.click(screen.getByRole('tab', { name: 'tab.adapter' }))

    expect(await screen.findByText('seagull-cloud')).toBeTruthy()
  })

  it('reloads page one when the refresh control is pressed', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)
    await waitFor(() => { expect(remote.relayLogs).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('button', { name: 'toolbar.refresh' }))

    await waitFor(() => { expect(remote.relayLogs).toHaveBeenCalledTimes(2) })
    expect(remote.relayLogs).toHaveBeenLastCalledWith(0, 50, undefined)
  })

  it('scopes both logs to the bot chosen in the filter', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)
    await waitFor(() => { expect(remote.bots).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: 'filter.bot: filter.all' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bot A' }))

    await waitFor(() => { expect(remote.relayLogs).toHaveBeenLastCalledWith(0, 50, 'bot-a') })
    expect(remote.adapterLogs).toHaveBeenLastCalledWith(0, 50, 'bot-a')
    expect(remote.relayLogCount).toHaveBeenLastCalledWith('bot-a')
  })

  it('applies a page size picked in the display dialog', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)
    await waitFor(() => { expect(remote.relayLogs).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: 'display.button: 50' }))
    fireEvent.click(await screen.findByRole('button', { name: '100' }))
    fireEvent.click(screen.getByRole('button', { name: 'display.apply' }))

    await waitFor(() => { expect(remote.relayLogs).toHaveBeenLastCalledWith(0, 100, undefined) })
  })

  it('applies a manually typed page size', async () => {
    const remote = remoteFixture()
    render(<RockObservabilitySection t={t} remote={remote} />)
    await waitFor(() => { expect(remote.relayLogs).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: 'display.button: 50' }))
    const field = await screen.findByRole('spinbutton', { name: 'display.manual' })
    fireEvent.change(field, { target: { value: '37' } })
    fireEvent.click(screen.getByRole('button', { name: 'display.apply' }))

    await waitFor(() => { expect(remote.relayLogs).toHaveBeenLastCalledWith(0, 37, undefined) })
  })
})

describe('LogDisplayDialog', () => {
  it('offers the recommended page sizes and reflects the current one', () => {
    render(<LogDisplayDialog open pageSize={50} t={t} onApply={vi.fn()} onClose={vi.fn()} />)

    for (const preset of ['20', '50', '100', '200']) {
      expect(screen.getByRole('button', { name: preset })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: '50' }).getAttribute('aria-pressed')).not.toBe('true')
    expect(screen.getByRole('spinbutton', { name: 'display.manual' }).getAttribute('value')).toBe('50')
  })

  it('fills the manual field when a preset is picked', async () => {
    render(<LogDisplayDialog open pageSize={50} t={t} onApply={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '200' }))

    expect(screen.getByRole('spinbutton', { name: 'display.manual' }).getAttribute('value')).toBe('200')
  })

  it('rejects an out-of-range or non-numeric count', async () => {
    const onApply = vi.fn()
    render(<LogDisplayDialog open pageSize={50} t={t} onApply={onApply} onClose={vi.fn()} />)

    const field = screen.getByRole('spinbutton', { name: 'display.manual' })
    fireEvent.change(field, { target: { value: '501' } })

    expect(screen.getByText('display.invalid')).toBeTruthy()
    const apply = screen.getByRole('button', { name: 'display.apply' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('parsePageSize', () => {
  it('accepts whole counts from 1 to 500 and rejects everything else', () => {
    expect(parsePageSize('1')).toBe(1)
    expect(parsePageSize(' 500 ')).toBe(500)
    expect(parsePageSize('0')).toBeUndefined()
    expect(parsePageSize('501')).toBeUndefined()
    expect(parsePageSize('2.5')).toBeUndefined()
    expect(parsePageSize('abc')).toBeUndefined()
    expect(parsePageSize('')).toBeUndefined()
  })
})
