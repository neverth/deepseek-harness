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

/** One hand-made group: its browser-local identity, name, and ordered members. */
export const agentGroupRecord = z.object({
  /** Browser-local identity, prefixed by the browser store so it never collides with a Workspace id. */
  id: z.string().min(1),
  /** User-visible group name. */
  name: z.string(),
  /** Member Session ids in the order the user arranged them. */
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
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
