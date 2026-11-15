/** Rock bot manager panel: card grid for the unified bot list, the add-bot modal, and per-bot tool testing. */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Menu, Modal, StateDot, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotDefinition, BotInput, BotRow, BotSource, BotTestResult } from '@rock/rock-bot-manager/types'
import css from './rock-bot-manager.module.css'

/** Empty create-form state. */
const EMPTY_FORM: BotInput = {
  name: '',
  role: '',
  llm: { provider: '', baseUrl: '', apiKey: '', model: '' },
  tool: { toolType: 'codex' },
}

/** Host operations injected into the Cordis-free management component. */
export interface RockBotManagerSectionInjected {
  remote: {
    listBotsUnified(): Promise<RemoteResult<BotRow[]>>
    createBot(input: BotInput): Promise<RemoteResult<BotDefinition>>
    removeBot(id: string): Promise<RemoteResult<void>>
    rebindBot(id: string, toolType: string): Promise<RemoteResult<void>>
    toolTypes(): Promise<RemoteResult<string[]>>
    installedTools(): Promise<RemoteResult<string[]>>
    testBot(id: string): Promise<RemoteResult<BotTestResult>>
  }
}

export type RockBotManagerSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-bot-manager'> & InjectFace<RockBotManagerSectionInjected>

/** Tag tone for each bot source. */
function sourceTone(source: BotSource): TagTone {
  switch (source) {
    case 'claimed': return 'info'
    case 'assistant': return 'success'
    case 'local': return 'neutral'
  }
}

/** Render the unified bot card grid, the add-bot modal, and per-bot tool testing. */
export function RockBotManagerSection({ t, remote }: RockBotManagerSectionProps): ReactElement {
  const [bots, setBots] = useState<BotRow[]>([])
  const [toolTypes, setToolTypes] = useState<string[]>([])
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<BotInput>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<BotRow | null>(null)
  const [bindingMenu, setBindingMenu] = useState<string | null>(null)
  const [toolMenu, setToolMenu] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, BotTestResult>>({})
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void remote.listBotsUnified().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setBots(result.value)
      else setLoadFailed(true)
    })
    void remote.toolTypes().then((result) => { if (!cancelled && result.ok) setToolTypes(result.value) })
    void remote.installedTools().then((result) => { if (!cancelled && result.ok) setInstalled(new Set(result.value)) })
    return () => { cancelled = true }
  }, [remote])

  const retryLoad = (): void => {
    setLoading(true)
    setLoadFailed(false)
    void remote.listBotsUnified().then((result) => {
      setLoading(false)
      if (result.ok) setBots(result.value)
      else setLoadFailed(true)
    })
    void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
  }

  const refresh = (): void => {
    void remote.listBotsUnified().then((result) => { if (result.ok) setBots(result.value) })
    void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
  }

  const openAdd = (): void => {
    setForm(EMPTY_FORM)
    setAddOpen(true)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const role = (form.role ?? '').trim()
    const baseUrl = (form.llm.baseUrl ?? '').trim()
    const apiKey = (form.llm.apiKey ?? '').trim()
    const input: BotInput = {
      name: form.name.trim(),
      ...role === '' ? {} : { role },
      llm: {
        provider: form.llm.provider.trim(),
        ...baseUrl === '' ? {} : { baseUrl },
        ...apiKey === '' ? {} : { apiKey },
        model: form.llm.model.trim(),
      },
      tool: { toolType: form.tool.toolType },
    }
    void remote.createBot(input).then((result) => {
      if (result.ok) {
        setAddOpen(false)
        setToast({ text: t('toast.created'), key: Date.now() })
        refresh()
      }
    })
  }

  const rebind = (id: string, toolType: string): void => {
    void remote.rebindBot(id, toolType).then((result) => {
      if (result.ok) {
        setToast({ text: t('toast.rebound'), key: Date.now() })
        refresh()
      }
    })
  }

  const runTest = (id: string): void => {
    setTesting(id)
    void remote.testBot(id).then((result) => {
      setTesting(null)
      if (!result.ok) {
        setTestResults(prev => ({ ...prev, [id]: { ok: false, toolType: '', error: t('test.failed') } }))
        return
      }
      const value = result.value
      setTestResults(prev => ({ ...prev, [id]: value }))
      if (value.ok) setToast({ text: t('toast.tested'), key: Date.now() })
    })
  }

  const confirmDelete = (): void => {
    if (deleteTarget === null) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    void remote.removeBot(id).then((result) => {
      if (result.ok) setToast({ text: t('toast.deleted'), key: Date.now() })
      refresh()
    })
  }

  const sourceLabel = (source: BotSource): string => t(`source.${source}`)
  const llmLabel = (bot: BotRow): string => bot.llm === undefined ? t('cloudManaged') : `${bot.llm.provider} / ${bot.llm.model}`

  /** Tool menu rows; `allowUninstalled` opens the form selector to tools not yet installed. */
  const toolOptions = (selected: string, allowUninstalled: boolean): Array<{ id: string; label: string; disabled?: boolean }> =>
    toolTypes.map(tool => ({
      id: tool,
      label: installed.has(tool) ? tool : `${tool} · ${t('notInstalled')}`,
      ...(!allowUninstalled && tool !== selected && !installed.has(tool) ? { disabled: true } : {}),
    }))

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <Button variant="primary" size="sm" onClick={openAdd}>{t('add')}</Button>
      </div>

      {loading ? (
        <div className={css.cards}>
          <div className={css.skeletonCard} />
          <div className={css.skeletonCard} />
        </div>
      ) : loadFailed ? (
        <div className={css.testError} role="alert">
          <span>{t('load.failed')}</span>
          <Button variant="ghost" size="sm" onClick={retryLoad}>{t('load.retry')}</Button>
        </div>
      ) : bots.length === 0 ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : (
        <ul className={css.cards}>
          {bots.map((bot) => {
            const testResult = testResults[bot.id]
            return (
              <li key={bot.id} className={css.card}>
                <div className={css.cardHeader}>
                  <span className={css.cardName}>{bot.name}</span>
                  <Tag tone={sourceTone(bot.source)}>{sourceLabel(bot.source)}</Tag>
                  <span className={css.status}>
                    <StateDot state={bot.active ? 'ongoing' : 'idle'} />
                    {bot.active ? t('status.active') : t('status.idle')}
                  </span>
                </div>
                {bot.role !== undefined && bot.role !== '' && <div className={css.cardRole}>{bot.role}</div>}
                <div className={css.cardMeta}>
                  <span className={css.cardMetaRow}>{llmLabel(bot)}</span>
                </div>
                <div className={css.cardActions}>
                  <Menu
                    open={bindingMenu === bot.id}
                    anchor={(
                      <Button size="sm" variant="outline" disabled={!bot.canRebind || bot.active} onClick={() => { setBindingMenu(bindingMenu === bot.id ? null : bot.id) }}>
                        {bot.tool.toolType}
                      </Button>
                    )}
                    items={toolOptions(bot.tool.toolType, false)}
                    selectedId={bot.tool.toolType}
                    onSelect={(id) => { rebind(bot.id, id); setBindingMenu(null) }}
                    onClose={() => { setBindingMenu(null) }}
                  />
                  <Button size="sm" disabled={testing === bot.id} onClick={() => { runTest(bot.id) }}>
                    {testing === bot.id ? t('test.running') : t('test')}
                  </Button>
                  {bot.canDelete && (
                    <Button className={css.deleteAction} variant="outline" size="sm" disabled={bot.active} onClick={() => { setDeleteTarget(bot) }}>
                      {t('delete')}
                    </Button>
                  )}
                </div>
                {testing !== bot.id && testResult !== undefined && (
                  <div className={css.testResult}>
                    {testResult.ok ? (
                      <>
                        <span className={css.testResultLabel}>{t('test.answer')}</span>
                        <span className={css.testAnswer}>{testResult.answer}</span>
                      </>
                    ) : (
                      <div className={css.testError} role="alert">
                        <span>{testResult.error}</span>
                        <Button variant="ghost" size="sm" onClick={() => { runTest(bot.id) }}>{t('test.retry')}</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {addOpen && (
        <Modal
          open
          onClose={() => { setAddOpen(false) }}
          title={t('form.title')}
          description={t('form.description')}
          closeLabel={t('form.cancel')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setAddOpen(false) }}>{t('form.cancel')}</Button>
              <Button variant="primary" type="submit" form="rock-bot-add-form">{t('form.submit')}</Button>
            </>
          )}
        >
          <form id="rock-bot-add-form" className={css.form} onSubmit={submit}>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.name')}</span>
              <Input value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }) }} aria-label={t('form.name')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.role')}</span>
              <Input value={form.role ?? ''} onChange={(event) => { setForm({ ...form, role: event.target.value }) }} aria-label={t('form.role')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.provider')}</span>
              <Input value={form.llm.provider} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, provider: event.target.value } }) }} aria-label={t('form.provider')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.baseUrl')}</span>
              <Input value={form.llm.baseUrl ?? ''} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, baseUrl: event.target.value } }) }} aria-label={t('form.baseUrl')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.apiKey')}</span>
              <Input type="password" value={form.llm.apiKey ?? ''} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, apiKey: event.target.value } }) }} aria-label={t('form.apiKey')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.model')}</span>
              <Input value={form.llm.model} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, model: event.target.value } }) }} aria-label={t('form.model')} />
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('form.toolType')}</span>
              <div className={css.formTool}>
                <Menu
                  open={toolMenu}
                  anchor={(
                    <Button size="sm" variant="outline" onClick={() => { setToolMenu(!toolMenu) }}>
                      {form.tool.toolType}
                    </Button>
                  )}
                  items={toolOptions(form.tool.toolType, true)}
                  selectedId={form.tool.toolType}
                  onSelect={(id) => { setForm({ ...form, tool: { toolType: id } }); setToolMenu(false) }}
                  onClose={() => { setToolMenu(false) }}
                />
              </div>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget !== null && (
        <Modal
          open
          onClose={() => { setDeleteTarget(null) }}
          title={t('deleteConfirm.title')}
          tone="warning"
          description={t('deleteConfirm.description')}
          closeLabel={t('deleteConfirm.cancel')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setDeleteTarget(null) }}>{t('deleteConfirm.cancel')}</Button>
              <Button variant="primary" onClick={confirmDelete}>{t('deleteConfirm.confirm')}</Button>
            </>
          )}
        >
          {deleteTarget.name}
        </Modal>
      )}

      {toast !== null && <Toast key={toast.key} text={toast.text} tone="success" onDone={() => { setToast(null) }} />}
    </div>
  )
}
