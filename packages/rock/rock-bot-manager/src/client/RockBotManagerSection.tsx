/** Rock bot manager panel: list locally-defined agent bots, bind each to a tool, and lock busy bots. */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BotDefinition, BotInput } from '@rock/rock-bot-manager/types'
import css from './rock-bot-manager.module.css'

/** Empty create form state. */
const EMPTY_FORM: BotInput = {
  name: '',
  llm: { provider: '', model: '' },
  tool: { toolType: 'codex' },
}

/** Host operations injected into the Cordis-free management component. */
export interface RockBotManagerSectionInjected {
  remote: {
    listBots(): Promise<RemoteResult<BotDefinition[]>>
    createBot(input: BotInput): Promise<RemoteResult<BotDefinition>>
    updateBot(id: string, patch: Partial<Omit<BotDefinition, 'id'>>): Promise<RemoteResult<BotDefinition>>
    removeBot(id: string): Promise<RemoteResult<void>>
    activeBotIds(): Promise<RemoteResult<string[]>>
    toolTypes(): Promise<RemoteResult<string[]>>
  }
}

export type RockBotManagerSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-bot-manager'> & InjectFace<RockBotManagerSectionInjected>

/** Render the local bots, their tool bindings, and the add form. */
export function RockBotManagerSection({ t, remote }: RockBotManagerSectionProps): ReactElement {
  const [bots, setBots] = useState<BotDefinition[]>([])
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set())
  const [toolTypes, setToolTypes] = useState<string[]>([])
  const [form, setForm] = useState<BotInput>(EMPTY_FORM)

  const refresh = (): void => {
    void remote.listBots().then((result) => { if (result.ok) setBots(result.value) })
    void remote.activeBotIds().then((result) => { if (result.ok) setActiveIds(new Set(result.value)) })
  }
  useEffect(() => {
    let cancelled = false
    void remote.toolTypes().then((result) => { if (!cancelled && result.ok) setToolTypes(result.value) })
    void remote.listBots().then((result) => {
      if (!cancelled && result.ok) setBots(result.value)
    })
    void remote.activeBotIds().then((result) => {
      if (!cancelled && result.ok) setActiveIds(new Set(result.value))
    })
    return () => { cancelled = true }
  }, [remote])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void remote.createBot(form).then((result) => {
      if (result.ok) {
        setForm(EMPTY_FORM)
        refresh()
      }
    })
  }

  const rebind = (id: string, toolType: string): void => {
    void remote.updateBot(id, { tool: { toolType } }).then(() => { refresh() })
  }

  const remove = (id: string): void => {
    void remote.removeBot(id).then(() => { refresh() })
  }

  return (
    <div className={css.root}>
      {bots.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <table className={css.table}>
          <thead>
            <tr>
              <th scope="col">{t('column.id')}</th>
              <th scope="col">{t('column.provider')}</th>
              <th scope="col">{t('column.model')}</th>
              <th scope="col">{t('column.tool')}</th>
              <th scope="col" aria-label={t('delete')} />
            </tr>
          </thead>
          <tbody>
            {bots.map(bot => (
              <tr key={bot.id}>
                <td>{bot.id}</td>
                <td>{bot.llm.provider}</td>
                <td>{bot.llm.model}</td>
                <td>
                  <select
                    value={bot.tool.toolType}
                    disabled={activeIds.has(bot.id)}
                    onChange={(event) => { rebind(bot.id, event.target.value) }}
                    aria-label={t('binding.label')}
                  >
                    {toolTypes.map(tool => <option key={tool} value={tool}>{tool}</option>)}
                    {!toolTypes.includes(bot.tool.toolType) && (
                      <option value={bot.tool.toolType}>{bot.tool.toolType}</option>
                    )}
                  </select>
                  {activeIds.has(bot.id) && <span className={css.locked}>{t('binding.locked')}</span>}
                </td>
                <td>
                  <button type="button" className={css.delete} onClick={() => { remove(bot.id) }}>{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className={css.form} onSubmit={submit}>
        <input
          value={form.id ?? ''}
          onChange={(event) => { setForm({ ...form, id: event.target.value }) }}
          placeholder={t('form.id')}
          aria-label={t('form.id')}
        />
        <input
          value={form.name}
          onChange={(event) => { setForm({ ...form, name: event.target.value }) }}
          placeholder={t('form.name')}
          aria-label={t('form.name')}
        />
        <input
          value={form.llm.provider}
          onChange={(event) => { setForm({ ...form, llm: { ...form.llm, provider: event.target.value } }) }}
          placeholder={t('form.provider')}
          aria-label={t('form.provider')}
        />
        <input
          value={form.llm.model}
          onChange={(event) => { setForm({ ...form, llm: { ...form.llm, model: event.target.value } }) }}
          placeholder={t('form.model')}
          aria-label={t('form.model')}
        />
        <input
          value={form.tool.toolType}
          onChange={(event) => { setForm({ ...form, tool: { toolType: event.target.value } }) }}
          placeholder={t('form.toolType')}
          aria-label={t('form.toolType')}
        />
        <button type="submit" className={css.submit}>{t('form.submit')}</button>
      </form>
    </div>
  )
}
