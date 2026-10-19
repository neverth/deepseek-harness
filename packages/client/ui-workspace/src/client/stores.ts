/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { reconcileManualOrder, type ArchivedFilter, type SessionRowState } from './tree.ts'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: sibling Workspace sections, a Workspace tree, one flat list, or hand-made groups. */
export type SessionGroupBy = 'workspace' | 'workspace-tree' | 'flat' | 'custom'
/** Session order: saved manual positions or current recency. */
export type SessionOrderBy = 'manual' | 'updated'

/** One hand-made group: a name the user chose and a membership they set by hand. */
export interface CustomGroup {
  /** Browser-local identity, also the expansion key; prefixed so it never collides with a Workspace id. */
  id: string
  name: string
}

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit group expansion keyed by Workspace identity, including descendants in tree mode. */
  groupExpansion: Record<string, boolean>
  /** Saved manual order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Hand-made groups in display order; empty in every mode that does not use them. */
  customGroups: CustomGroup[]
  /**
   * Membership and manual order per hand-made group id. This is the one
   * authority for custom membership: a Session absent from every list here
   * belongs to the custom mode's ungrouped bucket.
   */
  customMembers: Record<string, string[]>
  /** Suffix source for new hand-made group ids. */
  customGroupSeq: number
  /** Archived-row visibility; omitted in pre-filter v5 snapshots and read as 'default'. */
  archivedFilter?: ArchivedFilter
}

/** Prefix that keeps a hand-made group id out of the Workspace id namespace. */
const CUSTOM_GROUP_PREFIX = 'custom:'

type SessionOrderSource = {
  members: Readonly<Record<string, readonly SessionId[]>>
  summaries: SessionListState['byId']
  rowState: Pick<SessionRowState, 'pinnedSessionIds' | 'archivedSessionIds'>
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (
    draft: WorkspaceViewState,
    mode: SessionOrderBy,
    initialOrders: Readonly<Record<string, readonly string[]>>,
  ) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrders: (
    draft: WorkspaceViewState,
    orders: Readonly<Record<string, readonly string[]>>,
  ) => void
  /**
   * Record the member order currently rendered for each hand-made group, so a
   * drag that selects Manual keeps the rows where the user was looking at them.
   */
  syncCustomMemberOrders: (
    draft: WorkspaceViewState,
    orders: Readonly<Record<string, readonly string[]>>,
  ) => void
  setSessionOrder: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: readonly string[],
    initialOrders: Readonly<Record<string, readonly string[]>>,
  ) => void
  pinSessionOrder: (
    draft: WorkspaceViewState,
    sessionId: string,
    accountKeys: readonly string[],
    source: SessionOrderSource,
  ) => void
  setArchivedFilter: (draft: WorkspaceViewState, filter: ArchivedFilter) => void
  createCustomGroup: (draft: WorkspaceViewState, name: string) => void
  renameCustomGroup: (draft: WorkspaceViewState, groupId: string, name: string) => void
  /** Drop one group and return its members to the custom mode's ungrouped bucket. */
  deleteCustomGroup: (draft: WorkspaceViewState, groupId: string) => void
  /** Move one group to the position before `beforeGroupId`, or to the end when it is absent. */
  moveCustomGroup: (draft: WorkspaceViewState, groupId: string, beforeGroupId?: string) => void
  /**
   * Place one Session in a hand-made group, or remove it from every group when
   * `groupId` is absent, and give it the position before `beforeId`.
   */
  moveCustomMember: (
    draft: WorkspaceViewState,
    sessionId: string,
    groupId: string | undefined,
    beforeId?: string,
  ) => void
}

/** Every hand-made group id a state currently holds members for. */
function customGroupIds(draft: WorkspaceViewState): string[] {
  return draft.customGroups.map(group => group.id)
}

/** Copy read-only projections into the persisted mutable store representation. */
function copySessionOrders(
  orders: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(orders).map(([key, order]) => [key, [...order]]))
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      customGroups: [],
      customMembers: {},
      customGroupSeq: 0,
      archivedFilter: 'default',
    }),
    persist: 'dsh.workspace.view.v6',
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy, initialOrders) => {
        if (mode === d.orderBy) return
        d.sessionOrderByAccount = mode === 'manual' ? copySessionOrders(initialOrders) : {}
        d.orderBy = mode
      },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set([...workspaceKeys, ...customGroupIds(d)])
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.customMembers = Object.fromEntries(
          Object.entries(d.customMembers).filter(([key]) => retained.has(key)),
        )
        delete (d as WorkspaceViewState & { sessionUpdatedAtByAccount?: unknown }).sessionUpdatedAtByAccount
      },
      syncSessionOrders: (d, orders) => {
        if (d.orderBy !== 'manual') return
        Object.assign(d.sessionOrderByAccount, copySessionOrders(orders))
      },
      syncCustomMemberOrders: (d, orders) => {
        for (const [groupId, order] of Object.entries(orders)) {
          const members = d.customMembers[groupId]
          if (members === undefined) continue
          const ranked = new Set(order)
          // Members the rendering does not know keep their relative order behind
          // the ranked ones rather than leaving the stored membership.
          d.customMembers[groupId] = [...order, ...members.filter(id => !ranked.has(id))]
        }
      },
      setSessionOrder: (d, accountKey, order, initialOrders) => {
        if (d.orderBy === 'updated') d.sessionOrderByAccount = copySessionOrders(initialOrders)
        else Object.assign(d.sessionOrderByAccount, copySessionOrders(initialOrders))
        d.orderBy = 'manual'
        d.sessionOrderByAccount[accountKey] = [...order]
      },
      pinSessionOrder: (d, sessionId, accountKeys, source) => {
        const selected = new Set(accountKeys)
        d.sessionOrderByAccount = Object.fromEntries(Object.entries(source.members).map(([key, members]) => {
          const order = reconcileManualOrder(members, d.sessionOrderByAccount[key], source.summaries, source.rowState)
          return [key, selected.has(key) ? [sessionId, ...order.filter(id => id !== sessionId)] : order]
        }))
      },
      setArchivedFilter: (d, filter: ArchivedFilter) => { d.archivedFilter = filter },
      createCustomGroup: (d, name) => {
        const id = `${CUSTOM_GROUP_PREFIX}${d.customGroupSeq + 1}`
        d.customGroupSeq += 1
        d.customGroups.push({ id, name })
        d.customMembers[id] = []
        // A fresh group opens: landing on a folded empty header would read as
        // a creation that did nothing.
        d.groupExpansion[id] = true
      },
      renameCustomGroup: (d, groupId, name) => {
        const group = d.customGroups.find(candidate => candidate.id === groupId)
        if (group !== undefined) group.name = name
      },
      deleteCustomGroup: (d, groupId) => {
        d.customGroups = d.customGroups.filter(group => group.id !== groupId)
        d.customMembers = Object.fromEntries(
          Object.entries(d.customMembers).filter(([key]) => key !== groupId),
        )
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => key !== groupId),
        )
      },
      moveCustomGroup: (d, groupId, beforeGroupId) => {
        // Anchoring a group to itself states no position; the end is neither
        // what the caller asked for nor what the user dropped on.
        if (groupId === beforeGroupId) return
        const from = d.customGroups.findIndex(group => group.id === groupId)
        if (from === -1) return
        const [moved] = d.customGroups.splice(from, 1)
        /* v8 ignore next -- the index came from findIndex over this same array. */
        if (moved === undefined) return
        const at = beforeGroupId === undefined
          ? -1
          : d.customGroups.findIndex(group => group.id === beforeGroupId)
        d.customGroups.splice(at === -1 ? d.customGroups.length : at, 0, moved)
      },
      moveCustomMember: (d, sessionId, groupId, beforeId) => {
        const next: Record<string, string[]> = {}
        for (const [key, members] of Object.entries(d.customMembers)) {
          next[key] = members.filter(id => id !== sessionId)
        }
        d.customMembers = next
        if (groupId === undefined) return
        const members = d.customMembers[groupId] ?? (d.customMembers[groupId] = [])
        const at = beforeId === undefined ? -1 : members.indexOf(beforeId)
        members.splice(at === -1 ? members.length : at, 0, sessionId)
      },
    },
  })
}

/** One live view-store instance (what the browser renders and the Host snapshot mirror reads). */
export type WorkspaceViewInstance = ReturnType<ReturnType<typeof createWorkspaceViewStore>['create']>

/** The bound write set of one viewing-store instance (what the UiWorkspace service drives). */
export type WorkspaceViewStoreActions = ReturnType<ReturnType<typeof createWorkspaceViewStore>['create']>['actions']
