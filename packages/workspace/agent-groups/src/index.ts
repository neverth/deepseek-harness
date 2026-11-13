/**
 * Hand-made session-group registry (`ctx.agentGroups`): the Host-side fact of
 * which sessions share a sidebar group. The browser owns the grouping surface
 * and pushes its complete group document; tools read the durable mapping to
 * learn which sessions a caller can coordinate with.
 * @module @deepseek-ai/dsh-agent-groups
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { agentGroupRecord, agentGroupsDomainSpec, agentGroupsDomainState } from './spec.ts'
import type { AgentGroupRecord, AgentGroupsDomainState } from './spec.ts'

export { agentGroupRecord, agentGroupsDomainSpec, agentGroupsDomainState } from './spec.ts'
export type { AgentGroupRecord, AgentGroupsDomainState } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable hand-made session-group membership. */
    agentGroups: AgentGroupRegistry
  }
}

/** One group document entry accepted by {@link AgentGroupRegistry.replace}. */
export interface AgentGroupInput {
  /** Browser-local identity; prefixed so it never collides with a Workspace id. */
  readonly id: string
  /** User-visible group name. */
  readonly name: string
  /** Member Session ids in the user's arranged order. */
  readonly sessionIds: readonly SessionId[]
}

/** Whether two complete group documents are the same document. */
function sameGroups(left: readonly AgentGroupRecord[], right: readonly AgentGroupRecord[]): boolean {
  if (left.length !== right.length) return false
  return left.every((group, index) => {
    const other = right[index]
    return other !== undefined
      && group.id === other.id
      && group.name === other.name
      && group.dirName === other.dirName
      && group.boardUrl === other.boardUrl
      && group.sessionIds.length === other.sessionIds.length
      && group.sessionIds.every((sessionId, position) => sessionId === other.sessionIds[position])
  })
}

/**
 * Reject a document that repeats a group id or places one Session in two groups.
 * @param groups - parsed groups about to be stored.
 * @throws Error naming the duplicated group id or Session.
 */
function assertUniqueGroups(groups: readonly AgentGroupRecord[]): void {
  const groupIds = new Set<string>()
  const sessionOwners = new Map<string, string>()
  for (const group of groups) {
    if (groupIds.has(group.id)) throw new Error(`agent groups: duplicate group id '${group.id}'`)
    groupIds.add(group.id)
    for (const sessionId of group.sessionIds) {
      const owner = sessionOwners.get(sessionId)
      if (owner !== undefined) {
        throw new Error(`agent groups: session '${sessionId}' appears in groups '${owner}' and '${group.id}'`)
      }
      sessionOwners.set(sessionId, group.id)
    }
  }
}

/**
 * Allocate the next browser-compatible group id from the stored document.
 * @param groups - current stored groups.
 * @returns the lowest unused `custom:<n>` id after the highest one in use.
 */
function nextCustomGroupId(groups: readonly AgentGroupRecord[]): string {
  let highest = 0
  for (const group of groups) {
    const match = /^custom:(\d+)$/u.exec(group.id)
    if (match !== null) highest = Math.max(highest, Number(match[1]))
  }
  return `custom:${String(highest + 1)}`
}

/**
 * Durable registry of hand-made sidebar groups. The newest browser push
 * replaces the complete document; each session belongs to at most one group,
 * so a lookup answers the one group a calling session shares with its peers.
 * The registry never creates, renames, or deletes Sessions — it only records
 * the names and membership the browser UI already shows.
 */
export class AgentGroupRegistry extends Service {
  static inject = ['storageDomain']

  private global?: DomainGlobal<AgentGroupsDomainState>
  private mutations: Promise<unknown> = Promise.resolve()

  /** @param ctx - Host context carrying the storage facility. */
  constructor(ctx: Context) {
    super(ctx, 'agentGroups')
  }

  /** Open the durable document and fail at load when it is malformed. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(agentGroupsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'agent-groups.domainClose')
    this.global = domain.global
  }

  /**
   * The complete group document in display order.
   * @returns the stored groups; callers must not mutate the returned records.
   */
  list(): readonly AgentGroupRecord[] {
    return this.requireGlobal().get().groups
  }

  /**
   * Find the group one Session belongs to.
   * @param sessionId - Session identity to look up.
   * @returns the owning group, or `undefined` when the Session is ungrouped.
   */
  groupOf(sessionId: SessionId): AgentGroupRecord | undefined {
    return this.requireGlobal().get().groups.find(group => group.sessionIds.includes(sessionId))
  }

  /**
   * Find the stored group carrying one exact user-visible name.
   * @param name - group name to match.
   * @returns the first group with that name, or `undefined`.
   */
  findByName(name: string): AgentGroupRecord | undefined {
    return this.requireGlobal().get().groups.find(group => group.name === name)
  }

  /**
   * Return the stored group with that name, creating an empty one when absent.
   * The id is the lowest unused `custom:<n>` after the highest id in use, so a
   * link built from it opens in the browser's hand-made group surface.
   * @param name - user-visible group name; the caller validates it.
   * @returns the existing or created group.
   */
  ensure(name: string): Promise<AgentGroupRecord> {
    return this.serialize(async () => {
      const global = this.requireGlobal()
      const groups = global.get().groups
      const existing = groups.find(group => group.name === name)
      if (existing !== undefined) return existing
      const created = agentGroupRecord.parse({ id: nextCustomGroupId(groups), name, sessionIds: [] })
      const parsed = agentGroupsDomainState.parse({ groups: [...groups, created] }).groups
      assertUniqueGroups(parsed)
      await global.set({ groups: parsed })
      return created
    })
  }

  /**
   * Append one Session to a group's membership. Repeating the same membership
   * writes nothing.
   * @param groupId - group receiving the Session.
   * @param sessionId - Session to append after the current members.
   * @returns the stored group after the membership is durable.
   * @throws when no stored group carries that id, or the Session already belongs to another group.
   */
  addSession(groupId: string, sessionId: SessionId): Promise<AgentGroupRecord> {
    return this.serialize(async () => {
      const global = this.requireGlobal()
      const groups = global.get().groups
      const target = groups.find(group => group.id === groupId)
      if (target === undefined) throw new Error(`agent groups: unknown group id '${groupId}'`)
      if (target.sessionIds.includes(sessionId)) return target
      const stored: AgentGroupRecord = { ...target, sessionIds: [...target.sessionIds, sessionId] }
      const parsed = agentGroupsDomainState.parse({
        groups: groups.map(group => group.id === groupId ? stored : group),
      }).groups
      assertUniqueGroups(parsed)
      await global.set({ groups: parsed })
      return stored
    })
  }

  /**
   * Replace the complete group document from one browser push. A document
   * naming a duplicate group id or placing one Session in two groups is
   * rejected before any write. An unchanged document resolves without writing.
   * @param groups - the browser's complete group document, validated at this durable boundary.
   * @returns the stored groups: the accepted document plus the Host-assigned directory names and board URLs.
   */
  replace(groups: readonly AgentGroupInput[]): Promise<readonly AgentGroupRecord[]> {
    return this.serialize(async () => {
      const parsed = agentGroupsDomainState.parse({ groups }).groups
      assertUniqueGroups(parsed)
      const global = this.requireGlobal()
      // Browsers push only the editable fields, so a Host-assigned directory
      // name and a tool-written board URL survive every later push of the same
      // group.
      const stored = new Map(global.get().groups.map(group => [group.id, group]))
      const merged = parsed.map((group) => {
        const existing = stored.get(group.id)
        if (existing === undefined) return group
        return {
          ...group,
          ...existing.dirName === undefined ? {} : { dirName: existing.dirName },
          ...existing.boardUrl === undefined ? {} : { boardUrl: existing.boardUrl },
        }
      })
      if (sameGroups(global.get().groups, merged)) return global.get().groups
      await global.set({ groups: merged })
      return global.get().groups
    })
  }

  /**
   * Record the stable `.tmp` directory name the shared-directory service
   * assigned to one group. The name is kept across later browser pushes and
   * group renames; only the first assignment writes it.
   * @param groupId - Group receiving the directory name.
   * @param dirName - One path segment, generated by the calling service.
   * @returns the stored group after the name is durable.
   * @throws when no stored group carries that id.
   */
  setDirectoryName(groupId: string, dirName: string): Promise<AgentGroupRecord> {
    return this.serialize(async () => {
      const global = this.requireGlobal()
      const groups = global.get().groups
      const index = groups.findIndex(group => group.id === groupId)
      const group = groups[index]
      if (group === undefined) throw new Error(`agent groups: unknown group id '${groupId}'`)
      if (group.dirName !== undefined) return group
      await global.set({ groups: groups.map((entry, position) => position === index ? { ...entry, dirName } : entry) })
      return { ...group, dirName }
    })
  }

  /**
   * Record the upstream board page the Host proxies into one group's board
   * column. The URL is kept across later browser pushes, like the directory
   * name, and a repeated value writes nothing.
   * @param groupId - Group receiving the board.
   * @param boardUrl - absolute http(s) page URL.
   * @returns the stored group after the URL is durable.
   * @throws when no stored group carries that id, or the URL is not absolute http(s).
   */
  setBoardUrl(groupId: string, boardUrl: string): Promise<AgentGroupRecord> {
    return this.serialize(async () => {
      const global = this.requireGlobal()
      const groups = global.get().groups
      const index = groups.findIndex(group => group.id === groupId)
      const group = groups[index]
      if (group === undefined) throw new Error(`agent groups: unknown group id '${groupId}'`)
      const next = agentGroupRecord.parse({
        id: group.id,
        name: group.name,
        sessionIds: group.sessionIds,
        ...group.dirName === undefined ? {} : { dirName: group.dirName },
        boardUrl,
      })
      if (group.boardUrl === next.boardUrl) return group
      await global.set({ groups: groups.map((entry, position) => position === index ? next : entry) })
      return next
    })
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(action)
    this.mutations = result.then(() => {}, () => {})
    return result
  }

  private requireGlobal(): DomainGlobal<AgentGroupsDomainState> {
    if (this.global === undefined) throw new Error('agent group registry is not initialized')
    return this.global
  }
}

export default AgentGroupRegistry
