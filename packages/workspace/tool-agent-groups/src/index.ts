/**
 * Model-facing group awareness: one runtime-context line states the hand-made
 * sidebar group the calling Session belongs to, the `group_members` tool reads
 * the Host's durable mapping for the Sessions grouped with it, and
 * `set_group_board` attaches the HTML board the group's conversation column
 * shows. Grouping is a user-made browsing surface; these are its only
 * model-visible facts.
 * @module @deepseek-ai/dsh-tool-agent-groups
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
// Type-only: pulls AssembleContext.agent from the Agent runtime declaration.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: pulls the ctx.agentGroups service declaration.
import type {} from '@deepseek-ai/dsh-agent-groups'
// Type-only: pulls the ctx.sessionQuery service declaration.
import type {} from '@deepseek-ai/dsh-session-query'
// Type-only: pulls the ctx.systemPrompt service declaration.
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'tool-agent-groups'
/** Services required by the group context and the group-members tool. */
export const inject = ['tools', 'agentGroups', 'sessionQuery', 'systemPrompt']

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

const BOARD_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: { ...GROUP_SCHEMA, required: true },
    boardUrl: { type: 'string', required: true },
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
 * Register the runtime-context line and the `group_members` tool.
 * @param ctx - context carrying prompt, tool, group, and Session query services.
 * @param _config - the empty plugin configuration.
 */
export function apply(ctx: Context, _config: Config = {}): void {
  // The line is rewritten at every assembly, so a grouping change reaches the
  // next turn without another tool call; peers and their titles stay behind
  // group_members because the text provider is synchronous.
  ctx.systemPrompt.context({
    name: 'agent-groups:current',
    order: ctx.systemPrompt.getContextOrder('AGENT_GROUPS'),
    interpolate: false,
    text: (context) => {
      const session = context.agent?.session
      if (session === undefined) return ''
      const group = ctx.agentGroups.groupOf(session.id)
      if (group === undefined) return ''
      const peers = group.sessionIds.filter(sessionId => sessionId !== session.id).length
      const membership = peers === 0
        ? 'No other sessions are in it.'
        : `It has ${String(peers)} other session${peers === 1 ? '' : 's'}; call group_members to list them with their titles, working directories, and creation times.`
      return `This session belongs to the custom sidebar group ${JSON.stringify(group.name)}. ${membership}`
    },
  })
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
  ctx.tools.register(defineTool({
    name: 'set_group_board',
    description:
      'Attach an HTML board page to this session\'s custom sidebar group. The Host serves that page '
      + 'through a same-origin board column beside the conversation, so every session in the group '
      + 'shows it. Pass the absolute http(s) URL of the page to show. Requires this session to belong '
      + 'to a custom group.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'Absolute http(s) URL of the board page the Host should proxy.',
      },
    },
    output: jsonOutput(BOARD_VALUE_SCHEMA),
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('set_group_board requires an owning agent session')
      const group = ctx.agentGroups.groupOf(session.id)
      if (group === undefined) {
        throw new Error('set_group_board requires this session to belong to a custom sidebar group')
      }
      await ctx.agentGroups.setBoardUrl(group.id, args.url)
      return { group: { id: group.id, name: group.name }, boardUrl: args.url }
    },
  }))
}
