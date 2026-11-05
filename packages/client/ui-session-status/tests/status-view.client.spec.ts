// @vitest-environment jsdom
/** Explicit confirmation of observed completions while the main view changes. */
import { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionReadSnapshot } from '../src/client/model.ts'
import { UiSessionStatus } from '../src/client/status.ts'
import type { SessionReadState } from '../src/types.ts'

const viewed = 'viewed' as SessionId
const other = 'other' as SessionId
const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  let emit: ((id: SessionId, running: boolean) => void) | undefined
  ctx.provide('remote', {
    $on: (_name: string, listener: typeof emit) => { emit = listener; return () => { emit = undefined } },
  } as never)
  const row = (id: SessionId, mainView: boolean) => ({
    id, displayTitle: id, running: false, retainedBy: mainView ? { mainView: 1 } : {}, blank: false, updatedAt: 1,
  })
  const list = createSnapshotStore<SessionListState>({
    ids: [viewed, other], phase: 'ready', projectionsBySession: {},
    byId: { [viewed]: row(viewed, true), [other]: row(other, false) },
  })
  const record = (id: SessionId, value: Partial<SessionReadState>): SessionReadState => ({
    sessionId: id, completedTurn: 1, failed: true, readTurn: 0, manualUnread: false, ...value,
  })
  const opened = (id: SessionId) => ({
    sessionId: id, session: createSnapshotStore<{ readonly openState: string; readonly running?: boolean }>({ openState: 'open' }),
  })
  const bindings = new Map([viewed, other].map(id => [id, opened(id)]))
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const service = new UiSessionStatus(ctx, { list, binding: (id: SessionId) => bindings.get(id) as never },
    createSnapshotStore<ReadonlyMap<SessionId, SessionPendingInteraction>>(new Map()))
  const reading: { set(value: SessionReadSnapshot): void } = service.reading.state
  reading.set({ ready: true, items: { [viewed]: record(viewed, {}), [other]: record(other, {}) } })
  if (emit === undefined) throw new Error('status source is not subscribed')
  for (const id of [viewed, other]) { emit(id, true); emit(id, false) }
  list.update((draft) => { draft.byId[viewed] = row(viewed, true) })
  const status = (id: SessionId) => service.getSnapshot().get(id)
  const view = (id: SessionId) => {
    list.update((draft) => {
      for (const key of [viewed, other]) draft.byId[key] = row(key, key === id)
    })
  }
  const openState = (id: SessionId, state: string) => { bindings.get(id)!.session.set({ openState: state }) }
  const snapshot = (id: SessionId, value: { readonly openState: string; readonly running?: boolean }) => {
    bindings.get(id)!.session.set(value)
  }
  return { ctx, reading, record, focus, visibility, status, view, openState, service, snapshot }
}

it('keeps the viewed completion pending explicit confirmation across window focus and visibility changes', () => {
  const b = bench()
  expect(b.status(viewed)).toMatchObject({ completionUnread: false, completionPendingAck: true, completionFailed: false })
  expect(b.status(other)).toMatchObject({ completionUnread: true, completionFailed: true })

  b.focus.mockReturnValue(false)
  window.dispatchEvent(new Event('blur'))
  expect(b.status(viewed)).toMatchObject({ completionUnread: false, completionPendingAck: true, completionFailed: false })
  b.focus.mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  expect(b.status(viewed)?.completionUnread).toBe(false)

  b.visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(b.status(viewed)?.completionPendingAck).toBe(true)
  b.service.acknowledgeCompletion(viewed)
  expect(b.status(viewed)?.completionPendingAck).toBe(false)
})

it('keeps a manual reminder of the viewed Session visible', () => {
  const b = bench()
  b.reading.set({ ready: true, items: { [viewed]: b.record(viewed, { readTurn: 1, manualUnread: true }) } })
  expect(b.status(viewed)).toMatchObject({ completionUnread: true, completionFailed: true })
})

it('keeps an opened completion pending when the main view switches to another Session', () => {
  const b = bench()
  b.view(other)
  expect(b.status(viewed)).toMatchObject({ completionUnread: false, completionPendingAck: true })
  expect(b.status(other)).toMatchObject({ completionUnread: false, completionPendingAck: true })
})

it('does not acknowledge the viewed completion when loading or open-state updates arrive', () => {
  const b = bench()
  b.openState(viewed, 'loading')
  expect(b.status(viewed)).toMatchObject({ completionUnread: false, completionPendingAck: true })
  b.openState(viewed, 'error')
  expect(b.status(viewed)?.completionPendingAck).toBe(true)
  b.openState(viewed, 'open')
  expect(b.status(viewed)).toMatchObject({ completionUnread: false, completionPendingAck: true })
})

it('does not rebuild the table when the viewed Session snapshot changes without an open-state change', () => {
  const b = bench()
  const before = b.service.getSnapshot()
  const changed = vi.fn()
  b.service.subscribe(changed)
  const rebuild = vi.spyOn(b.service.reading.state, 'getSnapshot')
  b.snapshot(viewed, { openState: 'open', running: true })
  expect(rebuild).not.toHaveBeenCalled()
  expect(b.service.getSnapshot()).toBe(before)
  expect(changed).not.toHaveBeenCalled()
})
