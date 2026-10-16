import { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionReadSnapshot } from '../src/client/model.ts'
import { apply } from '../src/client/index.ts'
import { UiSessionStatus } from '../src/client/status.ts'
import type { SessionReadState } from '../src/types.ts'

const sessionId = (value: string): SessionId => value as SessionId
const pendingQuestion = (id: SessionId) => ({ key: 'question:1', kind: 'question', sessionId: id }) as SessionPendingInteraction
const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  let statusListener: ((id: SessionId, running: boolean) => void) | undefined
  const remoteMark = vi.fn(async () => ({ ok: true as const, value: undefined }))
  ctx.provide('remote', {
    $on: (_event: string, listener: (id: SessionId, running: boolean) => void) => {
      statusListener = listener
      return () => { if (statusListener === listener) statusListener = undefined }
    },
    sessionStatus: { mark: remoteMark },
  } as never)
  const list = createSnapshotStore<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  const sessions: Pick<ISessions, 'list' | 'binding'> = { list, binding: () => undefined }
  const pending = createSnapshotStore<ReadonlyMap<SessionId, SessionPendingInteraction>>(new Map())
  // The status table owns its reading model; this facade drives the most recently created one with a ready baseline.
  let latest: UiSessionStatus | undefined
  const model = () => {
    if (latest === undefined) throw new Error('no status table was created')
    return latest.reading.state
  }
  const reading = {
    set: (value: SessionReadSnapshot) => { model().set(value) },
    getSnapshot: () => model().getSnapshot(),
  }
  const create = (scope: Context = ctx, catalog: Pick<ISessions, 'list' | 'binding'> = sessions) => {
    latest = new UiSessionStatus(scope, catalog, pending)
    latest.reading.replace([])
    return latest
  }
  const status = () => create()
  const row = (id: SessionId) => {
    list.update((draft) => {
      if (!draft.ids.includes(id)) draft.ids.push(id)
      draft.byId[id] = { id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 1 }
    })
  }
  const setMainView = (id: SessionId, count: number) => {
    list.update((draft) => {
      draft.byId[id] = { ...draft.byId[id]!, retainedBy: count === 0 ? {} : { mainView: count } }
    })
  }
  const emitStatus = (id: SessionId, running: boolean) => {
    if (statusListener === undefined) throw new Error('api-session/status is not subscribed')
    statusListener(id, running)
  }
  const record = (id: SessionId, value: Partial<SessionReadState>): SessionReadState => ({
    sessionId: id, completedTurn: 0, failed: false, readTurn: 0, manualUnread: false, ...value,
  })
  return {
    ctx, list, pending, reading, remoteMark, create, status, row, setMainView, emitStatus, record,
    subscribed: () => statusListener !== undefined,
  }
}

describe('Session running status', () => {
  it('keeps synthetic-row status unknown until an event or Host baseline establishes it', () => {
    const b = bench()
    const id = sessionId('catalog-only')
    b.list.update((draft) => {
      draft.byId[id] = { id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0 }
    })
    const service = b.status()
    expect(service.getSnapshot().get(id)?.running).toBeUndefined()

    b.emitStatus(id, true)
    b.list.update((draft) => { draft.byId[id]!.displayTitle = 'Renamed child' })
    expect(service.getSnapshot().get(id)?.running).toBe(true)

    b.list.update((draft) => { draft.ids.push(id) })
    expect(service.getSnapshot().get(id)?.running).toBe(false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
  })

  it('publishes running changes from list rows and status events, and skips unchanged status', () => {
    const b = bench()
    const id = sessionId('s1')
    b.row(id)
    const service = b.status()
    const changed = vi.fn()
    const off = service.subscribe(changed)

    expect(service.getSnapshot().get(id)).toEqual({
      running: false, pendingInteraction: undefined, completionUnread: false, completionPendingAck: false, completionFailed: false,
    })
    b.list.update((draft) => { draft.byId[id]!.running = true })
    expect(service.getSnapshot().get(id)?.running).toBe(true)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.running).toBe(false)
    expect(changed).toHaveBeenCalled()
    const calls = changed.mock.calls.length
    b.emitStatus(id, false)
    expect(changed).toHaveBeenCalledTimes(calls)
    off()
  })

  it('records an event before the initial catalog baseline and retires absent status later', () => {
    const b = bench()
    const id = sessionId('early')
    b.list.update((draft) => { draft.phase = 'pending' })
    const service = b.status()

    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)).toEqual({
      running: false, pendingInteraction: undefined, completionUnread: true, completionPendingAck: false, completionFailed: false,
    })
    b.list.update((draft) => { draft.phase = 'ready' })
    expect(service.getSnapshot().has(id)).toBe(false)
  })

  it('keeps the snapshot reference until a status fact changes', () => {
    const b = bench()
    const id = sessionId('s1')
    b.row(id)
    const service = b.status()
    const changed = vi.fn()
    service.subscribe(changed)
    const before = service.getSnapshot()

    b.emitStatus(id, false)
    b.list.update((draft) => { draft.byId[id]!.displayTitle = 'Renamed' })
    expect(service.getSnapshot()).toBe(before)
    expect(changed).not.toHaveBeenCalled()
    b.emitStatus(id, true)
    expect(service.getSnapshot()).not.toBe(before)
    expect(changed).toHaveBeenCalledOnce()
  })
})

describe('Session reading reminders', () => {
  it('keeps observed completion reminders until explicit acknowledgement and reads Host failure metadata', () => {
    const b = bench()
    const id = sessionId('s1')
    b.row(id)
    const service = b.status()
    b.emitStatus(id, true)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
    b.reading.set({ ready: true, items: { [id]: b.record(id, { completedTurn: 1, failed: true }) } })
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: true, completionFailed: true })
    b.reading.set({ ready: true, items: { [id]: b.record(id, { completedTurn: 2 }) } })
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: true, completionFailed: false })
    b.reading.set({ ready: true, items: { [id]: b.record(id, { completedTurn: 2, readTurn: 2, failed: true }) } })
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: true, completionFailed: true })
    service.acknowledgeCompletion(id)
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: false, completionFailed: false })
    b.reading.set({ ready: true, items: { [id]: b.record(id, { completedTurn: 2, readTurn: 2, manualUnread: true }) } })
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: true, completionFailed: false })
  })

  it('records every completion and downgrades a main-view open to an explicit acknowledgement', () => {
    const b = bench()
    const id = sessionId('s1')
    b.row(id)
    const service = b.status()
    b.emitStatus(id, true)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
    b.setMainView(id, 1)
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: false, completionPendingAck: true })
    service.acknowledgeCompletion(id)
    expect(service.getSnapshot().get(id)?.completionPendingAck).toBe(false)
    b.setMainView(id, 0)
    b.emitStatus(id, true)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
    b.setMainView(id, 1)
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: false, completionPendingAck: true })
    b.emitStatus(id, true)
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: false, completionPendingAck: false })
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
    b.setMainView(id, 0)
    b.setMainView(id, 1)
    expect(service.getSnapshot().get(id)).toMatchObject({ completionUnread: false, completionPendingAck: true })
    b.setMainView(id, 0)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(false)
    b.emitStatus(id, true)
    b.emitStatus(id, false)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(true)
    b.emitStatus(id, true)
    expect(service.getSnapshot().get(id)?.completionUnread).toBe(false)
    expect(service.getSnapshot().get(id)?.completionPendingAck).toBe(false)
  })

  it('retires local reminders for a Session that left the ready catalog', () => {
    const b = bench()
    const id = sessionId('evicted')
    const service = b.status()
    b.emitStatus(id, true)
    b.emitStatus(id, false)
    b.list.set({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
    expect(service.getSnapshot().has(id)).toBe(false)
  })

  it('restores both original storage keys, sweeps absent identities, and persists explicit acknowledgement', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    const unreadId = sessionId('stored-unread')
    const ackId = sessionId('stored-ack')
    const unreadKey = 'dsh.session-completion-unread.v1'
    const ackKey = 'dsh.session-completion-pending-ack.v1'
    const b = bench()
    b.row(unreadId)
    b.row(ackId)
    store.set(unreadKey, JSON.stringify([unreadId, 'session-elsewhere']))
    store.set(ackKey, JSON.stringify([ackId]))
    const service = b.status()
    expect(service.getSnapshot().get(unreadId)?.completionUnread).toBe(true)
    expect(service.getSnapshot().get(ackId)?.completionPendingAck).toBe(true)
    service.acknowledgeCompletion(unreadId)
    expect(JSON.parse(store.get(unreadKey) ?? 'null')).toEqual([])
    expect(JSON.parse(store.get(ackKey) ?? 'null')).toEqual([ackId])
    const reloaded = b.status()
    expect(reloaded.getSnapshot().get(unreadId)?.completionUnread).toBe(false)
    expect(reloaded.getSnapshot().get(ackId)?.completionPendingAck).toBe(true)
    reloaded.acknowledgeCompletion(ackId)
    expect(JSON.parse(store.get(ackKey) ?? 'null')).toEqual([])
  })

  it('reports reading readiness and forwards explicit marks', async () => {
    const b = bench()
    const service = b.status()
    const ready = vi.fn()
    const off = service.readingReady.subscribe(ready)
    expect(service.readingReady.getSnapshot()).toBe(true)
    b.reading.set({ ...b.reading.getSnapshot(), ready: false })
    expect(service.readingReady.getSnapshot()).toBe(false)
    expect(ready).toHaveBeenCalled()
    off()
    b.reading.set({ ...b.reading.getSnapshot(), ready: true })
    const mark = vi.spyOn(service.reading, 'mark')
    await service.mark(sessionId('s1'), true)
    expect(mark).toHaveBeenCalledExactlyOnceWith(sessionId('s1'), true)
    expect(b.remoteMark).toHaveBeenCalledExactlyOnceWith(sessionId('s1'), { type: 'unread' })
  })
})

describe('Session status pending interactions', () => {
  it('carries the exact effective request object and adds Sessions known only by their request', () => {
    const b = bench()
    const listed = sessionId('listed')
    const unlisted = sessionId('unlisted')
    b.row(listed)
    const service = b.status()
    const changed = vi.fn()
    service.subscribe(changed)
    const approval = { key: 'approval:1', kind: 'approval', sessionId: listed } as SessionPendingInteraction
    const question = { key: 'question:1', kind: 'question', sessionId: unlisted } as SessionPendingInteraction

    b.pending.set(new Map([[listed, approval], [unlisted, question]]))
    expect(service.getSnapshot().get(listed)).toEqual({
      running: false, pendingInteraction: approval, completionUnread: false, completionPendingAck: false, completionFailed: false,
    })
    expect(service.getSnapshot().get(listed)?.pendingInteraction).toBe(approval)
    expect(service.getSnapshot().get(unlisted)).toEqual({
      running: undefined, pendingInteraction: question, completionUnread: false, completionPendingAck: false, completionFailed: false,
    })
    expect(changed).toHaveBeenCalledOnce()

    b.pending.set(new Map([[listed, approval], [unlisted, question]]))
    expect(changed).toHaveBeenCalledOnce()
    b.pending.set(new Map())
    expect(service.getSnapshot().get(listed)?.pendingInteraction).toBeUndefined()
    expect(service.getSnapshot().has(unlisted)).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('contains a failing status subscriber and continues dispatch', () => {
    const b = bench()
    const service = b.status()
    const failure = new Error('status subscriber failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.subscribe(() => { throw failure })
    const after = vi.fn()
    service.subscribe(after)

    b.pending.set(new Map([[sessionId('s1'), pendingQuestion(sessionId('s1'))]]))

    expect(after).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith('[session-status] Session status subscriber failed:', failure)
  })

  it('stops following its sources when its plugin unloads', async () => {
    const b = bench()
    let service: UiSessionStatus | undefined
    const fiber = b.ctx.plugin({
      apply(scope: Context) {
        service = b.create(scope)
      },
    })
    await fiber.await()
    if (service === undefined) throw new Error('UiSessionStatus did not start')
    expect(b.subscribed()).toBe(true)
    const before = service.getSnapshot()

    await fiber.dispose()

    expect(b.subscribed()).toBe(false)
    b.row(sessionId('later'))
    b.pending.set(new Map([[sessionId('later'), pendingQuestion(sessionId('later'))]]))
    b.reading.set({ ready: true, items: { [sessionId('later')]: b.record(sessionId('later'), { completedTurn: 1 }) } })
    expect(service.getSnapshot()).toBe(before)
  })
})

describe('session-status apply', () => {
  it('provides the status service under ctx.uiSession and publishes it as the root useSessionStatus source', () => {
    const b = bench()
    const provideRoot = vi.fn()
    b.ctx.provide('slots', { provideRoot } as never)
    b.ctx.provide('uiSession', { pendingInteractions: b.pending } as never)
    b.ctx.provide('sessions', { list: b.list, binding: () => undefined } as never)
    b.ctx.provide('remoteAccess', { whenAccess: () => () => {} } as never)

    apply(b.ctx)

    expect(provideRoot).toHaveBeenCalledOnce()
    const root = provideRoot.mock.calls[0]![0] as { hooks: { sessionStatus: UiSessionStatus } }
    expect(Object.keys(root)).toEqual(['hooks'])
    expect(Object.keys(root.hooks)).toEqual(['sessionStatus'])
    const provided: unknown = b.ctx.get('uiSession.sessionStatus')
    if (!(provided instanceof UiSessionStatus)) throw new Error('uiSession.sessionStatus is not provided')
    expect(root.hooks.sessionStatus.getSnapshot()).toBe(provided.getSnapshot())
  })
})
