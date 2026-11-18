import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkspaceService } from '../src/service.ts'

/** Build a service backed by a fresh temp directory. */
async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'rock-workspace-'))
  const service = new WorkspaceService({
    workspacePath: join(dir, '.rock', 'workspace.json'),
    defaultRoot: join(dir, 'default-root'),
  })
  return { dir, service }
}

describe('WorkspaceService', () => {
  it('starts uninitialized and ensureInitialized creates the default skeleton', async () => {
    const { dir, service } = await makeService()
    try {
      expect(service.getState()).toBeNull()

      const state = service.ensureInitialized()
      expect(state.rootPath).toBe(resolve(join(dir, 'default-root')))
      expect(existsSync(join(state.rootPath, 'tasks'))).toBe(true)
      expect(existsSync(join(state.rootPath, 'projects'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists state and replays it across restarts', async () => {
    const { dir, service } = await makeService()
    try {
      service.initialize(join(dir, 'my-root'))

      const revived = new WorkspaceService({
        workspacePath: join(dir, '.rock', 'workspace.json'),
        defaultRoot: join(dir, 'default-root'),
      })
      expect(revived.rootPath()).toBe(resolve(join(dir, 'my-root')))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves task paths by project presence', async () => {
    const { dir, service } = await makeService()
    try {
      const root = service.ensureInitialized().rootPath
      expect(service.resolveTaskPath('task-1')).toBe(join(root, 'tasks', 'task-1.jsonl'))
      expect(service.resolveTaskPath('task-2', 'proj-a')).toBe(
        join(root, 'projects', 'proj-a', 'tasks', 'task-2.jsonl'),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses the synced slug as the project directory name and resolves the project dir', async () => {
    const { dir, service } = await makeService()
    try {
      const root = service.ensureInitialized().rootPath
      service.syncProjects([{ id: 'proj-a', name: 'Project A', slug: 'project-a' }])

      expect(service.resolveTaskPath('task-2', 'proj-a')).toBe(
        join(root, 'projects', 'project-a', 'tasks', 'task-2.jsonl'),
      )
      expect(service.resolveProjectDir('proj-a')).toBe(join(root, 'projects', 'project-a'))
      expect(existsSync(join(root, 'projects', 'project-a'))).toBe(true)
      expect(existsSync(join(root, 'projects', 'project-a', 'tasks'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects path-traversal segments in task and project ids', async () => {
    const { dir, service } = await makeService()
    try {
      service.ensureInitialized()
      expect(() => service.resolveTaskPath('../evil')).toThrow()
      expect(() => service.resolveTaskPath('task-1', 'a/b')).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('mirrors the project list into project task directories', async () => {
    const { dir, service } = await makeService()
    try {
      const root = service.ensureInitialized().rootPath
      const projects = [{ id: 'proj-a', name: 'Project A' }]
      service.syncProjects(projects)

      expect(existsSync(join(root, 'projects', 'proj-a', 'tasks'))).toBe(true)
      expect(service.listProjects()).toEqual(projects)

      // The mirrored list persists beside the state file.
      const projectsPath = join(dir, '.rock', 'projects.json')
      expect(JSON.parse(readFileSync(projectsPath, 'utf8'))).toEqual(projects)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when resolving a path before initialization', async () => {
    const { dir, service } = await makeService()
    try {
      expect(() => service.resolveTaskPath('task-1')).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exposes the expanded default root without initializing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rock-workspace-'))
    try {
      const service = new WorkspaceService({
        workspacePath: join(dir, '.rock', 'workspace.json'),
        defaultRoot: '~/Documents/SeagullWorkspace',
      })
      expect(service.defaultRoot()).toBe(resolve(join(homedir(), 'Documents', 'SeagullWorkspace')))
      expect(service.getState()).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
