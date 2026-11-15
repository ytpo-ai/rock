/** Rock bot manager panel: unified three-source bot list with source permissions and tool binding. */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button, Input, Menu, Modal, StateDot, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotDefinition, BotInput, BotRow, BotSource } from '@rock/rock-bot-manager/types'
import css from './rock-bot-manager.module.css'

/** Empty create-form state. */
const EMPTY_FORM: BotInput = {
  name: '',
  llm: { provider: '', model: '' },
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

/** Render the unified bot list, its bindings, and the add form. */
export function RockBotManagerSection({ t, remote }: RockBotManagerSectionProps): ReactElement {
  const [bots, setBots] = useState<BotRow[]>([])
  const [toolTypes, setToolTypes] = useState<string[]>([])
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState<BotInput>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<BotRow | null>(null)
  const [bindingMenu, setBindingMenu] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void remote.listBotsUnified().then((result) => { if (!cancelled && result.ok) setBots(result.value) })
    void remote.toolTypes().then((result) => { if (!cancelled && result.ok) setToolTypes(result.value) })
    void remote.installedTools().then((result) => { if (!cancelled && result.ok) setInstalled(new Set(result.value)) })
    return () => { cancelled = true }
  }, [remote])

  const refresh = (): void => {
    void remote.listBotsUnified().then((result) => { if (result.ok) setBots(result.value) })
    void remote.installedTools().then((result) => { if (result.ok) setInstalled(new Set(result.value)) })
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void remote.createBot(form).then((result) => {
      if (result.ok) {
        setForm(EMPTY_FORM)
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

  return (
    <div className={css.root}>
      {bots.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <ul className={css.list}>
          {bots.map((bot) => {
            const toolOptions = toolTypes.map(tool => ({
              id: tool,
              label: installed.has(tool) ? tool : `${tool} · ${t('notInstalled')}`,
              disabled: !installed.has(tool) && tool !== bot.tool.toolType,
            }))
            return (
              <li key={bot.id} className={css.row}>
                <div className={css.identity}>
                  <span className={css.name}>{bot.name}</span>
                  <Tag tone={sourceTone(bot.source)}>{sourceLabel(bot.source)}</Tag>
                </div>
                <div className={css.llm}>
                  {bot.llm === undefined ? t('cloudManaged') : `${bot.llm.provider} / ${bot.llm.model}`}
                </div>
                <div className={css.binding}>
                  <Menu
                    open={bindingMenu === bot.id}
                    anchor={(
                      <Button size="sm" disabled={!bot.canRebind || bot.active} onClick={() => { setBindingMenu(bindingMenu === bot.id ? null : bot.id) }}>
                        {bot.tool.toolType}
                      </Button>
                    )}
                    items={toolOptions}
                    selectedId={bot.tool.toolType}
                    onSelect={(id) => { rebind(bot.id, id); setBindingMenu(null) }}
                    onClose={() => { setBindingMenu(null) }}
                  />
                  {bot.active && <StateDot state="ongoing" />}
                </div>
                <div className={css.actions}>
                  <Button variant="outline" size="sm" disabled={!bot.canDelete || bot.active} onClick={() => { setDeleteTarget(bot) }}>
                    {t('delete')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <form className={css.form} onSubmit={submit}>
        <Input value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }) }} placeholder={t('form.name')} aria-label={t('form.name')} />
        <Input value={form.llm.provider} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, provider: event.target.value } }) }} placeholder={t('form.provider')} aria-label={t('form.provider')} />
        <Input value={form.llm.model} onChange={(event) => { setForm({ ...form, llm: { ...form.llm, model: event.target.value } }) }} placeholder={t('form.model')} aria-label={t('form.model')} />
        <Input value={form.tool.toolType} onChange={(event) => { setForm({ ...form, tool: { toolType: event.target.value } }) }} placeholder={t('form.toolType')} aria-label={t('form.toolType')} />
        <Button type="submit" variant="primary" size="sm">{t('form.submit')}</Button>
      </form>
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
