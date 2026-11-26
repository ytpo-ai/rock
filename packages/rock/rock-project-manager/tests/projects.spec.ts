import { describe, expect, it } from 'vitest'
import { buildProjectRow, buildProjectRows, projectsFrom, type ProjectDirResolver } from '../src/projects.ts'

describe('projectsFrom', () => {
  it('returns an empty list for non-object bodies', () => {
    expect(projectsFrom(null)).toEqual([])
    expect(projectsFrom('x')).toEqual([])
    expect(projectsFrom({})).toEqual([])
    expect(projectsFrom({ data: {} })).toEqual([])
  })

  it('projects the gateway data envelope', () => {
    const rows = projectsFrom({ data: { projects: [{ id: 'p1', name: 'One', slug: 'one' }, { id: 'p2', name: 'Two' }] } })
    expect(rows).toEqual([{ id: 'p1', name: 'One', slug: 'one' }, { id: 'p2', name: 'Two' }])
  })

  it('drops malformed entries', () => {
    const rows = projectsFrom({ data: { projects: [{ id: 'p1', name: 'One' }, { name: 'NoId' }, null, 5, { id: '', name: 'EmptyId' }] } })
    expect(rows).toEqual([{ id: 'p1', name: 'One' }])
  })
})

describe('buildProjectRow(s)', () => {
  const resolver: ProjectDirResolver = {
    defaultProjectDir: id => `/root/projects/${id}`,
    projectDir: id => (id === 'p2' ? '/custom/p2' : `/root/projects/${id}`),
    projectDirOverride: id => (id === 'p2' ? '/custom/p2' : undefined),
  }

  it('folds the resolver into a panel row with override flags', () => {
    expect(buildProjectRow({ id: 'p1', name: 'One', slug: 'one' }, resolver)).toEqual({
      id: 'p1', name: 'One', slug: 'one', dir: '/root/projects/p1', defaultDir: '/root/projects/p1', hasOverride: false,
    })
    expect(buildProjectRow({ id: 'p2', name: 'Two' }, resolver)).toEqual({
      id: 'p2', name: 'Two', dir: '/custom/p2', defaultDir: '/root/projects/p2', hasOverride: true,
    })
  })

  it('projects a whole list preserving order', () => {
    const rows = buildProjectRows([{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }], resolver)
    expect(rows.map(row => row.id)).toEqual(['p1', 'p2'])
  })
})
