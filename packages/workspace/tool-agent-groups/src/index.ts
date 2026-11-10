/**
 * Model-facing whole-group read: reports the hand-made sidebar group the
 * calling Session belongs to and the Sessions grouped with it. Grouping is a
 * user-made browsing surface; this tool turns the Host's durable copy of that
 * mapping into model-visible facts.
 * @module @deepseek-ai/dsh-tool-agent-groups
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the ctx.agentGroups service declaration.
import type {} from '@deepseek-ai/dsh-agent-groups'
// Type-only: pulls the ctx.sessionQuery service declaration.
import type {} from '@deepseek-ai/dsh-session-query'

/** Cordis plugin name. */
export const name = 'tool-agent-groups'
/** Services required by the group-members tool. */
export const inject = ['tools', 'agentGroups', 'sessionQuery']

/** The group-members tool takes no configuration. */
export type Config = Record<never, never>

/** Loader schema for the group-members tool. */
export const Config: z<Config> = z.object({})

/** The calling Session's group, or null while it belongs to none. */
const GROUP_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
      },
    },
    { type: 'null' },
  ],
} as const

/** One peer Session as the model sees it. */
const MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    title: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
    },
    cwd: { type: 'string' },
    createdAt: { type: 'integer' },
    current: { type: 'boolean', required: true },
  },
} as const

const VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: { ...GROUP_SCHEMA, required: true },
    members: { type: 'array', required: true, items: MEMBER_SCHEMA },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON.
 * @param schema - canonical value schema for the tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/**
 * Register the `group_members` tool.
 * @param ctx - context carrying the tool registry plus group and Session query services.
 * @param _config - the empty plugin configuration.
 */
export function apply(ctx: Context, _config: Config = {}): void {
  ctx.tools.register(defineTool({
    name: 'group_members',
    description:
      'List the sessions in this session\'s custom sidebar group, with each session id, title, '
      + 'working directory, and creation time. Custom groups are user-made collections shown in the '
      + 'sidebar. Returns a null group when this session is not in one.',
    parameters: {},
    output: jsonOutput(VALUE_SCHEMA),
    async execute(_args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('group_members requires an owning agent session')
      const group = ctx.agentGroups.groupOf(session.id)
      if (group === undefined) return { group: null, members: [] }
      const observations = await ctx.sessionQuery.readTitleSnapshots(group.sessionIds, exec.signal)
      const byId = new Map(observations.map(observation => [observation.sessionId, observation]))
      const members = group.sessionIds.map((sessionId: SessionId) => {
        const observation = byId.get(sessionId)
        const value = observation?.status === 'fulfilled' ? observation.value : undefined
        return {
          sessionId,
          title: value?.title?.title ?? null,
          ...value?.session.cwd === undefined ? {} : { cwd: value.session.cwd },
          ...value === undefined ? {} : { createdAt: value.session.createdAt },
          current: sessionId === session.id,
        }
      })
      return { group: { id: group.id, name: group.name }, members }
    },
  }))
}

export default apply
