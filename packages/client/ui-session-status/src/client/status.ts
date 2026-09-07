/** Client Session status table: running state, the effective pending interaction, and shared reading reminders. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only service merge for ctx.slots.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// Retains ui-session's Context and Slot prop declarations for every consumer of this face.
export type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionReadModel } from './model.ts'

/** Independent UI status facts for one Session identity. */
export interface SessionStatus {
  /** Latest known running state; absent until a baseline or event establishes it. */
  readonly running: boolean | undefined
  /** Highest-precedence domain request currently awaiting user interaction. */
  readonly pendingInteraction: SessionPendingInteraction | undefined
  /** Observed completion awaiting a main-view open, or an explicit unread mark. */
  readonly completionUnread: boolean
  /** The main view opened a completion whose reminder still needs an explicit acknowledgement. */
  readonly completionPendingAck: boolean
  /** Latest unread completion ended with an execution error this Host observed. */
  readonly completionFailed: boolean
}

/** Current UI status indexed by Session identity. */
export type SessionStatusSnapshot = ReadonlyMap<SessionId, SessionStatus>
/** Selector hook over the unified Session UI status snapshot. */
export type UseSessionStatus = SnapshotSelectorHook<SessionStatusSnapshot>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    useSessionStatus: UseSessionStatus
  }
}

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface UiSessionService {
    /** Session status table; a plugin that reads it injects `uiSession.sessionStatus`. */
    readonly sessionStatus: UiSessionStatus
  }
}

/**
 * Session status table provided as the `uiSession.sessionStatus` service and read as `ctx.uiSession.sessionStatus`.
 * Completion reminders persist in this browser; explicit reading marks are shared by Clients of one Host. The
 * [package reference](../../README.md#use-this-package) states when each field is set and cleared.
 */
export class UiSessionStatus extends Service implements HostObservable<SessionStatusSnapshot> {
  private readonly running = new Map<SessionId, boolean>()
  private readonly completionUnread = new Set<SessionId>(loadReminderIds(UNREAD_KEY))
  private readonly completionPendingAck = new Set<SessionId>(loadReminderIds(PENDING_ACK_KEY))
  private statusSnapshot: SessionStatusSnapshot = new Map()
  private readonly statusListeners = new Set<() => void>()
  /**
   * Package-internal Client copy of the Host reading records, which the reading installer follows into.
   * @internal
   */
  readonly reading: SessionReadModel
  /** Whether reading marks can be sent: the current Host reading baseline has arrived. */
  readonly readingReady: HostObservable<boolean>

  /**
   * @param ctx - Client root context; its generated `sessionStatus` Remote namespace sends reading marks.
   * @param sessions - Controller-owned Session catalog and bindings.
   * @param pendingInteractions - effective pending request by Session, published by ui-session.
   */
  constructor(
    ctx: Context,
    private readonly sessions: Pick<ISessions, 'list' | 'binding'>,
    private readonly pendingInteractions: HostObservable<ReadonlyMap<SessionId, SessionPendingInteraction>>,
  ) {
    super(ctx, 'uiSession.sessionStatus')
    const reading = new SessionReadModel(ctx.remote.sessionStatus)
    this.reading = reading
    this.readingReady = {
      getSnapshot: () => reading.state.getSnapshot().ready,
      subscribe: listener => reading.state.subscribe(listener),
    }
    ctx.effect(() => {
      const disposeStatus = sessions.list.subscribe(() => { this.reconcileStatus() })
      const disposeRemoteStatus = ctx.remote.$on('api-session/status', (sessionId, running) => {
        this.observeRunning(sessionId, running)
      })
      const disposePending = pendingInteractions.subscribe(() => { this.publishStatus() })
      const disposeReading = reading.state.subscribe(() => { this.publishStatus() })
      this.reconcileStatus()
      return () => {
        disposeStatus()
        disposeRemoteStatus()
        disposePending()
        disposeReading()
      }
    }, 'session-status: Session status table')
  }

  /**
   * Read the current status table; the reference changes only when a status fact changes.
   * @returns status by Session identity.
   */
  readonly getSnapshot: () => SessionStatusSnapshot = () => this.statusSnapshot

  /**
   * Observe status table changes; a throwing listener is reported without stopping later listeners.
   * @param listener - called after each published change.
   * @returns unsubscribe.
   */
  readonly subscribe: (listener: () => void) => () => void = (listener) => {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /**
   * Mark one Session read or unread through the latest completion known to this Client.
   * @param sessionId - known Session identity.
   * @param unread - requested reminder state.
   * @throws when reading is not synchronized or the Host or carrier rejects; reconnect to refresh an unknown outcome.
   */
  async mark(sessionId: SessionId, unread: boolean): Promise<void> {
    await this.reading.mark(sessionId, unread)
    if (unread) {
      this.completionUnread.add(sessionId)
      this.completionPendingAck.delete(sessionId)
      this.persistReminders()
      this.publishStatus()
    } else {
      this.clearCompletion(sessionId)
    }
  }

  /**
   * Clear a completion reminder after the user explicitly confirms it.
   * @param sessionId - Session identity whose reminder the user dismissed.
   */
  acknowledgeCompletion(sessionId: SessionId): void {
    if (this.reading.state.getSnapshot().items[sessionId]?.manualUnread) {
      void this.mark(sessionId, false).catch((error: unknown) => {
        console.error('[session-status] Reading acknowledgement could not be confirmed. Retry the mark:', error)
      })
      return
    }
    this.clearCompletion(sessionId)
  }

  private clearCompletion(sessionId: SessionId): void {
    const unread = this.completionUnread.delete(sessionId)
    const pending = this.completionPendingAck.delete(sessionId)
    if (!unread && !pending) return
    this.persistReminders()
    this.publishStatus()
  }

  private persistReminders(): void {
    saveReminderIds(UNREAD_KEY, this.completionUnread)
    saveReminderIds(PENDING_ACK_KEY, this.completionPendingAck)
  }

  private observeRunning(sessionId: SessionId, running: boolean): void {
    const previous = this.running.get(sessionId)
    const beforeBaseline = this.sessions.list.getSnapshot().phase === 'pending'
    this.running.set(sessionId, running)
    if (running) {
      this.completionUnread.delete(sessionId)
      this.completionPendingAck.delete(sessionId)
    } else if (previous === true || (previous === undefined && beforeBaseline)) {
      this.completionUnread.add(sessionId)
    }
    this.persistReminders()
    this.publishStatus()
  }

  private reconcileStatus(): void {
    const list = this.sessions.list.getSnapshot()
    const present = new Set(Object.keys(list.byId) as SessionId[])
    // Subagent catalog rows and retained subagent fallback rows do not establish Host running state.
    for (const id of list.ids) {
      const row = list.byId[id] as SessionSummary
      const previous = this.running.get(id)
      if (previous === undefined) this.running.set(id, row.running)
      else if (previous !== row.running) this.observeRunning(id, row.running)
    }
    for (const id of present) {
      if ((list.byId[id]?.retainedBy.mainView ?? 0) > 0 && this.completionUnread.delete(id)) {
        this.completionPendingAck.add(id)
      }
    }
    if (list.phase === 'ready') {
      const tracked = new Set<SessionId>([
        ...this.running.keys(), ...this.completionUnread, ...this.completionPendingAck,
      ])
      for (const id of tracked) {
        if (present.has(id)) continue
        this.running.delete(id)
        this.completionUnread.delete(id)
        this.completionPendingAck.delete(id)
      }
    }
    this.persistReminders()
    this.publishStatus()
  }

  private publishStatus(): void {
    const pending = this.pendingInteractions.getSnapshot()
    const reading = this.reading.state.getSnapshot().items
    const list = this.sessions.list.getSnapshot()
    const ids = new Set<SessionId>([
      ...(Object.keys(list.byId) as SessionId[]),
      ...this.running.keys(),
      ...pending.keys(),
      ...this.completionUnread,
      ...this.completionPendingAck,
      ...(Object.keys(reading) as SessionId[]),
    ])
    const next = new Map<SessionId, SessionStatus>()
    for (const id of ids) {
      const record = reading[id]
      const unread = this.completionUnread.has(id) || record?.manualUnread === true
      next.set(id, {
        running: this.running.get(id),
        pendingInteraction: pending.get(id),
        completionUnread: unread,
        completionPendingAck: this.completionPendingAck.has(id),
        completionFailed: unread && record?.failed === true,
      })
    }
    if (sameSessionStatus(this.statusSnapshot, next)) return
    this.statusSnapshot = next
    notifySubscribers(this.statusListeners, '[session-status] Session status')
  }
}

const UNREAD_KEY = 'dsh.session-completion-unread.v1'
const PENDING_ACK_KEY = 'dsh.session-completion-pending-ack.v1'

/**
 * Read stored completion reminders; unavailable or damaged storage has no reminders.
 * @param key - browser storage key holding a Session identity array.
 * @returns stored Session identities.
 */
function loadReminderIds(key: string): readonly SessionId[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value !== '').map(SessionId)
  } catch (_storageFailed) {
    // A blocked or corrupt store must not prevent the Session list from loading.
    return []
  }
}

/**
 * Mirror a reminder set without making browser storage a prerequisite for the UI.
 * @param key - browser storage key holding a Session identity array.
 * @param ids - Session identities to store.
 */
function saveReminderIds(key: string, ids: Iterable<SessionId>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch (_storageFailed) {
    // A private or full store leaves the current in-memory reminders usable.
  }
}

function sameSessionStatus(left: SessionStatusSnapshot, right: SessionStatusSnapshot): boolean {
  if (left.size !== right.size) return false
  for (const [id, status] of left) {
    const candidate = right.get(id)
    if (candidate === undefined
      || candidate.running !== status.running
      || candidate.pendingInteraction !== status.pendingInteraction
      || candidate.completionUnread !== status.completionUnread
      || candidate.completionPendingAck !== status.completionPendingAck
      || candidate.completionFailed !== status.completionFailed) return false
  }
  return true
}
