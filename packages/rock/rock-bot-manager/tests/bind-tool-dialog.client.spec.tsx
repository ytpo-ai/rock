// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BindToolDialog } from '../src/client/BindToolDialog.tsx'
import type { RockBotManagerKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** Return the key verbatim so assertions target structure, not localized copy. */
const t = (key: RockBotManagerKey): string => key

/** Render the bind dialog over a fixed tool list. */
function renderDialog(options: {
  current?: string
  onConfirm?: (toolType: string) => void
  onClose?: () => void
} = {}): void {
  render(
    <BindToolDialog
      t={t}
      botName="Bot C"
      toolTypes={['codex', 'dsh', 'opencode']}
      installed={new Set(['codex', 'dsh'])}
      current={options.current}
      onConfirm={options.onConfirm ?? (() => {})}
      onClose={options.onClose ?? (() => {})}
    />,
  )
}

describe('BindToolDialog', () => {
  it('lists every tool with its install state and marks the current binding', () => {
    renderDialog({ current: 'codex' })

    expect(screen.getByRole('radio', { name: /codex/ })).toBeTruthy()
    expect(screen.getAllByText('bind.current').length).toBe(1)
    expect(screen.getAllByText('bind.installed').length).toBe(2)
    expect(screen.getByText('notInstalled')).toBeTruthy()
  })

  it('disables a tool that is neither installed nor currently bound', () => {
    renderDialog({ current: 'codex' })
    expect((screen.getByRole('radio', { name: /opencode/ }) as unknown as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirms only a different binding', () => {
    const onConfirm = vi.fn()
    renderDialog({ current: 'codex', onConfirm })

    const confirm = screen.getByText('bind.confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: /dsh/ }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('dsh')
  })

  it('offers binding while the bot is still unbound', () => {
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })

    fireEvent.click(screen.getByRole('radio', { name: /codex/ }))
    fireEvent.click(screen.getByText('bind.confirm'))
    expect(onConfirm).toHaveBeenCalledWith('codex')
  })
})
