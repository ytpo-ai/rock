import { describe, expect, it } from 'vitest'
import { projectsFrom, taskFrom, tasksFrom } from '../src/tasks.ts'

describe('tasksFrom', () => {
  it('projects the gateway envelope body and drops malformed rows', () => {
    const body = {
      code: 0,
      message: 'success',
      data: {
        tasks: [
          { id: 't1', type: 'task', title: 'Ship it', description: '', status: 'in-progress', executorId: 'bot-a' },
          { id: 't2', type: 'requirement', title: 'Plan', description: 'd', status: 'pending', executorId: 'bot-b', assignee: 'e', projectId: 'p', parentId: 'r' },
          { id: '', title: 'nope' },
          null,
          'x',
        ],
      },
    }
    expect(tasksFrom(body)).toEqual([
      { id: 't1', type: 'task', title: 'Ship it', description: '', status: 'in-progress', executorId: 'bot-a' },
      { id: 't2', type: 'requirement', title: 'Plan', description: 'd', status: 'pending', executorId: 'bot-b', assignee: 'e', projectId: 'p', parentId: 'r' },
    ])
  })

  it('returns an empty list for a non-object or non-array body', () => {
    expect(tasksFrom(null)).toEqual([])
    expect(tasksFrom({ data: { tasks: 'nope' } })).toEqual([])
    expect(tasksFrom({ tasks: [] })).toEqual([])
  })
})

describe('taskFrom', () => {
  it('projects one gateway envelope task', () => {
    expect(taskFrom({ code: 0, message: 'success', data: { id: 'w1', type: 'task', title: 'T', description: '', status: 'in-progress', executorId: 'bot-1' } }))
      .toEqual({ id: 'w1', type: 'task', title: 'T', description: '', status: 'in-progress', executorId: 'bot-1' })
  })

  it('returns null for a malformed body', () => {
    expect(taskFrom(null)).toBeNull()
    expect(taskFrom({ data: { status: 'pending' } })).toBeNull()
  })
})

describe('projectsFrom', () => {
  it('projects the gateway envelope body and drops malformed rows', () => {
    const body = {
      code: 0,
      message: 'success',
      data: {
        projects: [
          { id: 'p1', name: 'Project A', slug: 'project-a' },
          { id: 'p2', name: 'Project B' },
          { id: '', name: 'nope' },
          null,
          'x',
        ],
      },
    }
    expect(projectsFrom(body)).toEqual([
      { id: 'p1', name: 'Project A', slug: 'project-a' },
      { id: 'p2', name: 'Project B' },
    ])
  })

  it('returns an empty list for a non-object or non-array body', () => {
    expect(projectsFrom(null)).toEqual([])
    expect(projectsFrom({ data: { projects: 'nope' } })).toEqual([])
    expect(projectsFrom({ projects: [] })).toEqual([])
  })
})
