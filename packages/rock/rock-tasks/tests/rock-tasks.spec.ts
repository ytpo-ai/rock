import { describe, expect, it } from 'vitest'
import { projectsFrom, taskFrom, tasksFrom } from '../src/tasks.ts'
import { foldOverview, startOfDayShanghai, startOfMonthShanghai, startOfWeekShanghai } from '../src/overview.ts'

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

describe('Shanghai period bounds', () => {
  const now = new Date('2026-11-27T10:00:00.000Z') // Shanghai 2026-11-27 18:00 (Friday)

  it('normalizes day/week/month starts to Asia/Shanghai midnight', () => {
    expect(startOfDayShanghai(now).toISOString()).toBe('2026-11-26T16:00:00.000Z')
    expect(startOfWeekShanghai(now).toISOString()).toBe('2026-11-22T16:00:00.000Z')
    expect(startOfMonthShanghai(now).toISOString()).toBe('2026-10-31T16:00:00.000Z')
  })
})

describe('foldOverview', () => {
  const now = new Date('2026-11-27T10:00:00.000Z')

  function task(id: string, executorId: string, status: string, createdAt: string, resolution?: string, type = 'task') {
    return { id, type, title: id, description: '', status, executorId, createdAt, ...(resolution === undefined ? {} : { resolution }) }
  }

  it('folds tasks and adapter logs into counts, totals, and a sorted leaderboard', () => {
    const tasks = [
      task('t1', 'bot-a', 'done', '2026-11-27T02:00:00.000Z', 'accepted'), // today, accepted
      task('t2', 'bot-a', 'in-progress', '2026-11-24T00:00:00.000Z'), // this week, started
      task('t3', 'bot-b', 'pending', '2026-11-10T00:00:00.000Z'), // this month, assigned only
      task('t4', 'bot-b', 'cancelled', '2026-11-10T00:00:00.000Z'), // excluded
      task('t5', 'bot-c', 'done', '2026-11-10T00:00:00.000Z', 'rejected'), // started + assigned, not accepted
    ]
    const bots = [
      { id: 'bot-a', name: 'Coder-A', source: 'claimed' },
      { id: 'bot-b', name: 'Coder-B', source: 'claimed' },
      { id: 'bot-c', name: 'Coder-C', source: 'claimed' },
    ]
    const projects = [{ id: 'p1', name: 'P1' }]
    const logs = [
      { timestamp: '2026-11-27T03:00:00.000Z', agentBotId: 'bot-a', botName: 'Coder-A', tokens: { input: 100, output: 50, total: 150 } },
      { timestamp: '2026-11-24T03:00:00.000Z', agentBotId: 'bot-a', tokens: { input: 200, output: 100 } },
    ]

    const result = foldOverview(tasks, bots, projects, logs, now)

    expect(result.counts).toEqual({ bots: 3, projects: 1, executing: 1, pendingReview: 0 })
    expect(result.totals).toEqual({
      today: { tasks: 1, tokens: 150, accepted: 1, assigned: 1 },
      week: { tasks: 2, tokens: 450, accepted: 1, assigned: 2 },
      month: { tasks: 3, tokens: 450, accepted: 1, assigned: 4 },
    })
    // 按本月 started 任务数降序：bot-a(2) > bot-c(1)；bot-b started=0 且无 token 被过滤
    expect(result.byBot.map(row => row.botId)).toEqual(['bot-a', 'bot-c'])
    expect(result.byBot[0]).toMatchObject({
      botId: 'bot-a',
      botName: 'Coder-A',
      today: { tasks: 1, tokens: 150 },
      week: { tasks: 2, tokens: 450 },
      month: { tasks: 2, tokens: 450 },
    })
    expect(result.byBot[1]).toMatchObject({
      botId: 'bot-c',
      botName: 'Coder-C',
      today: { tasks: 0, tokens: 0 },
      month: { tasks: 1, tokens: 0 },
    })
  })

  it('returns empty totals and leaderboard when there is no activity', () => {
    const result = foldOverview([], [], [], [], now)
    expect(result.counts).toEqual({ bots: 0, projects: 0, executing: 0, pendingReview: 0 })
    expect(result.totals.month).toEqual({ tasks: 0, tokens: 0, accepted: 0, assigned: 0 })
    expect(result.byBot).toEqual([])
  })
})
