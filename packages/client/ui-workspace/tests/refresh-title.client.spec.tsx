// @vitest-environment jsdom
/**
 * The composer's title trigger. It owns exactly the three outcomes a refresh can
 * report — pending while the Host works, confirmed after an accepted revision,
 * and back to its action label when nothing was accepted — plus the guarantee
 * that a second click cannot queue another revision while one is in flight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RefreshTitle, type RefreshTitleProps } from '../src/client/RefreshTitle.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 'session-refresh' as SessionId
const t = (key: keyof typeof zh): string => zh[key]

function bench(refreshTitle: RefreshTitleProps['refreshTitle']): HTMLButtonElement {
  render(<RefreshTitle {...{ sessionId: SESSION, refreshTitle, t } as RefreshTitleProps} />)
  return screen.getByRole('button')
}

describe('RefreshTitle', () => {
  it('asks the Host, stays inert while the answer is out, then confirms an accepted title', async () => {
    const pending = Promise.withResolvers<boolean>()
    const refreshTitle = vi.fn(() => pending.promise)
    const button = bench(refreshTitle)
    expect(button.textContent).toContain(zh['regenerate'])

    fireEvent.click(button)
    expect(refreshTitle).toHaveBeenCalledWith(SESSION)
    expect(button.textContent).toContain(zh['regenerate.pending'])
    expect(button.hasAttribute('disabled')).toBe(true)

    // The disabled button refuses a second request rather than queueing one.
    fireEvent.click(button)
    expect(refreshTitle).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve(true) })
    expect(button.textContent).toContain(zh['regenerate.confirmed'])
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('returns to its action label when the Host accepted nothing', async () => {
    const button = bench(vi.fn(async () => false))
    fireEvent.click(button)
    await act(async () => { await Promise.resolve() })
    expect(button.textContent).toContain(zh['regenerate'])
    expect(button.textContent).not.toContain(zh['regenerate.confirmed'])
  })
})
