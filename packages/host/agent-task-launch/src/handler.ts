/**
 * Wire handling for `POST /agent-task`: bounded JSON parsing, request
 * validation, and the create-group → create-Session → select model → enable
 * Team → join group → prompt sequence behind one answer.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { TeamService } from '@deepseek-ai/dsh-agent-team'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Largest accepted request body; the prompt is the only unbounded field. */
const MAX_BODY_BYTES = 1024 * 1024

/** Model route and reasoning effort one launch asks for. */
const modelRequest = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
}).strict()

/** Complete accepted body of one task launch. */
const launchRequest = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  workspaceId: z.string().min(1),
  model: modelRequest.optional(),
  team: z.boolean().optional(),
}).strict()

/** One wire-validated launch request. */
type LaunchRequest = z.infer<typeof launchRequest>

/** Trust surface consumed here; the browser composition owns the full connection service. */
interface LaunchConnection {
  isTrustedRequest(request: { readonly headers: IncomingMessage['headers'] }): boolean
}

/** A failure whose status and message answer the caller. */
class LaunchHttpError extends Error {
  /**
   * @param status - HTTP status code sent to the caller.
   * @param message - caller-readable reason.
   */
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * Read the request body as UTF-8 JSON under the size ceiling.
 * @param request - request owning the body stream.
 * @returns the parsed JSON value.
 * @throws LaunchHttpError for an oversized or malformed body.
 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of request) {
    const chunk: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      request.resume()
      throw new LaunchHttpError(413, `request body exceeds ${MAX_BODY_BYTES} bytes`)
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    // JSON.parse is the only statement in the try; no other failure is normalized.
    throw new LaunchHttpError(400, 'request body is not valid JSON')
  }
}

/** Whether Content-Type names JSON. */
function isJsonContentType(value: string | undefined): boolean {
  return value?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/**
 * Send one JSON answer.
 * @param response - response owning the socket.
 * @param status - HTTP status code.
 * @param value - JSON-serializable body.
 */
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Resolve the composition's trust fence, failing loud when absent.
 * @param ctx - Host context carrying the fence.
 * @returns the fence applied to the launch request.
 */
function connectionOf(ctx: Context): LaunchConnection {
  const connection = ctx.get('connection') as LaunchConnection | undefined
  if (connection === undefined) throw new LaunchHttpError(500, 'the connection trust fence is unavailable')
  return connection
}

/**
 * Resolve the optional Agent Team service for a launch that asks for it.
 * @param ctx - Host context.
 * @returns the Team service, or undefined when the launch leaves Team off.
 * @throws LaunchHttpError when Team is requested and this deployment mounts no Team service.
 */
function teamServiceOf(ctx: Context, request: LaunchRequest): TeamService | undefined {
  if (request.team !== true) return undefined
  const teams = ctx.get('agentTeams')
  if (teams === undefined) throw new LaunchHttpError(501, 'this deployment mounts no Agent Team service')
  return teams
}

/**
 * Build the browser link for one launched group.
 * @param ctx - Host context carrying the listener protocol.
 * @param request - request whose Host names the reachable authority.
 * @param groupId - launched group id.
 * @returns the templated group link.
 */
function launchUrl(ctx: Context, request: IncomingMessage, groupId: string): string {
  const host = request.headers.host
  const origin = host === undefined || host === ''
    ? ctx.webServer.getOrigin()
    : `${ctx.webServer.protocol}//${host}`
  return `${origin}/?group=${groupId}&template=modellaunch`
}

/**
 * Validate one request body and answer the created task link.
 * @param ctx - Host context carrying group, Session, model, Workspace, and Team services.
 * @param request - incoming HTTP request.
 * @param response - response owning the socket.
 * @returns after the answer is written.
 */
export async function handleAgentTask(
  ctx: Context,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let groupId: string | undefined
  let sessionId: string | undefined
  try {
    if (!connectionOf(ctx).isTrustedRequest(request)) {
      throw new LaunchHttpError(403, 'the Host header is not trusted by this deployment')
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      throw new LaunchHttpError(405, 'method not allowed')
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new LaunchHttpError(415, 'content type must be application/json')
    }
    const parsed = launchRequest.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      throw new LaunchHttpError(400, parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    }
    const body = parsed.data
    const name = body.name.trim()
    if (name === '') throw new LaunchHttpError(400, 'name must not be blank')
    if (body.prompt.trim() === '') throw new LaunchHttpError(400, 'prompt must not be blank')

    const workspaceId = brandString<WorkspaceId>(body.workspaceId)
    if (ctx.workspaceRegistry.get(workspaceId) === undefined) {
      throw new LaunchHttpError(404, `workspace "${body.workspaceId}" not found`)
    }
    const teams = teamServiceOf(ctx, body)
    let selection: ModelSelection | undefined
    if (body.model !== undefined) {
      selection = {
        provider: body.model.provider,
        model: body.model.model,
        ...body.model.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(body.model.reasoningEffort) },
      }
      try {
        await ctx.llm.resolveCallConfig(selection)
      } catch (error) {
        throw new LaunchHttpError(400,
          `model route is unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const group = await ctx.agentGroups.ensure(name)
    groupId = group.id
    const created = await ctx.sessionController.create({ workspaceId })
    sessionId = created.sessionId
    const agent = ctx.agents.get(created.sessionId)
    if (agent === undefined) {
      throw new LaunchHttpError(500, `session "${created.sessionId}" was created without a live Agent`)
    }
    if (selection !== undefined) agent.model.select(selection)
    if (teams !== undefined) await teams.setEnabled(agent, true)
    // Membership precedes the prompt so the first assembly states the group's
    // shared temporary directory to the model.
    await ctx.agentGroups.addSession(group.id, created.sessionId)
    await ctx.sessionController.prompt({
      requestId: brandString<SessionRequestId>(randomUUID()),
      sessionId: created.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: body.prompt }],
    }, new AbortController().signal)
    sendJson(response, 200, {
      groupId: group.id,
      sessionId: created.sessionId,
      url: launchUrl(ctx, request, group.id),
    })
  } catch (error) {
    const status = error instanceof LaunchHttpError ? error.status : 500
    sendJson(response, status, {
      error: error instanceof Error ? error.message : String(error),
      ...groupId === undefined ? {} : { groupId },
      ...sessionId === undefined ? {} : { sessionId },
    })
  }
}
