// @vitest-environment jsdom
/**
 * The board rail over hand-built props: group resolution through the Session
 * tree, the proxied iframe URL, refresh, collapse, and the poll that picks up
 * an agent-written board URL without a page reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { BoardRail, type BoardRailProps } from '../src/client/AgentGroupBoard.tsx'
import { zh } from '../src/client/locales.ts'

const sid = (value: string): SessionId => value as SessionId
const t = makeTranslate(zh, commonZh)

/** jsdom has no ResizeObserver; the rail only needs the subscription to exist. */
class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

function listState(...summaries: SessionSummary[]): SessionListState {
  const byId = {} as SessionListState['byId']
  for (const entry of summaries) byId[entry.id] = entry
  return {
    ids: summaries.map(entry => entry.id),
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

function group(sessionIds: string[], boardUrl?: string): AgentGroupView {
  return {
    id: 'custom:2',
    name: '模型上线测试-1111',
    sessionIds: sessionIds.map(sid),
    ...boardUrl === undefined ? {} : { boardUrl },
  }
}

function rail(
  summaries: SessionSummary[],
  sessionId: string,
  groups: () => Promise<readonly AgentGroupView[]>,
  openFile: BoardRailProps['openFile'] = vi.fn(),
  launch: BoardRailProps['launch'] = { groupId: undefined, template: undefined },
) {
  const state = listState(...summaries)
  const useSessions: BoardRailProps['useSessions'] = selector => selector(state)
  return render(
    <BoardRail
      sessionId={sid(sessionId)}
      useSessions={useSessions}
      launch={launch}
      loadGroups={groups}
      openFile={openFile}
      t={t}
    />,
  )
}

describe('BoardRail', () => {
  it('stays out of the templated home, which carries no Session concept', async () => {
    const loadGroups = vi.fn(async () => [group(['session-root'], 'https://boards.example/qa')])
    const view = rail([summary('session-root')], 'session-root', loadGroups, vi.fn(), {
      groupId: undefined,
      template: 'modellaunch',
    })
    await waitFor(() => { expect(view.container.firstChild).toBeNull() })
    expect(loadGroups).not.toHaveBeenCalled()
  })

  it('still shows the board on a templated group link', async () => {
    const view = rail(
      [summary('session-root')],
      'session-root',
      () => Promise.resolve([group(['session-root'], 'https://boards.example/qa')]),
      vi.fn(),
      { groupId: 'custom:2', template: 'modellaunch' },
    )
    await waitFor(() => {
      const src = view.container.querySelector('iframe')?.getAttribute('src')
      expect(src?.startsWith('/agent-group-board?group=custom%3A2')).toBe(true)
    })
  })

  it('renders nothing while the group has no board URL', async () => {
    const view = rail([summary('session-root')], 'session-root', () => Promise.resolve([group(['session-root'])]))
    await waitFor(() => { expect(view.container.firstChild).toBeNull() })
  })

  it('embeds the Host proxy for a group member', async () => {
    const view = rail(
      [summary('session-root')],
      'session-root',
      () => Promise.resolve([group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]),
    )
    const frame = await waitFor(() => {
      const element = view.container.querySelector('iframe')
      if (element === null) throw new Error('board iframe not rendered')
      return element
    })
    expect(frame.getAttribute('src')).toBe('/agent-group-board?group=custom%3A2&_=0')
    expect(frame.getAttribute('title')).toBe('模型上线测试-1111')
    expect(view.getByText('模型上线测试-1111')).toBeTruthy()
  })

  it('shows the board for a subagent child of a group member', async () => {
    const view = rail(
      [summary('session-root'), summary('session-child', 'session-root')],
      'session-child',
      () => Promise.resolve([group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]),
    )
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
  })

  it('reloads the iframe on refresh and collapses to an expand control', async () => {
    const view = rail(
      [summary('session-root')],
      'session-root',
      () => Promise.resolve([group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]),
    )
    const frame = await waitFor(() => {
      const element = view.container.querySelector('iframe')
      if (element === null) throw new Error('board iframe not rendered')
      return element
    })

    fireEvent.click(view.getByRole('button', { name: '刷新' }))
    expect(frame.getAttribute('src')).toBe('/agent-group-board?group=custom%3A2&_=1')

    fireEvent.click(view.getByRole('button', { name: '收起' }))
    expect(view.container.querySelector('iframe')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '展开看板' }))
    expect(view.container.querySelector('iframe')?.getAttribute('src'))
      .toBe('/agent-group-board?group=custom%3A2&_=1')
  })

  it('opens a board file only for the sandboxed board iframe', async () => {
    const openFile = vi.fn()
    const view = rail(
      [summary('session-root')],
      'session-root',
      () => Promise.resolve([group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]),
      openFile,
    )
    const frame = await waitFor(() => {
      const element = view.container.querySelector('iframe')
      if (element === null) throw new Error('board iframe not rendered')
      return element
    })
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: window })

    fireEvent(window, new MessageEvent('message', {
      data: { type: 'dsh:open-file', path: '.tmp/qa-run/report/qa-report.md', line: 24 },
      origin: 'null',
      source: window,
    }))
    expect(openFile).toHaveBeenCalledWith(sid('session-root'), {
      path: '.tmp/qa-run/report/qa-report.md',
      line: 24,
    })

    openFile.mockClear()
    fireEvent(window, new MessageEvent('message', {
      data: { type: 'dsh:open-file', path: '.tmp/qa-run/report/qa-report.md' },
      origin: 'http://10.37.242.122:3080',
      source: window,
    }))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('ignores a message from any window other than the board iframe', async () => {
    const openFile = vi.fn()
    const view = rail(
      [summary('session-root')],
      'session-root',
      () => Promise.resolve([group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]),
      openFile,
    )
    const frame = await waitFor(() => {
      const element = view.container.querySelector('iframe')
      if (element === null) throw new Error('board iframe not rendered')
      return element
    })
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: {} })

    fireEvent(window, new MessageEvent('message', {
      data: { type: 'dsh:open-file', path: '.tmp/qa-run/report/qa-report.md' },
      origin: 'null',
      source: window,
    }))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('picks up a board URL written after the rail first loaded', async () => {
    let groups: readonly AgentGroupView[] = [group(['session-root'])]
    let reads = 0
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const view = rail([summary('session-root')], 'session-root', () => {
      reads += 1
      return Promise.resolve(groups)
    })
    await waitFor(() => { expect(reads).toBe(1) })
    expect(view.container.querySelector('iframe')).toBeNull()

    groups = [group(['session-root'], 'http://127.0.0.1:8765/t/qa-1')]
    const tick = intervals.mock.calls.find(call => call[1] === 5_000)?.[0]
    if (typeof tick !== 'function') throw new Error('the rail registered no polling interval')
    await act(async () => {
      tick()
      await Promise.resolve()
    })

    const firstFrame = await waitFor(() => {
      const element = view.container.querySelector('iframe')
      if (element === null) throw new Error('board iframe not rendered')
      return element
    })

    groups = [group(['session-root'], 'http://127.0.0.1:8765/t/qa-2')]
    await act(async () => {
      tick()
      await Promise.resolve()
    })

    // The route source changes with the URL, so the iframe remounts to show it.
    await waitFor(() => {
      const next = view.container.querySelector('iframe')
      expect(next).not.toBeNull()
      expect(next).not.toBe(firstFrame)
    })
  })
})
