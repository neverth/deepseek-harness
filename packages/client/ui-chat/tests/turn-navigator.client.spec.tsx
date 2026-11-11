// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { TurnNavigator } from '../src/client/chat/TurnNavigator.tsx'
import type { TurnRailItem } from '../src/client/chat/turn-rail-items.ts'
import { zh } from '../src/client/locale.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  observers.length = 0
})

const t = makeTranslate(zh, commonZh)

function item(turn: number, prompt: string, loaded: boolean): TurnRailItem {
  return {
    turn,
    prompt,
    response: '',
    anchor: loaded
      ? { kind: 'loaded', key: `turn:${String(turn)}` }
      : { kind: 'unloaded', seq: SessionSeq(turn) },
  }
}

/** jsdom has no layout: hand the gutter measurement explicit rectangles. */
function domRect(right: number): DOMRect {
  return {
    x: 0, y: 0, width: right, height: 100, top: 0, right, bottom: 100, left: 0,
    toJSON: () => ({}),
  } as DOMRect
}

/** Records every observer so a case can fire the measurement after mounting. */
const observers: ResizeObserverCallback[] = []
class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) { observers.push(callback) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Render the rail inside the scrollport and flow row its gutter is measured from. */
function mountRail(): ReturnType<typeof render> {
  return render(
    <div data-conversation-scroll="">
      <div data-chat-flow-kind="assistant-step" />
      <TurnNavigator items={[item(1, 'first', true), item(2, 'second', true)]}
        activeTurn={2} busyTurn={null} onNavigate={vi.fn()} t={t} />
    </div>,
  )
}

describe('TurnNavigator', () => {
  it('stays absent until a session has two turns', () => {
    const view = render(
      <TurnNavigator items={[item(1, 'only', true)]} activeTurn={1} busyTurn={null} onNavigate={vi.fn()} t={t} />,
    )
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('stands one readable row per turn and navigates from the row itself', () => {
    const items = [item(1, 'first prompt', false), item(2, '', true)]
    const onNavigate = vi.fn()
    const view = render(
      <TurnNavigator items={items} activeTurn={2} busyTurn={1} onNavigate={onNavigate} t={t} />,
    )
    const rows = view.getAllByRole('button')
    expect(rows.map(row => row.textContent)).toEqual(['first prompt', '第 2 轮'])
    expect(rows[0]?.getAttribute('aria-label')).toBe('加载并跳转到第 1 轮')
    expect(rows[0]?.getAttribute('aria-busy')).toBe('true')
    expect(rows[1]?.getAttribute('aria-current')).toBe('true')
    fireEvent.click(rows[0]!)
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(items[0])
  })

  it('hides when the gutter beside the transcript cannot hold the outline', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const view = mountRail()
    const scroller = view.container.firstElementChild as HTMLElement
    const flow = scroller.firstElementChild as HTMLElement
    // 96px gutter: less than the default 160px rail plus its 20px inset.
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(domRect(780))
    vi.spyOn(flow, 'getBoundingClientRect').mockReturnValue(domRect(684))
    act(() => { for (const callback of observers) callback([], undefined as never) })
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('stays visible while the gutter holds the outline', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const view = mountRail()
    const scroller = view.container.firstElementChild as HTMLElement
    const flow = scroller.firstElementChild as HTMLElement
    // 240px gutter clears 160px + 20px with room to spare.
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(domRect(1120))
    vi.spyOn(flow, 'getBoundingClientRect').mockReturnValue(domRect(880))
    act(() => { for (const callback of observers) callback([], undefined as never) })
    expect(view.queryByRole('navigation')).not.toBeNull()
  })
})
