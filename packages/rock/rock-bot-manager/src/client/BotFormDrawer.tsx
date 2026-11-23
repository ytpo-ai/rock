/** Right-side drawer hosting the add/edit-bot form, split into basics, provider, single-model, and backend sections. */
import { useState, type FormEvent, type ReactElement } from 'react'
import { Button, Checkbox, Input, Menu, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApiProtocol, BotInput, BotInputType, BotLlm, BotReasoningLevel } from '@rock/rock-bot-manager/types'
import type { RockBotManagerKey } from './locales.ts'
import css from './rock-bot-manager.module.css'

/** Form element id shared by the drawer's submit button and the form element. */
const FORM_ID = 'rock-bot-form'

/** API protocol menu options, in product-name display order. */
const PROTOCOLS: readonly ApiProtocol[] = ['openai-chat', 'openai-responses', 'anthropic', 'gemini']

/** Default reasoning-effort mapping seeded the first time the toggle turns on. */
const DEFAULT_REASONING_LEVELS: readonly BotReasoningLevel[] = [
  { level: 'off', value: '0' },
  { level: 'low', value: 'low' },
  { level: 'medium', value: 'medium' },
  { level: 'high', value: 'high' },
]

/** Provider id shape: lowercase start, then lowercase letters, digits, and hyphens. */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Props for the bot form drawer; fully controlled by the owning panel. */
export interface BotFormDrawerProps {
  /** Namespace-bound translate. */
  t: (key: RockBotManagerKey) => string
  /** Whether the drawer creates or edits a bot. */
  mode: 'add' | 'edit'
  /** The current form value. */
  value: BotInput
  /** Replace the form value. */
  onChange: (next: BotInput) => void
  /** A submit error to show in-place, or an empty string. */
  error: string
  /** Whether a create/update is in flight. */
  submitting: boolean
  /** Tool types the backend selector offers. */
  toolTypes: readonly string[]
  /** Tool types detected as installed. */
  installed: ReadonlySet<string>
  /** Close the drawer without saving. */
  onCancel: () => void
  /** Persist the current value. */
  onSubmit: () => void
}

/** Render the bot form drawer. */
export function BotFormDrawer({
  t, mode, value, onChange, error, submitting, toolTypes, installed, onCancel, onSubmit,
}: BotFormDrawerProps): ReactElement {
  const [toolMenu, setToolMenu] = useState(false)
  const [protocolMenu, setProtocolMenu] = useState(false)

  const llm = value.llm
  const reasoning = llm.reasoning
  const reasoningEnabled = reasoning?.enabled ?? false
  const reasoningLevels = reasoning?.levels ?? []
  const inputTypes = llm.inputTypes ?? ['text']
  const baseUrl = llm.baseUrl ?? ''
  const providerIdInvalid = llm.provider.length > 0 && !PROVIDER_ID_PATTERN.test(llm.provider)
  const baseUrlHasSuffix = baseUrl.includes('/chat/completions')
  const baseUrlHint = baseUrlHasSuffix ? t('form.hint.baseUrlSuffix') : baseUrl.endsWith('/') ? t('form.hint.baseUrlSlash') : ''

  const setLlm = (patch: Partial<BotLlm>): void => { onChange({ ...value, llm: { ...llm, ...patch } }) }

  const setReasoningEnabled = (enabled: boolean): void => {
    setLlm({ reasoning: { enabled, levels: reasoningLevels.length === 0 ? [...DEFAULT_REASONING_LEVELS] : reasoningLevels } })
  }

  const updateReasoningLevels = (levels: BotReasoningLevel[]): void => { setLlm({ reasoning: { enabled: true, levels } }) }

  const editLevel = (index: number, patch: Partial<BotReasoningLevel>): void => {
    updateReasoningLevels(reasoningLevels.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const toggleInputType = (type: BotInputType, checked: boolean): void => {
    const next = checked ? [...inputTypes, type] : inputTypes.filter(item => item !== type)
    setLlm({ inputTypes: next.length === 0 ? ['text'] : next })
  }

  const parsePositiveInt = (raw: string): number | undefined => {
    if (raw === '') return undefined
    const parsed = Number(raw)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  const setContextWindow = (raw: string): void => {
    const parsed = parsePositiveInt(raw)
    if (parsed === undefined) {
      const next: BotLlm = { ...llm }
      delete next.contextWindow
      onChange({ ...value, llm: next })
    } else {
      setLlm({ contextWindow: parsed })
    }
  }

  const setMaxOutputTokens = (raw: string): void => {
    const parsed = parsePositiveInt(raw)
    if (parsed === undefined) {
      const next: BotLlm = { ...llm }
      delete next.maxOutputTokens
      onChange({ ...value, llm: next })
    } else {
      setLlm({ maxOutputTokens: parsed })
    }
  }

  const protocolLabel = (protocol: ApiProtocol): string => t(`form.protocol.${protocol}`)

  const toolOptions = toolTypes.map(tool => ({
    id: tool,
    label: installed.has(tool) ? tool : `${tool} · ${t('notInstalled')}`,
  }))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title={mode === 'add' ? t('form.title') : t('form.editTitle')}
      headless
      className={css.drawer ?? ''}
    >
      <header className={css.drawerHeader}>
        <h2 className={css.drawerTitle}>{mode === 'add' ? t('form.title') : t('form.editTitle')}</h2>
        <Button size="sm" variant="ghost" onClick={onCancel} aria-label={t('form.cancel')}>{t('form.cancel')}</Button>
      </header>

      <form id={FORM_ID} className={css.drawerBody} onSubmit={submit}>
        <p className={css.drawerDescription}>{t('form.description')}</p>

        <section className={css.formSection}>
          <h3 className={css.formSectionTitle}>{t('form.section.basic')}</h3>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.name')}</span>
            <Input value={value.name} onChange={(event) => { onChange({ ...value, name: event.target.value }) }} aria-label={t('form.name')} />
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.role')}</span>
            <Input value={value.role ?? ''} onChange={(event) => { onChange({ ...value, role: event.target.value }) }} aria-label={t('form.role')} />
          </div>
        </section>

        <section className={css.formSection}>
          <h3 className={css.formSectionTitle}>{t('form.section.provider')}</h3>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.providerId')}</span>
            <Input value={llm.provider} onChange={(event) => { setLlm({ provider: event.target.value }) }} aria-label={t('form.providerId')} />
            <p className={providerIdInvalid ? css.formHintError : css.formHint}>{t('form.hint.providerId')}</p>
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.displayName')}</span>
            <Input value={llm.name ?? ''} onChange={(event) => { setLlm({ name: event.target.value }) }} aria-label={t('form.displayName')} />
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.baseUrl')}</span>
            <Input value={llm.baseUrl ?? ''} onChange={(event) => { setLlm({ baseUrl: event.target.value }) }} aria-label={t('form.baseUrl')} />
            {baseUrlHint !== '' && <p className={baseUrlHasSuffix ? css.formHintError : css.formHint}>{baseUrlHint}</p>}
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.protocol')}</span>
            <div className={css.formTool}>
              <Menu
                open={protocolMenu}
                anchor={(
                  <Button size="sm" variant="outline" onClick={() => { setProtocolMenu(!protocolMenu) }}>
                    {protocolLabel(llm.protocol ?? 'openai-chat')}
                  </Button>
                )}
                items={PROTOCOLS.map(protocol => ({ id: protocol, label: protocolLabel(protocol) }))}
                selectedId={llm.protocol ?? 'openai-chat'}
                onSelect={(id) => {
                  const protocol = PROTOCOLS.find(item => item === id)
                  if (protocol !== undefined) setLlm({ protocol })
                  setProtocolMenu(false)
                }}
                onClose={() => { setProtocolMenu(false) }}
              />
            </div>
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.apiKey')}</span>
            <Input type="password" value={llm.apiKey ?? ''} onChange={(event) => { setLlm({ apiKey: event.target.value }) }} aria-label={t('form.apiKey')} />
          </div>
        </section>

        <section className={css.formSection}>
          <h3 className={css.formSectionTitle}>{t('form.section.model')}</h3>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.model')}</span>
            <Input value={llm.model} onChange={(event) => { setLlm({ model: event.target.value }) }} aria-label={t('form.model')} />
            <p className={css.formHint}>{t('form.hint.modelId')}</p>
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.modelName')}</span>
            <Input value={llm.modelName ?? ''} onChange={(event) => { setLlm({ modelName: event.target.value }) }} aria-label={t('form.modelName')} />
          </div>
          <div className={css.formRow}>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.contextWindow')}</span>
              <Input
                type="number"
                value={llm.contextWindow ?? ''}
                onChange={(event) => { setContextWindow(event.target.value) }}
                aria-label={t('form.contextWindow')}
              />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.maxOutputTokens')}</span>
              <Input
                type="number"
                value={llm.maxOutputTokens ?? ''}
                onChange={(event) => { setMaxOutputTokens(event.target.value) }}
                aria-label={t('form.maxOutputTokens')}
              />
            </div>
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.inputTypes')}</span>
            <div className={css.inputTypes}>
              <Checkbox checked={inputTypes.includes('text')} onChange={(next) => { toggleInputType('text', next) }} label={t('form.inputTypes.text')} />
              <Checkbox checked={inputTypes.includes('image')} onChange={(next) => { toggleInputType('image', next) }} label={t('form.inputTypes.image')} />
            </div>
          </div>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.reasoning')}</span>
            <Switch checked={reasoningEnabled} onChange={setReasoningEnabled} label={t('form.reasoning')} />
            {reasoningEnabled && (
              <>
                <div className={css.reasoningList}>
                  {reasoningLevels.map((row, index) => (
                    <div key={index} className={css.reasoningRow}>
                      <div className={css.reasoningLevel}>
                        <Input
                          value={row.level}
                          onChange={(event) => { editLevel(index, { level: event.target.value }) }}
                          aria-label={`${t('form.reasoning.level')} ${index + 1}`}
                          placeholder={t('form.reasoning.level')}
                        />
                      </div>
                      <div className={css.reasoningValue}>
                        <Input
                          value={String(row.value)}
                          onChange={(event) => { editLevel(index, { value: event.target.value }) }}
                          aria-label={`${t('form.reasoning.value')} ${index + 1}`}
                          placeholder={t('form.reasoning.value')}
                        />
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { updateReasoningLevels(reasoningLevels.filter((_, i) => i !== index)) }} aria-label={t('form.reasoning.remove')}>
                        {t('form.reasoning.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={() => { updateReasoningLevels([...reasoningLevels, { level: '', value: '' }]) }}>
                  {t('form.reasoning.add')}
                </Button>
                <p className={css.formHint}>{t('form.reasoning.hint')}</p>
              </>
            )}
          </div>
        </section>

        <section className={css.formSection}>
          <h3 className={css.formSectionTitle}>{t('form.section.backend')}</h3>
          <div className={css.formField}>
            <span className={css.formLabel}>{t('form.toolType')}</span>
            <div className={css.formTool}>
              <Menu
                open={toolMenu}
                anchor={(
                  <Button size="sm" variant="outline" onClick={() => { setToolMenu(!toolMenu) }}>
                    {value.tool?.toolType ?? t('bind.pending')}
                  </Button>
                )}
                items={toolOptions}
                selectedId={value.tool?.toolType}
                onSelect={(id) => { onChange({ ...value, tool: { toolType: id } }); setToolMenu(false) }}
                onClose={() => { setToolMenu(false) }}
              />
              {value.tool !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = { ...value }
                    delete next.tool
                    onChange(next)
                  }}
                >
                  {t('form.tool.clear')}
                </Button>
              )}
            </div>
            <p className={css.formHint}>{t('form.hint.tool')}</p>
          </div>
        </section>

        {error !== '' && (
          <div className={css.testError} role="alert">
            <span>{error}</span>
          </div>
        )}
      </form>

      <footer className={css.drawerFooter}>
        <Button variant="ghost" onClick={onCancel}>{t('form.cancel')}</Button>
        <Button variant="primary" type="submit" form={FORM_ID} disabled={submitting}>
          {mode === 'add' ? t('form.submit') : t('form.save')}
        </Button>
      </footer>
    </Modal>
  )
}
