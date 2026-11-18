/** Rock bot manager panel: card grid for the unified bot list, the add/edit-bot modal, and per-bot tool testing. */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Menu, Modal, Pill, StateDot, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** The add/edit form id, shared by the modal submit button and the form element. */
const FORM_ID = 'rock-bot-form'

/** Source filter values: all three bot sources plus the "all" sentinel. */
type SourceFilter = 'all' | BotSource

/** Host operations injected into the Cordis-free management component. */
export interface RockBotManagerSectionInjected {
  remote: {
    listBotsUnified(): Promise<RemoteResult<BotRow[]>>
    createBot(input: BotInput): Promise<RemoteResult<BotDefinition>>
    updateBot(id: string, patch: Partial<Omit<BotDefinition, 'id'>>): Promise<RemoteResult<BotDefinition>>
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

/** Render the unified bot card grid, the add/edit-bot modal, and per-bot tool testing. */
export function RockBotManagerSection({ t, remote }: RockBotManagerSectionProps): ReactElement {
  const [bots, setBots] = useState<BotRow[]>([])
  const [toolTypes, setToolTypes] = useState<string[]>([])
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; bot: BotRow } | null>(null)
  const [form, setForm] = useState<BotInput>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BotRow | null>(null)
  const [bindingMenu, setBindingMenu] = useState<string | null>(null)
  const [toolMenu, setToolMenu] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, BotTestResult>>({})
  const [toast, setToast] = useState<{ text: string; key: number; success: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

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

  const showToast = (text: string, success: boolean): void => {
    setToast({ text, key: Date.now(), success })
  }

  const openAdd = (): void => {
    setForm(EMPTY_FORM)
    setFormError('')
    setModal({ mode: 'add' })
  }

  const openEdit = (bot: BotRow): void => {
    setForm({
      name: bot.name,
      role: bot.role ?? '',
      llm: bot.llm === undefined
        ? { provider: '', baseUrl: '', apiKey: '', model: '' }
        : { provider: bot.llm.provider, baseUrl: bot.llm.baseUrl ?? '', apiKey: '', model: bot.llm.model },
      tool: { toolType: bot.tool.toolType },
    })
    setFormError('')
    setModal({ mode: 'edit', bot })
  }

  const formInput = (): BotInput => {
    const role = (form.role ?? '').trim()
    const baseUrl = (form.llm.baseUrl ?? '').trim()
    const apiKey = (form.llm.apiKey ?? '').trim()
    return {
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
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (modal === null) return
    if (modal.mode === 'add') {
      void remote.createBot(formInput()).then((result) => {
        if (result.ok) {
          setModal(null)
          showToast(t('toast.created'), true)
          refresh()
        } else {
          setFormError(result.error.message)
        }
      })
    } else {
      const input = formInput()
      const llm = {
        ...input.llm,
        ...(input.llm.apiKey === undefined && modal.bot.llm?.apiKey !== undefined
          ? { apiKey: modal.bot.llm.apiKey }
          : {}),
      }
      void remote.updateBot(modal.bot.id, { ...input, llm }).then((result) => {
        if (result.ok) {
          setModal(null)
          showToast(t('toast.updated'), true)
          refresh()
        } else {
          setFormError(result.error.message)
        }
      })
    }
  }

  const rebind = (id: string, toolType: string): void => {
    void remote.rebindBot(id, toolType).then((result) => {
      if (result.ok) {
        showToast(t('toast.rebound'), true)
        refresh()
      } else {
        showToast(result.error.message, false)
      }
    })
  }

  const runTest = (id: string): void => {
    setTesting(id)
    void remote.testBot(id).then((result) => {
      setTesting(null)
      if (!result.ok) {
        setTestResults(prev => ({ ...prev, [id]: { ok: false, toolType: '', error: result.error.message } }))
        return
      }
      const value = result.value
      setTestResults(prev => ({ ...prev, [id]: value }))
      if (value.ok) showToast(t('toast.tested'), true)
    })
  }

  const confirmDelete = (): void => {
    if (deleteTarget === null) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    void remote.removeBot(id).then((result) => {
      if (result.ok) {
        showToast(t('toast.deleted'), true)
      } else {
        showToast(result.error.message, false)
      }
      refresh()
    })
  }

  const sourceLabel = (source: BotSource): string => t(`source.${source}`)
  const llmLabel = (bot: BotRow): string => bot.llm === undefined ? t('cloudManaged') : `${bot.llm.provider} / ${bot.llm.model}`
  const projectLabel = (bot: BotRow): string => bot.projectName ?? t('project.global')
  const rebindLockedReason = (bot: BotRow): string | undefined => bot.active ? t('status.active') : (bot.canRebind ? undefined : t('rebind.locked'))

  /** Tool menu rows; `allowUninstalled` opens the form selector to tools not yet installed. */
  const toolOptions = (selected: string, allowUninstalled: boolean): Array<{ id: string; label: string; disabled?: boolean }> =>
    toolTypes.map(tool => ({
      id: tool,
      label: installed.has(tool) ? tool : `${tool} · ${t('notInstalled')}`,
      ...(!allowUninstalled && tool !== selected && !installed.has(tool) ? { disabled: true } : {}),
    }))

  const visibleBots = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return bots.filter((bot) => {
      if (sourceFilter !== 'all' && bot.source !== sourceFilter) return false
      if (keyword.length > 0 && !bot.name.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [bots, search, sourceFilter])

  const formFields = (
    <>
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
    </>
  )

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <div className={css.toolbarControls}>
          <Input
            value={search}
            onChange={(event) => { setSearch(event.target.value) }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className={css.search ?? ''}
          />
          <div className={css.filters}>
            <Pill active={sourceFilter === 'all'} onClick={() => { setSourceFilter('all') }}>{t('filter.all')}</Pill>
            <Pill active={sourceFilter === 'claimed'} onClick={() => { setSourceFilter('claimed') }}>{t('source.claimed')}</Pill>
            <Pill active={sourceFilter === 'local'} onClick={() => { setSourceFilter('local') }}>{t('source.local')}</Pill>
            <Pill active={sourceFilter === 'assistant'} onClick={() => { setSourceFilter('assistant') }}>{t('source.assistant')}</Pill>
          </div>
        </div>
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
      ) : visibleBots.length === 0 ? (
        <p className={css.empty}>{bots.length === 0 ? t('empty') : t('empty.filtered')}</p>
      ) : (
        <ul className={css.cards}>
          {visibleBots.map((bot) => {
            const testResult = testResults[bot.id]
            const rebindReason = rebindLockedReason(bot)
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
                  <span className={css.cardMetaRow}>{t('project.label')}：{projectLabel(bot)}</span>
                </div>
                <div className={css.cardActions}>
                  <Menu
                    open={bindingMenu === bot.id}
                    anchor={(
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!bot.canRebind || bot.active}
                        title={rebindReason}
                        onClick={() => { setBindingMenu(bindingMenu === bot.id ? null : bot.id) }}
                      >
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
                  {bot.source === 'local' && (
                    <Button size="sm" variant="outline" onClick={() => { openEdit(bot) }}>
                      {t('edit')}
                    </Button>
                  )}
                  {bot.canDelete && (
                    <Button className={css.deleteAction} variant="outline" size="sm" disabled={bot.active} title={bot.active ? t('status.active') : undefined} onClick={() => { setDeleteTarget(bot) }}>
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

      {modal !== null && (
        <Modal
          open
          onClose={() => { setModal(null) }}
          title={modal.mode === 'add' ? t('form.title') : t('form.editTitle')}
          description={t('form.description')}
          closeLabel={t('form.cancel')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => { setModal(null) }}>{t('form.cancel')}</Button>
              <Button variant="primary" type="submit" form={FORM_ID}>{modal.mode === 'add' ? t('form.submit') : t('form.save')}</Button>
            </>
          )}
        >
          <form id={FORM_ID} className={css.form} onSubmit={submit}>
            {formFields}
            {formError !== '' && (
              <div className={css.testError} role="alert">
                <span>{formError}</span>
              </div>
            )}
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

      {toast !== null && (
        toast.success
          ? <Toast key={toast.key} text={toast.text} tone="success" onDone={() => { setToast(null) }} />
          : <Toast key={toast.key} text={toast.text} onDone={() => { setToast(null) }} />
      )}
    </div>
  )
}
