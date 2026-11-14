import { describe, expect, it } from 'vitest'
import { tasksFrom } from '../src/tasks.ts'

describe('tasksFrom', () => {
  it('projects a tasks body and drops malformed rows', () => {
    const body = {
      tasks: [
        { id: 't1', type: 'task', title: 'Ship it', description: '', status: 'in-progress', owner: 'bot-a' },
        { id: 't2', type: 'requirement', title: 'Plan', description: 'd', status: 'pending', owner: 'bot-b', acceptedBy: 'e', projectId: 'p', parentId: 'r' },
        { id: '', title: 'nope' },
        null,
        'x',
      ],
    }
    expect(tasksFrom(body)).toEqual([
      { id: 't1', type: 'task', title: 'Ship it', description: '', status: 'in-progress', owner: 'bot-a' },
      { id: 't2', type: 'requirement', title: 'Plan', description: 'd', status: 'pending', owner: 'bot-b', acceptedBy: 'e', projectId: 'p', parentId: 'r' },
    ])
  })

  it('returns an empty list for a non-object or non-array body', () => {
    expect(tasksFrom(null)).toEqual([])
    expect(tasksFrom({ tasks: 'nope' })).toEqual([])
  })
})
