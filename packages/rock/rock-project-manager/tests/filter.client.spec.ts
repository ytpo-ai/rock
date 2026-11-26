import { describe, expect, it } from 'vitest'
import { filterProjects } from '../src/client/filter.ts'
import type { ProjectRow } from '../src/types.ts'

/** Build a minimal panel row. */
function row(id: string, name: string, slug?: string): ProjectRow {
  const dirName = slug ?? id
  return { id, name, ...(slug === undefined ? {} : { slug }), dir: `/root/projects/${dirName}`, defaultDir: `/root/projects/${dirName}`, hasOverride: false }
}

describe('filterProjects', () => {
  const projects = [row('p1', 'Life Script', 'life-script'), row('p2', '八字分析'), row('p3', 'Foo', 'foo')]

  it('returns the full list for an empty or whitespace query', () => {
    expect(filterProjects(projects, '')).toHaveLength(3)
    expect(filterProjects(projects, '   ')).toHaveLength(3)
  })

  it('matches name, id, and slug case-insensitively', () => {
    expect(filterProjects(projects, 'life').map(p => p.id)).toEqual(['p1'])
    expect(filterProjects(projects, 'P2').map(p => p.id)).toEqual(['p2'])
    expect(filterProjects(projects, 'FOO').map(p => p.id)).toEqual(['p3'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterProjects(projects, 'nope')).toEqual([])
  })
})
