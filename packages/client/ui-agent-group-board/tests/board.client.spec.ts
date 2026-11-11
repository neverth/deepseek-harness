import { describe, expect, it } from 'vitest'
import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { boardGroupFor, rootSessionId, sameGroupDocument } from '../src/client/board.ts'

const sid = (value: string): SessionId => value as SessionId

function summary(id: string, parentId?: string): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    updatedAt: 1,
    running: false,
    retainedBy: {},
    blank: false,
    ...parentId === undefined ? {} : { parentId: sid(parentId), origin: 'subagent' as const },
  }
}

function byId(...summaries: SessionSummary[]): SessionListState['byId'] {
  const state = {} as SessionListState['byId']
  for (const entry of summaries) state[entry.id] = entry
  return state
}

function group(id: string, name: string, sessionIds: string[], boardUrl?: string): AgentGroupView {
  return {
    id,
    name,
    sessionIds: sessionIds.map(sid),
    ...boardUrl === undefined ? {} : { boardUrl },
  }
}

describe('rootSessionId', () => {
  it('walks nested parents to the topmost Session', () => {
    const state = byId(summary('root'), summary('child', 'root'), summary('grandchild', 'child'))
    expect(rootSessionId(state, sid('grandchild'))).toBe(sid('root'))
    expect(rootSessionId(state, sid('child'))).toBe(sid('root'))
    expect(rootSessionId(state, sid('root'))).toBe(sid('root'))
  })

  it('keeps an unknown Session as its own root and survives a parent cycle', () => {
    expect(rootSessionId(byId(), sid('missing'))).toBe(sid('missing'))
    const cycle = byId(summary('a', 'b'), summary('b', 'a'))
    expect(rootSessionId(cycle, sid('a'))).toBe(sid('a'))
  })
})

describe('boardGroupFor', () => {
  const groups = [
    group('custom:1', 'Release', ['session-a']),
    group('custom:2', '模型上线测试-1111', ['session-root'], 'http://127.0.0.1:8765/t/qa-1'),
  ]

  it('matches a direct member of a group with a board', () => {
    expect(boardGroupFor(groups, sid('session-root'), sid('session-root'))).toEqual({
      id: 'custom:2',
      name: '模型上线测试-1111',
      boardUrl: 'http://127.0.0.1:8765/t/qa-1',
    })
  })

  it('matches a subagent child through its root member', () => {
    expect(boardGroupFor(groups, sid('session-child'), sid('session-root'))?.id).toBe('custom:2')
  })

  it('ignores groups without a board and Sessions without a group', () => {
    expect(boardGroupFor(groups, sid('session-a'), sid('session-a'))).toBeUndefined()
    expect(boardGroupFor(groups, sid('session-other'), sid('session-other'))).toBeUndefined()
    expect(boardGroupFor(groups, undefined, undefined)).toBeUndefined()
  })
})

describe('sameGroupDocument', () => {
  it('ignores nothing the rail reads and notices every changed fact', () => {
    const base = [group('custom:2', 'QA', ['a', 'b'], 'http://boards/one')]
    expect(sameGroupDocument(base, [group('custom:2', 'QA', ['a', 'b'], 'http://boards/one')])).toBe(true)
    expect(sameGroupDocument(base, [group('custom:2', 'QA', ['a'], 'http://boards/one')])).toBe(false)
    expect(sameGroupDocument(base, [group('custom:2', 'Renamed', ['a', 'b'], 'http://boards/one')])).toBe(false)
    expect(sameGroupDocument(base, [group('custom:2', 'QA', ['a', 'b'], 'http://boards/two')])).toBe(false)
    expect(sameGroupDocument(base, [])).toBe(false)
  })
})
