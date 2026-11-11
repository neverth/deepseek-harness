/**
 * Same-origin board route for hand-made session groups. The browser board
 * column embeds `/agent-group-board?group=<id>`; this route looks the group up
 * in the durable registry, fetches the group's `boardUrl`, and answers the
 * HTML. Only the stored URL is ever fetched — the query never carries one — so
 * the route cannot be used as an open proxy.
 *
 * The answer is sandboxed to an opaque origin: the proxied page keeps its
 * scripts and links but cannot read DSH cookies, storage, or Remote endpoints.
 * The upstream document is served unchanged, so the board page owns its own
 * refresh and link resolution.
 *
 * @module @deepseek-ai/dsh-host-agent-group-board
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-groups'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Cordis function-plugin name. */
export const name = 'agent-group-board'
/** The route carrier, the group registry holding each board URL, and the trust fence. */
export const inject = ['webServer', 'agentGroups', 'connection']

/** Path the browser board column embeds. */
export const AGENT_GROUP_BOARD_PATH = '/agent-group-board'

/** Upper bound on one upstream read, so a stalled board cannot hold the request open. */
const UPSTREAM_TIMEOUT_MS = 15_000

/** The sandbox keeps proxied scripts away from the DSH origin; links, forms, and popups still work. */
const BOARD_POLICY = 'sandbox allow-scripts allow-forms allow-popups'

/** Trust surface consumed here; the browser composition owns the full connection service. */
interface BoardConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Resolve the composition's connection trust fence, failing loud when absent.
 * @param ctx - host context carrying the fence.
 * @returns the trust fence used to reject untrusted requests.
 */
function connectionOf(ctx: Context): BoardConnection {
  const connection = ctx.get('connection') as BoardConnection | undefined
  if (connection === undefined) throw new Error('agent-group-board: the connection trust fence is unavailable')
  return connection
}

/**
 * Escape text inserted into the placeholder page.
 * @param value - untrusted text such as an upstream error message.
 * @returns HTML text safe inside an element body.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * One readable page the board column can show instead of upstream content.
 * @param title - short headline.
 * @param detail - explanation or upstream failure text.
 * @returns a complete HTML document.
 */
function placeholderPage(title: string, detail: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#444;background:#fff}',
    'main{max-width:560px;margin:0 auto;padding:48px 24px}',
    'h1{font-size:16px;margin:0 0 8px}',
    'p{margin:0;color:#777;white-space:pre-wrap;overflow-wrap:anywhere}',
    '</style></head><body><main>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(detail)}</p>`,
    '</main></body></html>',
  ].join('')
}

/**
 * Answer one board response with the shared HTML headers.
 * @param res - response owning the socket.
 * @param status - HTTP status code.
 * @param html - complete document text.
 * @returns nothing; the response is ended here.
 */
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'content-security-policy': BOARD_POLICY,
    'referrer-policy': 'no-referrer',
  })
  res.end(html)
}

/**
 * Serve the board of one group by proxying its stored URL.
 * @param ctx - host context with the registry and the trust fence.
 * @param req - incoming request.
 * @param res - response owning the socket.
 */
async function serve(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rejection = connectionOf(ctx).requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return
  }
  if (req.method !== 'GET') {
    sendHtml(res, 405, placeholderPage('Method not allowed', 'The board route answers GET only.'))
    return
  }
  const groupId = new URL(String(req.url), 'http://localhost').searchParams.get('group') ?? ''
  const group = ctx.agentGroups.list().find(entry => entry.id === groupId)
  if (group === undefined) {
    sendHtml(res, 404, placeholderPage('Board not found', `No custom group has the id ${JSON.stringify(groupId)}.`))
    return
  }
  if (group.boardUrl === undefined) {
    sendHtml(res, 404, placeholderPage(
      'This group has no board',
      'Ask an agent in this group to call set_group_board with the board page URL.',
    ))
    return
  }
  let upstream: Response
  try {
    upstream = await fetch(group.boardUrl, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    sendHtml(res, 502, placeholderPage('The board page could not be reached', message))
    return
  }
  if (!upstream.ok) {
    sendHtml(res, 502, placeholderPage(
      'The board page answered with an error',
      `${group.boardUrl} answered ${String(upstream.status)} ${upstream.statusText}.`,
    ))
    return
  }
  const contentType = upstream.headers.get('content-type')
  if (contentType !== null && !contentType.toLowerCase().includes('text/html')) {
    sendHtml(res, 502, placeholderPage(
      'The board URL did not answer HTML',
      `${group.boardUrl} answered ${contentType}. Point the board at an HTML page.`,
    ))
    return
  }
  sendHtml(res, 200, await upstream.text())
}

/**
 * Register the board route.
 * @param ctx - host context carrying the route carrier, the registry, and the trust fence.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AGENT_GROUP_BOARD_PATH,
    handler: (req, res) => serve(ctx, req, res),
  }), `agent-group-board: GET ${AGENT_GROUP_BOARD_PATH}`)
}
