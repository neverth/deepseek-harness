// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadHeaderProps } from '../src/client/HeaderAction.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSnapshot<State>(store: ObservableSnapshot<State>) {
  return function useSnapshot<T>(selector: (state: State) => T): T {
    return useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
    )
  }
}

function bench(feedbackAvailable = false) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const openFeedback = vi.fn()
  const feedback = createSnapshotStore(feedbackAvailable)
  const useSessionLogDownload = bindSnapshot(controller.store)
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    useFeedbackAvailable: bindSnapshot(feedback),
    openFeedback,
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadHeaderProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, openFeedback, feedback, view }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('opens Session feedback and closes the menu without a download row', () => {
    const b = bench(true)
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('shows no Header button when the feedback plugin is absent', () => {
    const b = bench()
    expect(b.view.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
  })

  it('updates the open menu when feedback becomes available and unloads', () => {
    const b = bench()
    expect(b.view.queryByRole('button', { name: 'More actions' })).toBeNull()

    act(() => { b.feedback.set(true) })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    act(() => { b.feedback.set(false) })
    expect(b.view.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape without opening feedback', () => {
    const b = bench(true)
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.openFeedback).not.toHaveBeenCalled()
  })

  it('hosts the result dialog without a Header download button', async () => {
    const b = bench()
    expect(b.view.queryByRole('button')).toBeNull()

    const controller = new SessionLogDownloadController(
      () => Promise.resolve(new Response('zip')),
      vi.fn(),
    )
    const useSessionLogDownload = bindSnapshot(controller.store)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessionLogDownload,
      useFeedbackAvailable: bindSnapshot(b.feedback),
      openFeedback: b.openFeedback,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadHeaderProps)} />)

    await controller.download(SID)
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })
})
