/**
 * Derives the workspace browser tree from caller-projected Workspace and
 * Session order. Unassigned Sessions trail under Ungrouped; only the selected
 * blank Session remains visible.
 */
import {
  type SessionListState, type SessionSearchResultItem, type SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  SessionStatusSnapshot,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/**
 * Resolve the Workspace browser group that owns one Session.
 * @param workspaces - authoritative Workspace membership.
 * @param sessionId - Session whose browser group is required.
 * @returns owning Workspace id, or {@link UNGROUPED_KEY} when no Workspace accounts for it.
 */
export function owningGroupKey(
  workspaces: readonly WorkspaceView[],
  sessionId: SessionId,
): string {
  return (workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
    ?.workspaceId as string | undefined) ?? UNGROUPED_KEY
}

/**
 * Resolve the hand-made group that owns one Session in custom grouping mode.
 * @param groups - hand-made groups with their saved membership.
 * @param sessionId - Session whose browser group is required.
 * @returns owning hand-made group id, or {@link UNGROUPED_KEY} when none names it.
 */
export function owningCustomGroupKey(
  groups: readonly CustomGroupMembership[],
  sessionId: SessionId,
): string {
  return groups.find(group => group.sessionIds.includes(sessionId))?.id ?? UNGROUPED_KEY
}

/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'
type SessionStatuses = SessionStatusSnapshot

function mainSessionId(list: SessionListState): SessionId | undefined {
  return Object.values(list.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

/** One session row in a group or the flat list; direct subagent children carry `depth`. */
export interface SessionNode {
  id: SessionId
  /** Stored title, or empty; the renderer localizes blank and unnamed row labels. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running direct children in the loaded subagent catalog. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The main view admitted the completion reminder: it clears only on an explicit acknowledgement. */
  awaitingAck?: boolean
  /** Latest user prompt as a projected preview; absent when the Session has none. */
  preview?: string
  /** In the registry-global pin set: leads its section, reorderable only among pinned rows. */
  pinned: boolean
  /** In the registry-global archive set: shown grayed in place and not openable. */
  archived: boolean
  updatedAt: number
  /** Session working directory; absent when the Host reports none or an empty path. */
  cwd?: string
  /** Nesting below the section member row: absent for a member, `1` for a direct subagent child. */
  depth?: number
  /** A direct subagent child rendered view-only: no rename, drag, move, pin, archive, or delete. */
  subagent?: boolean
  /** Direct parent of a nested subagent child. */
  parentId?: SessionId
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id, a hand-made group id, or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent for a hand-made group and for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  /** Backing hand-made group id; absent unless the section is one the user made. */
  customGroupId?: string
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent for a hand-made group and the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible ordinary Sessions; nested subagent children are not counted. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One hand-made group with the membership the browser holds for it. */
export interface CustomGroupMembership {
  id: string
  name: string
  /** Member ids in the user's order; ids the list no longer knows are ignored. */
  sessionIds: readonly SessionId[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running direct children in the loaded subagent catalog. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The main view admitted the completion reminder: it clears only on an explicit acknowledgement. */
  awaitingAck?: boolean
  /** In the registry-global archive set: shown grayed and not openable. */
  archived: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
  /**
   * Row order the sections follow: 'updated' ranks hand-made sections by their
   * newest Session, anything else keeps the caller's section order.
   */
  orderBy?: SessionOrderBy
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or an empty ungrouped marker.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * Project known account members by current Session recency.
 * @param sessionIds - authoritative account membership.
 * @param summaries - current Session summaries; members without a summary are omitted until it arrives.
 * @returns known members newest first, with Session identity as the deterministic tie-break.
 */
export function orderByRecency(
  sessionIds: readonly SessionId[],
  summaries: SessionListState['byId'],
): SessionId[] {
  return sessionIds.flatMap((id) => {
    const summary = summaries[id]
    if (summary === undefined) return []
    return [{ id, rank: summary.updatedAt }]
  })
    .sort((a, b) => {
      if (a.rank !== b.rank) return b.rank - a.rank
      return a.id < b.id ? -1 : 1
    })
    .map(member => member.id)
}

/**
 * Reconcile a browser-local manual order with current account membership.
 * Saved entries retain their relative order; new ordinary members follow them by recency.
 * @param memberIds - authoritative account membership.
 * @param savedOrder - previously saved browser-local order.
 * @param summaries - current Session metadata; unknown new members wait for their summaries.
 * @param rowState - global pin and archive membership; only account members can supplement the order.
 * @returns saved relative positions plus missing members ordered by pin, recency, and archive status.
 */
export function reconcileManualOrder(
  memberIds: readonly SessionId[],
  savedOrder: readonly string[] | undefined,
  summaries: SessionListState['byId'],
  rowState?: Pick<SessionRowState, 'pinnedSessionIds' | 'archivedSessionIds'>,
): SessionId[] {
  const members = new Map(memberIds.map(id => [id as string, id]))
  const included = new Set<string>()
  const ordered: SessionId[] = []
  for (const key of savedOrder ?? []) {
    const id = members.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  const archived = new Set(rowState?.archivedSessionIds)
  const pins: SessionId[] = []
  for (const sessionId of rowState?.pinnedSessionIds ?? []) {
    const id = members.get(sessionId)
    if (id === undefined || included.has(id) || archived.has(id) || summaries[id] === undefined) continue
    pins.push(id)
    included.add(id)
  }
  const ordinary: SessionId[] = []
  const archives: SessionId[] = []
  for (const id of orderByRecency([...members.values()].filter(id => !included.has(id)), summaries)) {
    if (archived.has(id)) archives.push(id)
    else ordinary.push(id)
  }
  return [...pins, ...ordered, ...ordinary, ...archives]
}

/**
 * Keep the selected provisional New Session ahead of either base order.
 * @param order - recency or reconciled manual order.
 * @param currentBlank - selected blank Session in this account, when present.
 * @returns a copy with the selected blank first and no duplicate slot.
 */
export function pinCurrentBlank(
  order: readonly SessionId[],
  currentBlank: SessionId | undefined,
): SessionId[] {
  if (currentBlank === undefined) return [...order]
  return [currentBlank, ...order.filter(id => id !== currentBlank)]
}

/**
 * Archived-row visibility choice: the default hides archived rows, `show`
 * mixes them into their kept slots, and `only` restricts the view (and
 * search) to archived rows.
 */
export type ArchivedFilter = 'default' | 'show' | 'only'

/**
 * Ordinary root sessions are visible; among blank sessions, only the current
 * one is visible. Subagent children are attached below a visible parent by
 * {@link subagentRows} instead of competing as root rows; archived sessions
 * follow the archived filter, while their accounting slots remain either way
 * so unarchiving restores position.
 */
function sessionVisible(
  session: SessionSummary,
  current: SessionId | undefined,
  archived: ReadonlySet<SessionId>,
  archivedFilter: ArchivedFilter,
): boolean {
  if (session.origin === 'subagent') return false
  if (session.blank && session.id !== current) return false
  switch (archivedFilter) {
    case 'default':
      return !archived.has(session.id)
    case 'show':
      return true
    case 'only':
      return archived.has(session.id)
    /* v8 ignore next 2 -- closed-union backstop; only reached if the filter is forged */
    default:
      return assertNever(archivedFilter)
  }
}

/** Registry-global row state consumed by every tree derivation. */
export interface SessionRowState {
  /** Registry-global pin ids; pinned rows lead their section in the local order. */
  pinnedSessionIds: readonly SessionId[]
  /** Archive set; members keep their slots and show grayed while visible. */
  archivedSessionIds: readonly SessionId[]
  /** Archived-row visibility choice applied to lists and search alike. */
  archivedFilter: ArchivedFilter
}

/**
 * Keep the visible New Session placeholder first, then partition pinned and
 * ordinary rows without changing either partition's caller order.
 */
function sectionMembers(
  members: readonly SessionSummary[],
  pinned: ReadonlySet<SessionId>,
  archived: ReadonlySet<SessionId>,
): SessionSummary[] {
  const placeholders: SessionSummary[] = []
  const leading: SessionSummary[] = []
  const rest: SessionSummary[] = []
  for (const member of members) {
    if (member.blank) placeholders.push(member)
    else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member)
    else rest.push(member)
  }
  return [...placeholders, ...leading, ...rest]
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label. Unnamed history also yields an
 * empty title for localization and does not match a directory-name title search.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? '' : (session.title?.trim() ?? '')
}

/**
 * Rank one hand-made section in the Last-updated order: its newest non-blank
 * member. The provisional blank row states no recency, and a section without
 * any ranked member leads so a freshly made group stays where its creation put it.
 */
function latestMemberTime(members: readonly SessionSummary[]): number {
  let latest: number | undefined
  for (const member of members) {
    if (member.blank) continue
    if (latest === undefined || member.updatedAt > latest) latest = member.updatedAt
  }
  return latest ?? Number.POSITIVE_INFINITY
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
): Group {
  return { key, workspaceId, cwd, createdAt, label, sessions: [...members] }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(
  members: readonly SessionSummary[],
  stored: readonly string[] | undefined,
  summaries: SessionListState['byId'],
): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const ids = stored === undefined
    ? orderByRecency(members.map(session => session.id), summaries)
    : reconcileManualOrder(members.map(session => session.id), stored, summaries)
  return ids.flatMap((id) => {
    const session = byId.get(id)
    /* v8 ignore next -- ids are projected exclusively from the members used to build byId. */
    return session === undefined ? [] : [session]
  })
}

/**
 * Group Sessions by Workspace: one group per caller-ordered entity, with
 * members resolved from caller-ordered sessionIds. Sessions outside every
 * Workspace trail in the browser-local Ungrouped order, which falls back to
 * recency before that order is initialized.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  archivedFilter: ArchivedFilter,
  ungroupedOrder: readonly string[] | undefined,
): Group[] {
  const current = mainSessionId(list)
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, current, archived, archivedFilter)) continue
      members.push(summary)
    }
    // The archived-only view lists archives, not the Workspace inventory, so
    // a Workspace without archived Sessions contributes no group.
    if (archivedFilter === 'only' && members.length === 0) continue
    groups.push(buildGroup(
      workspace.workspaceId, workspace.workspaceId, workspace.path,
      Date.parse(workspace.createdAt), workspace.title, members,
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, current, archived, archivedFilter))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      undefined,
      undefined,
      '',
      orderedUngrouped(stray, ungroupedOrder, list.byId),
    ))
  }
  return groups
}

/** Keep navigation presentation independent from domain-owned interaction objects. */
function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

/**
 * Latest projected user prompt of one Session, or undefined when none is
 * projected yet.
 *
 * The list snapshot already carries every registered projection for sessions
 * that were never opened, so a row reads them without a per-session refresh.
 */
function latestPrompt(list: SessionListState, sessionId: SessionId): string | undefined {
  const outline = list.projectionsBySession[sessionId]?.values.turnOutline
  if (outline === undefined) return undefined
  for (let index = outline.length - 1; index >= 0; index -= 1) {
    const prompt = outline[index]?.prompt.trim() ?? ''
    if (prompt !== '') return prompt
  }
  return undefined
}

function runningChildCount(list: SessionListState, parentId: SessionId, statuses: SessionStatuses): number {
  return list.projectionsBySession[parentId]?.values.subagentCatalog?.reduce(
    (count, child) => count + ((statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true ? 1 : 0),
    0,
  ) ?? 0
}

/**
 * Resolve the ordinary Session at the root of one subagent lineage.
 * @param list - sessions list snapshot.
 * @param sessionId - possibly nested Session.
 * @returns the nearest ancestor that is not a subagent, or the input when its
 * lineage is unknown or cyclic.
 */
export function rootSessionId(list: SessionListState, sessionId: SessionId): SessionId {
  let current = sessionId
  const visited = new Set<SessionId>()
  while (!visited.has(current)) {
    visited.add(current)
    const summary = list.byId[current]
    if (summary === undefined || summary.origin !== 'subagent' || summary.parentId === undefined) return current
    current = summary.parentId
  }
  return current
}

/** One direct subagent child with the identity its parent catalog recorded. */
interface SubagentRow {
  readonly summary: SessionSummary
  readonly parentId: SessionId
  /** Unique agent name among its siblings; absent for unnamed descriptors. */
  readonly name?: string
  /** Creation description recorded with the descriptor. */
  readonly label?: string
}

/**
 * Index every direct subagent child by its parent. Parent catalogs supply
 * membership and order; summaries that only carry `parentId` remain as a
 * fallback until the owning catalog arrives.
 * @param list - sessions list snapshot.
 * @returns direct children per parent, in catalog order then recency.
 */
function directChildren(list: SessionListState): Map<SessionId, readonly SubagentRow[]> {
  const buckets = new Map<SessionId, SubagentRow[]>()
  const placed = new Set<SessionId>()
  const ranks = new Map<SessionId, number>()
  const add = (row: SubagentRow): void => {
    if (placed.has(row.summary.id)) return
    placed.add(row.summary.id)
    const bucket = buckets.get(row.parentId) ?? []
    bucket.push(row)
    buckets.set(row.parentId, bucket)
  }
  const complete = new Set<SessionId>()
  for (const [parentId, snapshot] of Object.entries(list.projectionsBySession)) {
    const entries = snapshot.values.subagentCatalog
    // An available catalog owns membership, including an explicitly empty
    // one; a missing catalog falls back to summary lineage below.
    if (entries === undefined) continue
    complete.add(parentId as SessionId)
    for (const [index, entry] of entries.entries()) {
      if (entry.mode === 'external') continue
      const summary = list.byId[entry.id]
      if (summary === undefined || summary.origin !== 'subagent') continue
      // A duplicated descriptor keeps the first position; `add` still owns
      // the single-row guarantee.
      if (!placed.has(summary.id)) ranks.set(summary.id, index)
      add({
        summary,
        parentId: parentId as SessionId,
        ...('name' in entry ? { name: entry.name } : {}),
        ...(entry.label === undefined ? {} : { label: entry.label }),
      })
    }
  }
  for (const summary of Object.values(list.byId)) {
    if (summary.origin !== 'subagent' || summary.parentId === undefined || complete.has(summary.parentId)) continue
    add({ summary, parentId: summary.parentId })
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => {
      const leftRank = ranks.get(left.summary.id) ?? Number.MAX_SAFE_INTEGER
      const rightRank = ranks.get(right.summary.id) ?? Number.MAX_SAFE_INTEGER
      if (leftRank !== rightRank) return leftRank - rightRank
      if (left.summary.updatedAt !== right.summary.updatedAt) return left.summary.updatedAt - right.summary.updatedAt
      return left.summary.id.localeCompare(right.summary.id)
    })
  }
  return buckets
}

/**
 * Direct subagent rows nested below one visible parent.
 * @param children - direct-child index from {@link directChildren}.
 * @param parent - visible root row whose children are requested.
 * @param list - sessions list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archived - registry-global archive set.
 * @returns view-only child rows in catalog order, empty when the parent has none.
 */
function subagentRows(
  children: ReadonlyMap<SessionId, readonly SubagentRow[]>,
  parent: SessionSummary,
  list: SessionListState,
  statuses: SessionStatuses,
  archived: ReadonlySet<SessionId>,
): SessionNode[] {
  return (children.get(parent.id) ?? []).map(row => subagentNode(row, list, statuses, archived))
}

/**
 * Build one view-only child row without section membership or ordering.
 * @param row - child summary with its catalog identity.
 * @param list - sessions list snapshot.
 * @param statuses - unified UI status by Session.
 * @param archived - registry-global archive set.
 * @returns a nested row showing the agent name and its latest prompt; its own
 * activity is the only status it reports, so completion reminders stay with the
 * ordinary parent Session.
 */
function subagentNode(
  row: SubagentRow,
  list: SessionListState,
  statuses: SessionStatuses,
  archived: ReadonlySet<SessionId>,
): SessionNode {
  const status = statuses.get(row.summary.id)
  const preview = latestPrompt(list, row.summary.id)
  return {
    id: row.summary.id,
    // The catalog label is the semantic description the parent recorded
    // (for example "基础链路冒烟与路由取证"); the short agent name is only a
    // fallback for older descriptors without one.
    title: row.label || row.name || sessionTitle(row.summary),
    blank: false,
    running: status?.running ?? row.summary.running,
    runningSubagentCount: runningChildCount(list, row.summary.id, statuses),
    completed: false,
    pinned: false,
    archived: archived.has(row.summary.id),
    updatedAt: row.summary.updatedAt,
    ...(row.summary.cwd === undefined || row.summary.cwd === '' ? {} : { cwd: row.summary.cwd }),
    ...(preview === undefined ? {} : { preview }),
    depth: 1,
    subagent: true,
    parentId: row.parentId,
  }
}

function sessionNode(
  s: SessionSummary,
  list: SessionListState,
  statuses: SessionStatuses,
  pinned: ReadonlySet<SessionId>,
  archived: ReadonlySet<SessionId>,
): SessionNode {
  const status = statuses.get(s.id)
  const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind)
  const preview = latestPrompt(list, s.id)
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: status?.running ?? s.running,
    runningSubagentCount: runningChildCount(list, s.id, statuses),
    completed: status?.completionUnread === true,
    awaitingAck: status?.completionPendingAck === true,
    pinned: !archived.has(s.id) && pinned.has(s.id),
    archived: archived.has(s.id),
    updatedAt: s.updatedAt,
    ...(s.cwd === undefined || s.cwd === '' ? {} : { cwd: s.cwd }),
    ...(preview === undefined ? {} : { preview }),
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with ordinary Sessions as top-level rows
 * and each visible Session's direct subagent children nested view-only below it.
 *
 * Every group shows, except that the archived-only filter drops groups
 * without visible members; sessions populate under expanded groups with
 * pinned rows leading in the selected local order. Blank sessions are
 * excluded except for the selected provisional New Session row; archived
 * sessions keep their slots and appear per the archived filter. Content
 * search lives outside this derivation (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`mainView` retention feeds containsCurrent).
 * @param workspaces - real Workspaces in Host group order with caller-projected Session order.
 * @param rowState - registry-global pin and archive sets plus the archived filter.
 * @param statuses - unified UI status by Session.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  rowState: SessionRowState,
  statuses: SessionStatuses,
  view: TreeView,
): GroupNode[] {
  const archived = new Set(rowState.archivedSessionIds)
  const pinned = new Set(rowState.pinnedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const current = mainSessionId(list)
  // A selected subagent belongs to the ordinary Session above it for group
  // highlighting and expansion; the child row itself still carries selection.
  const currentGroup = current === undefined
    ? undefined
    : owningGroupKey(workspaces, rootSessionId(list, current))
  const children = directChildren(list)
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, rowState.archivedFilter, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? sectionMembers(g.sessions, pinned, archived).flatMap(session => [
          sessionNode(session, list, statuses, pinned, archived),
          ...subagentRows(children, session, list, statuses, archived),
        ])
        : [],
    })
  }
  return groups
}

/**
 * Derive the hand-made group sections: one section per group the user made,
 * then an ungrouped bucket holding every Session no group accounts for.
 *
 * Membership is the browser's own saved list, so a Session the groups do not
 * name falls to the bucket whether or not a Workspace knows it. Section order
 * is the caller's group order under Manual, and under Last-updated it is the
 * sections' newest ranked member with the ungrouped bucket ranked among them;
 * member order is the saved member order, with pinned rows leading. Everything
 * else matches {@link deriveGroups}.
 * @param list - sessions list snapshot.
 * @param groups - hand-made groups with their saved membership, in display order.
 * @param rowState - registry-global pin and archive sets plus the archived filter.
 * @param statuses - unified UI status by Session.
 * @param view - local expansion array and the bucket's saved order.
 * @returns group sections in render order.
 */
export function deriveCustomGroups(
  list: SessionListState,
  groups: readonly CustomGroupMembership[],
  rowState: SessionRowState,
  statuses: SessionStatuses,
  view: TreeView,
): GroupNode[] {
  const archived = new Set(rowState.archivedSessionIds)
  const pinned = new Set(rowState.pinnedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const current = mainSessionId(list)
  const currentGroup = current === undefined
    ? undefined
    : groups.find(group => group.sessionIds.includes(rootSessionId(list, current)))?.id ?? UNGROUPED_KEY
  const children = directChildren(list)
  const sections: { node: GroupNode; latest: number }[] = []
  // Membership is accounted for before visibility: a Session the archived
  // filter hides still belongs to its group rather than to the bucket.
  const accounted = new Set<SessionId>()
  const membersOf = (sessionIds: readonly SessionId[]): SessionSummary[] => {
    const members: SessionSummary[] = []
    for (const id of sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined || accounted.has(id)) continue
      accounted.add(id)
      if (sessionVisible(summary, current, archived, rowState.archivedFilter)) members.push(summary)
    }
    return members
  }
  const section = (
    key: string,
    customGroupId: string | undefined,
    label: string,
    members: readonly SessionSummary[],
  ): void => {
    const isExpanded = expandedGroups.has(key)
    sections.push({
      node: {
        key,
        workspaceId: undefined,
        ...(customGroupId === undefined ? {} : { customGroupId }),
        cwd: undefined,
        createdAt: undefined,
        label,
        sessionCount: members.length,
        expanded: isExpanded,
        containsCurrent: key === currentGroup,
        sessions: isExpanded
          ? sectionMembers(members, pinned, archived).flatMap(session => [
            sessionNode(session, list, statuses, pinned, archived),
            ...subagentRows(children, session, list, statuses, archived),
          ])
          : [],
      },
      latest: latestMemberTime(members),
    })
  }
  for (const group of groups) {
    const members = membersOf(group.sessionIds)
    // The archived-only view lists archives, not the group inventory, so a
    // group without archived Sessions contributes no section — the same rule
    // the Workspace grouping applies to a Workspace.
    if (rowState.archivedFilter === 'only' && members.length === 0) continue
    section(group.id, group.id, group.name, members)
  }
  const stray = membersOf(list.ids)
  if (stray.length > 0) {
    const ordered = view.ungroupedOrder === undefined
      ? orderByRecency(stray.map(summary => summary.id), list.byId)
      : reconcileManualOrder(stray.map(summary => summary.id), view.ungroupedOrder, list.byId, rowState)
    const byId = new Map(stray.map(summary => [summary.id, summary]))
    section(UNGROUPED_KEY, undefined, '', ordered.flatMap((id) => {
      const summary = byId.get(id)
      return summary === undefined ? [] : [summary]
    }))
  }
  // Last-updated ranks the sections themselves, the ungrouped bucket among
  // them; the saved hand-made order stays the tie-break because the sort is stable.
  return view.orderBy === 'updated'
    ? [...sections].sort((a, b) => b.latest - a.latest).map(entry => entry.node)
    : sections.map(entry => entry.node)
}

/**
 * Select complete flat-list membership, independently of archive visibility.
 * @param list - sessions list snapshot.
 * @returns known ordinary Session ids, including archives and only the current blank.
 */
export function sessionMemberIds(list: SessionListState): SessionId[] {
  return visibleSessionIds(list, [], 'show')
}

/**
 * Select visible flat-list members without deriving row presentation or ordering.
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @param archivedFilter - archived-row visibility choice.
 * @returns known visible Session ids in list order, including ordinary forks and only the current blank.
 */
export function visibleSessionIds(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  archivedFilter: ArchivedFilter,
): SessionId[] {
  const archived = new Set(archivedSessionIds)
  const current = mainSessionId(list)
  return list.ids.filter((id) => {
    const s = list.byId[id]
    return s !== undefined && sessionVisible(s, current, archived, archivedFilter)
  })
}

/**
 * Derive flat rows from the browser's complete ordered Session ids, with
 * pinned rows fronted ahead of the supplied order and direct subagent
 * children nested below their parent.
 * @param list - sessions list snapshot used to select the ids.
 * @param sessionIds - complete account members in the selected order, including hidden archives.
 * @param rowState - registry-global pin and archive sets plus the archived filter.
 * @param statuses - unified UI status by Session.
 * @returns flat rows in sectioned order with current status indicators.
 */
export function deriveFlat(
  list: SessionListState,
  sessionIds: readonly SessionId[],
  rowState: SessionRowState,
  statuses: SessionStatuses,
): SessionNode[] {
  const archived = new Set(rowState.archivedSessionIds)
  const pinned = new Set(rowState.pinnedSessionIds)
  const current = mainSessionId(list)
  const members = sessionIds.flatMap((id) => {
    const session = list.byId[id]
    return session !== undefined && sessionVisible(session, current, archived, rowState.archivedFilter)
      ? [session]
      : []
  })
  const children = directChildren(list)
  return sectionMembers(members, pinned, archived).flatMap(session => [
    sessionNode(session, list, statuses, pinned, archived),
    ...subagentRows(children, session, list, statuses, archived),
  ])
}

/**
 * Merge immediate title/Workspace/Session id substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members match per the archived filter).
 * @param archivedFilter - archived-row visibility choice; search follows it.
 * @param statuses - unified UI status by Session.
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  archivedFilter: ArchivedFilter,
  statuses: SessionStatuses,
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const current = mainSessionId(list)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, current, archived, archivedFilter)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
      || summary.id.toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  const localById = new Map(local.map(summary => [summary.id, summary]))
  const orderedLocal = orderByRecency(local.map(summary => summary.id), list.byId)
    .map(id => localById.get(id) as SessionSummary)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of orderedLocal) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, current, archived, archivedFilter)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      const status = statuses.get(summary.id)
      const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: status?.running ?? summary.running,
        runningSubagentCount: runningChildCount(list, summary.id, statuses),
        ...(pendingInteraction === undefined
          ? {}
          : { pendingInteraction }),
        completed: status?.completionUnread === true,
        awaitingAck: status?.completionPendingAck === true,
        archived: archived.has(summary.id),
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/** Normalize separators for comparison without interpreting POSIX backslashes as separators. */
function folderPath(path: string): string {
  const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
  return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
}

/**
 * Find the nearest registered ancestor, excluding the Workspace directory itself.
 * Paths use Host spelling; matching is case-sensitive, like Workspace identity.
 * @param path - Workspace directory.
 * @param parents - registered Workspace directory paths.
 * @returns the owning parent path, or undefined when no parent contains the Workspace.
 */
export function owningParentFolder(path: string, parents: readonly string[]): string | undefined {
  const child = folderPath(path)
  let owner: string | undefined
  let length = -1
  for (const parent of parents) {
    const root = folderPath(parent)
    if (root.length > length && child !== root && child.startsWith(`${root}/`)) {
      owner = parent
      length = root.length
    }
  }
  return owner
}
