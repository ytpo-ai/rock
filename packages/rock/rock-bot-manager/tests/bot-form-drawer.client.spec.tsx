// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BotFormDrawer } from '../src/client/BotFormDrawer.tsx'
import type { RockBotManagerKey } from '../src/client/locales.ts'
import type { BotInput } from '../src/types.ts'

afterEach(cleanup)

/** Return the key verbatim so assertions target structural copy, not localized text. */
const t = (key: RockBotManagerKey): string => key

const VALUE: BotInput = {
  name: 'My Bot',
  llm: { provider: 'acme-gateway', model: 'gpt-5' },
}

/** A form value that already carries a binding, used to check the clear control. */
const BOUND: BotInput = { ...VALUE, tool: { toolType: 'codex' } }

/** A controlled harness so the toggle can drive the value back into the drawer. */
function Harness({ initial = VALUE }: { initial?: BotInput }): ReactElement {
  const [value, setValue] = useState<BotInput>(initial)
  return (
    <BotFormDrawer
      t={t}
      mode="add"
      value={value}
      onChange={setValue}
      error=""
      submitting={false}
      toolTypes={['codex', 'pi']}
      installed={new Set(['codex'])}
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  )
}

describe('BotFormDrawer', () => {
  it('renders the basics, provider, model, and backend sections', () => {
    render(<Harness />)
    expect(screen.getByText('form.section.basic')).toBeTruthy()
    expect(screen.getByText('form.section.provider')).toBeTruthy()
    expect(screen.getByText('form.section.model')).toBeTruthy()
    expect(screen.getByText('form.section.backend')).toBeTruthy()
  })

  it('starts a new bot unbound and shows the pending binding', () => {
    render(<Harness />)
    expect(screen.getByText('bind.pending')).toBeTruthy()
    expect(screen.queryByText('form.tool.clear')).toBeNull()
  })

  it('clears an existing binding back to unbound', () => {
    render(<Harness initial={BOUND} />)
    fireEvent.click(screen.getByText('form.tool.clear'))
    expect(screen.getByText('bind.pending')).toBeTruthy()
  })

  it('reveals the reasoning level editor when the toggle turns on', () => {
    render(<Harness />)
    expect(screen.queryByText('form.reasoning.add')).toBeNull()

    fireEvent.click(screen.getByRole('switch'))

    expect(screen.getByText('form.reasoning.add')).toBeTruthy()
    // The default levels seed once the toggle turns on; `off` maps to the unique value `0`.
    expect(screen.getByDisplayValue('0')).toBeTruthy()
    expect(screen.getAllByDisplayValue('high').length).toBeGreaterThan(0)
  })
})
