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

/** Install the async browser clipboard and restore its prior host shape. */
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return () => {
    if (prior === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', prior)
  }
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

  it('keeps the more-actions menu without the feedback row when that plugin is absent', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Copy Session ID' })).toBeTruthy()
  })

  it('adds and drops the feedback row as that plugin loads and unloads', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()

    act(() => { b.feedback.set(true) })
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    act(() => { b.feedback.set(false) })
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Copy Session ID' })).toBeTruthy()
  })

  it('copies the Session ID and confirms it on the row without opening feedback', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const restore = installClipboard(writeText)
    try {
      const b = bench(true)
      fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
      fireEvent.click(b.view.getByRole('menuitem', { name: 'Copy Session ID' }))
      // The accepted write flips the row label; the menu stays open for it.
      expect(await b.view.findByRole('menuitem', { name: 'Session ID copied' })).toBeTruthy()
      expect(writeText).toHaveBeenCalledWith(SID)
      expect(b.openFeedback).not.toHaveBeenCalled()
    } finally {
      restore()
    }
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
    // The seat's only control is the more-actions trigger; `/export` owns downloading.
    expect(b.view.getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(['More actions'])

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
