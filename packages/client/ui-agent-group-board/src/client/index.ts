/**
 * Agent-group board plugin, browser half: the `conversation.left-rail` entry
 * that shows the selected Session's hand-made group board beside the
 * conversation. Group membership and the board URL come from the Host group
 * document; the Host route named by the iframe proxies the page same-origin.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.workspaces service declaration.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the conversation.left-rail slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AGENT_GROUP_BOARD_NS, BoardRail } from './AgentGroupBoard.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

export { BoardRail, AGENT_GROUP_BOARD_NS } from './AgentGroupBoard.tsx'
export type { AgentGroupBoardProps, BoardRailProps } from './AgentGroupBoard.tsx'
export type { AgentGroupBoardInjected } from './slots.ts'
export type { AgentGroupBoardKey } from './locales.ts'

/** Services required by the board entry, its Host group reads, and its copy. */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Register the board column and its dictionaries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(AGENT_GROUP_BOARD_NS, { zh, en, ja, es, fr, de, ru, pt }),
    'ui-agent-group-board: dictionaries',
  )
  ctx.slots.inject('conversation.left-rail', () => ctx.slots.register({
    name: 'conversation.left-rail',
    locale: AGENT_GROUP_BOARD_NS,
    inject: () => ({ loadGroups: () => ctx.workspaces.listGroups() }),
  }, BoardRail))
}
