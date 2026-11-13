/**
 * LAN HTTP endpoint that starts one model-launch task in a hand-made group:
 * it ensures the group by name, creates its first Session in the named
 * Workspace, applies the requested model route, reasoning effort, and Team
 * mode, admits the prompt, and answers the group link the browser opens.
 *
 * The route is trusted by network reachability, not by a browser credential;
 * it still requires the request's Host to pass the deployment's trust fence.
 * @module @deepseek-ai/dsh-host-agent-task-launch
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-groups'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-workspace'
import { handleAgentTask } from './handler.ts'

/** Cordis function-plugin name. */
export const name = 'agent-task-launch'

/** Host services the route reads; the Agent Team service stays optional. */
export const inject = [
  'webServer',
  'connection',
  'agentGroups',
  'sessionController',
  'agents',
  'llm',
  'workspaceRegistry',
]

/** Exact path the LAN caller posts one task to. */
export const AGENT_TASK_PATH = '/agent-task'

/**
 * Register the task-launch route.
 * @param ctx - Host context carrying the route carrier and the services it reads.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AGENT_TASK_PATH,
    handler: (request: IncomingMessage, response: ServerResponse) => handleAgentTask(ctx, request, response),
  }), `agent-task-launch: POST ${AGENT_TASK_PATH}`)
}
