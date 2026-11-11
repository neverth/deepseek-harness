/**
 * Board resolution for the sidebar's hand-made groups. The sidebar nests a
 * Session's direct subagent children under its row without adding them to the
 * group's member list, so membership answers for the Session's topmost
 * ancestor: opening the root or any child shows the same group board.
 * @module @deepseek-ai/dsh-client-ui-agent-group-board/client/board
 */

import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One group board the rail can display. */
export interface BoardGroup {
  /** Hand-made group identity. */
  readonly id: string
  /** User-visible group name shown as the rail title. */
  readonly name: string
  /** Upstream page the Host proxies for this group. */
  readonly boardUrl: string
}

/**
 * Walk parent links to the Session whose sidebar row owns this one.
 * @param byId - Session summaries keyed by id.
 * @param sessionId - selected Session.
 * @returns the topmost ancestor, or `sessionId` when it has none.
 */
export function rootSessionId(byId: SessionListState['byId'], sessionId: SessionId): SessionId {
  const seen = new Set<SessionId>()
  let current = sessionId
  while (!seen.has(current)) {
    seen.add(current)
    const parent = byId[current]?.parentId
    if (parent === undefined) return current
    current = parent
  }
  // A parent cycle is corrupt data; the last visited id is still a stable answer.
  return current
}

/**
 * Resolve the board the selected Session shows.
 * @param groups - the Host's hand-made group document.
 * @param sessionId - selected Session, absent while no Session is open.
 * @param root - the selected Session's topmost ancestor.
 * @returns the first group carrying a board URL that names either id.
 */
export function boardGroupFor(
  groups: readonly AgentGroupView[],
  sessionId: SessionId | undefined,
  root: SessionId | undefined,
): BoardGroup | undefined {
  if (sessionId === undefined) return undefined
  const group = groups.find(candidate => candidate.boardUrl !== undefined
    && (candidate.sessionIds.includes(sessionId)
      || (root !== undefined && candidate.sessionIds.includes(root))))
  if (group?.boardUrl === undefined) return undefined
  return { id: group.id, name: group.name, boardUrl: group.boardUrl }
}

/**
 * Whether two Host group documents carry the same board-relevant content.
 * @param left - the document currently displayed.
 * @param right - the document just read.
 * @returns true when no rail-visible fact changed.
 */
export function sameGroupDocument(
  left: readonly AgentGroupView[],
  right: readonly AgentGroupView[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((group, index) => {
    const other = right[index]
    return other !== undefined
      && group.id === other.id
      && group.name === other.name
      && group.boardUrl === other.boardUrl
      && group.sessionIds.length === other.sessionIds.length
      && group.sessionIds.every((sessionId, position) => sessionId === other.sessionIds[position])
  })
}
