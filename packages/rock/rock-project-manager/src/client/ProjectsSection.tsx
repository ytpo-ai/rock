/** Rock project manager panel: a card grid of synced projects with per-project directory overrides. */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button, IconEditOutlineRegular, IconFolderOpenOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular, Input, Modal, StateDot, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectRow } from '@rock/rock-project-manager/types'
import { filterProjects } from './filter.ts'
import css from './rock-project-manager.module.css'

/** Directory-edit drawer form id shared by the submit button and the form element. */
const DIR_FORM_ID = 'rock-project-dir-form'

/** Host operations injected into the Cordis-free management component. */
export interface ProjectsSectionInjected {
  remote: {
    listProjects(): Promise<RemoteResult<ProjectRow[]>>
    setProjectDir(projectId: string, dir: string | null): Promise<RemoteResult<ProjectRow>>
  }
}

export type ProjectsSectionProps =
  PropsRuntime<'main'> & PropsLocale<'rock-project-manager'> & InjectFace<ProjectsSectionInjected>

/** Render the project card grid plus the per-project directory drawer. */
export function ProjectsSection({ t, remote }: ProjectsSectionProps): ReactElement {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [dirTarget, setDirTarget] = useState<ProjectRow | null>(null)
  const [dirValue, setDirValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ text: string; key: number; success: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    void remote.listProjects().then((result) => {
      setLoading(false)
      if (cancelled) return
      if (result.ok) setProjects(result.value)
      else setLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [remote])

  const fetchProjects = (): void => {
    void remote.listProjects().then((result) => {
      setLoading(false)
      setSyncing(false)
      if (result.ok) {
        setProjects(result.value)
        setLoadFailed(false)
      } else {
        setLoadFailed(true)
      }
    })
  }

  const refresh = (): void => {
    setSyncing(true)
    fetchProjects()
  }

  const retry = (): void => {
    setLoading(true)
    fetchProjects()
  }

  const showToast = (text: string, success: boolean): void => {
    setToast({ text, key: Date.now(), success })
  }

  const visibleProjects = useMemo(() => filterProjects(projects, search), [projects, search])

  const openDirEditor = (project: ProjectRow): void => {
    setDirTarget(project)
    setDirValue(project.hasOverride ? project.dir : '')
  }

  const closeDirEditor = (): void => {
    if (!submitting) setDirTarget(null)
  }

  const submitDir = (event: FormEvent): void => {
    event.preventDefault()
    if (dirTarget === null) return
    setSubmitting(true)
    const value = dirValue.trim()
    void remote.setProjectDir(dirTarget.id, value.length === 0 ? null : value).then((result) => {
      setSubmitting(false)
      if (result.ok) {
        setProjects(projects.map(project => project.id === result.value.id ? result.value : project))
        setDirTarget(null)
        showToast(value.length === 0 ? t('toast.reset') : t('toast.saved'), true)
      } else {
        showToast(result.error.message, false)
      }
    })
  }

  const resetDir = (): void => {
    if (dirTarget === null) return
    setSubmitting(true)
    void remote.setProjectDir(dirTarget.id, null).then((result) => {
      setSubmitting(false)
      if (result.ok) {
        setProjects(projects.map(project => project.id === result.value.id ? result.value : project))
        setDirTarget(null)
        showToast(t('toast.reset'), true)
      } else {
        showToast(result.error.message, false)
      }
    })
  }

  return (
    <div className={css.root}>
      <header className={css.pageHeader}>
        <div className={css.pageHeading}>
          <h1 className={css.pageTitle}>{t('page.title')}</h1>
          <p className={css.pageDescription}>{t('page.description')}</p>
        </div>
        <div className={css.toolbarActions}>
          <Button
            size="sm"
            variant="ghost"
            icon={syncing ? <StateDot state="ongoing" /> : <IconRefreshOutlineRegular size={14} />}
            disabled={loading || syncing}
            title={t('refresh.title')}
            onClick={refresh}
          >
            {t('refresh')}
          </Button>
        </div>
      </header>

      <div className={css.toolbar}>
        <div className={css.toolbarControls}>
          <span className={css.searchField}>
            <IconSearchOutlineRegular size={14} className={css.searchIcon} />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value) }}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              className={css.search ?? ''}
            />
          </span>
        </div>
      </div>

      {loading ? (
        <div className={css.cards}>
          <div className={css.skeletonCard} />
          <div className={css.skeletonCard} />
        </div>
      ) : loadFailed ? (
        <div className={css.error} role="alert">
          <span>{t('load.failed')}</span>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={retry}>{t('load.retry')}</Button>
        </div>
      ) : visibleProjects.length === 0 ? (
        <p className={css.empty}>{projects.length === 0 ? t('empty') : t('empty.filtered')}</p>
      ) : (
        <ul className={css.cards}>
          {visibleProjects.map(project => (
            <li key={project.id} className={css.card}>
              <div className={css.cardHeader}>
                <span className={css.cardAvatar} aria-hidden="true">
                  <IconFolderOpenOutlineRegular size={20} />
                </span>
                <div className={css.cardIdentity}>
                  <span className={css.cardTitleRow}>
                    <span className={css.cardName}>{project.name}</span>
                    <span className={css.cardHeaderMeta}>
                      <Tag tone={project.hasOverride ? 'info' : 'neutral'}>
                        {project.hasOverride ? t('dir.custom') : t('dir.default')}
                      </Tag>
                    </span>
                  </span>
                  {project.slug !== undefined && project.slug !== '' && (
                    <span className={css.cardRole}>{t('slug.label')}：{project.slug}</span>
                  )}
                </div>
              </div>

              <div className={css.cardChips}>
                <span className={css.cardChip} title={project.dir}>{project.dir}</span>
              </div>

              <div className={css.cardFooter}>
                <span className={css.cardProject}>{t('dir.current')}</span>
                <span className={css.cardFooterActions}>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<IconEditOutlineRegular size={14} />}
                    onClick={() => { openDirEditor(project) }}
                  >
                    {t('dir.set')}
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dirTarget !== null && (
        <Modal
          open
          onClose={closeDirEditor}
          title={t('dir.title')}
          headless
          className={css.drawer ?? ''}
        >
          <header className={css.drawerHeader}>
            <h2 className={css.drawerTitle}>{t('dir.title')}</h2>
            <Button size="sm" variant="ghost" onClick={closeDirEditor} aria-label={t('dir.cancel')}>{t('dir.cancel')}</Button>
          </header>

          <form id={DIR_FORM_ID} className={css.drawerBody} onSubmit={submitDir}>
            <p className={css.drawerDescription}>{t('dir.description')}</p>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('dir.input')}</span>
              <Input
                value={dirValue}
                onChange={(event) => { setDirValue(event.target.value) }}
                placeholder={dirTarget.dir}
                aria-label={t('dir.input')}
              />
              <p className={css.formHint}>{t('dir.hint')}</p>
            </div>
            <div className={css.formField}>
              <span className={css.formLabel}>{t('dir.defaultValue')}</span>
              <p className={css.formValue}>{dirTarget.defaultDir}</p>
            </div>
          </form>

          <footer className={css.drawerFooter}>
            <Button variant="ghost" onClick={closeDirEditor}>{t('dir.cancel')}</Button>
            {dirTarget.hasOverride && (
              <Button variant="ghost" disabled={submitting} onClick={resetDir}>{t('dir.reset')}</Button>
            )}
            <Button variant="primary" type="submit" form={DIR_FORM_ID} disabled={submitting}>{t('dir.save')}</Button>
          </footer>
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
