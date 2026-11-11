/**
 * The agent-group domain declaration: the durable document every browser
 * pushes its hand-made sidebar groups into. The zod schema validates the whole
 * document at the durable boundary and is the source of the RPC wire type.
 * @module @deepseek-ai/dsh-agent-groups/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

/**
 * One directory name below a Workspace's `.tmp` root. It becomes one path
 * segment, so separators and the two relative-directory names are rejected at
 * the durable boundary.
 */
const agentGroupDirectoryName = z.string().min(1).refine(
  value => value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\'),
  { message: 'a shared directory name must be one path segment' },
)

/**
 * The HTTP(S) page the Host serves through its same-origin board route. Only
 * those two schemes are accepted so the Host fetch can never read a local
 * file or another protocol.
 */
const agentGroupBoardUrl = z.string().min(1).refine(
  (value) => {
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  },
  { message: 'a board URL must be an absolute http(s) URL' },
)

/** One hand-made group: its browser-local identity, name, and ordered members. */
export const agentGroupRecord = z.object({
  /** Browser-local identity, prefixed by the browser store so it never collides with a Workspace id. */
  id: z.string().min(1),
  /** User-visible group name. */
  name: z.string(),
  /** Member Session ids in the order the user arranged them. */
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  /**
   * Stable directory name below each owning Workspace's `.tmp` root, assigned
   * once by the Host on first use and kept across renames. Absent until the
   * Host materializes the shared directory for this group.
   */
  dirName: agentGroupDirectoryName.optional(),
  /**
   * Upstream page the Host proxies into this group's board column. Written by
   * the `set_group_board` tool; absent while the group has no board.
   */
  boardUrl: agentGroupBoardUrl.optional(),
}).strict()

/** One durable hand-made group, inferred from {@link agentGroupRecord}. */
export type AgentGroupRecord = z.infer<typeof agentGroupRecord>

/**
 * Durable registry state: the complete group document as the newest pushing
 * browser stated it. The document is replaced whole, so no per-group record
 * can outlive a deletion the browser already made.
 */
export const agentGroupsDomainState = z.object({
  groups: z.array(agentGroupRecord),
}).strict()

/** Durable registry state inferred from {@link agentGroupsDomainState}. */
export type AgentGroupsDomainState = z.infer<typeof agentGroupsDomainState>

/**
 * The agent-group domain spec: one global document and no tables. The registry
 * opens this through `ctx.storageDomain`; the spec object is the single source
 * of the domain's identity, version, and schema.
 */
export const agentGroupsDomainSpec = defineDomain({
  name: 'agent_groups',
  version: 1,
  global: { schema: agentGroupsDomainState, initial: { groups: [] } },
  tables: {},
})
