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
// Type-only: pulls the ctx.sidebarRight service declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the file resource navigation params (`line`).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { AGENT_GROUP_BOARD_NS, BoardRail } from './AgentGroupBoard.tsx'
import { boardFileAddress } from './open-file.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'

export { BoardRail, AGENT_GROUP_BOARD_NS } from './AgentGroupBoard.tsx'
export type { AgentGroupBoardProps, BoardRailProps } from './AgentGroupBoard.tsx'
export type { AgentGroupBoardInjected } from './slots.ts'
export type { AgentGroupBoardKey } from './locales.ts'

/** Services required by the board entry, its Host reads, its files, and its copy. */
export const inject = ['slots', 'workspaces', 'locale', 'sessions', 'sidebarRight']

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
    inject: () => ({
      loadGroups: () => ctx.workspaces.listGroups(),
      openFile: (root, request) => {
        const cwd = ctx.sessions.list.getSnapshot().byId[root]?.cwd
        // The live working directory may have moved away from the Session's
        // initial cwd; an unretained root Session keeps the summary cwd.
        const binding = ctx.sessions.binding(root)
        const current = binding?.session.projections.faceOf('workingDirectory')
          .getSnapshot() as string | null | undefined
        const address = boardFileAddress(root, cwd, current ?? undefined, request.path)
        if (request.line === undefined) ctx.sidebarRight.openResource(address)
        else ctx.sidebarRight.openResource(address, { params: { line: request.line } })
      },
    }),
  }, BoardRail))
}
