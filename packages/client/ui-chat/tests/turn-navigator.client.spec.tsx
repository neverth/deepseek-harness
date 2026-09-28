// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
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
})
