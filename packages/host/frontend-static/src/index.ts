/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root and configured index
 * path; missing paths return 404, traversal outside the dist root is 403,
 * unknown extensions ship as octet-stream, and non-GET/HEAD is 405. Every
 * index response first passes Connection's browser authentication, then the
 * webserver's index render (structured injection rows, then raw taps).
 * Non-index assets stay public. The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/**
 * Fixed cookie carrying the secret-path unlock. The value is the configured
 * secret itself; a request whose cookie matches may render the SPA index. This
 * is a bare reachability gate for a trusted-LAN deployment, not authentication.
 */
const GATE_COOKIE = 'dsh-gate'

/** Gate cookie lifetime in seconds: 30 days, so one knock lasts a month. */
const GATE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** Read one cookie value from a request's Cookie header without a full parser. */
function readCookie(req: IncomingMessage, cookieName: string): string | undefined {
  const raw = req.headers.cookie
  if (raw === undefined) return undefined
  for (const segment of raw.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== cookieName) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
  /**
   * Optional secret path segment gating the SPA index. When set, the index
   * renders only for a request carrying the matching gate cookie; visiting
   * `/<secretPath>` sets that cookie and redirects to the clean root. Bare `/`
   * without it returns 404 (no page). Unset leaves the index ungated.
   */
  secretPath?: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
  secretPath: z.string(),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - authenticates an index response before its bytes are read.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => boolean,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  try {
    if (target === distRoot || target === distIndex) {
      if (!authorizeIndex()) return
      body = await renderIndex()
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const secretPath = config.secretPath
  // Insert after all index transforms so the base precedes every resource reference.
  const renderIndex = async (): Promise<string> => {
    const body = ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
    return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="./">`)
  }
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const requestUrl = new URL(req.url ?? '/', 'http://x')
    const pathname = decodeURIComponent(requestUrl.pathname)
    // Secret-path gate: the knock (`/<secretPath>`) sets the gate cookie and
    // redirects to the clean root; an index served below additionally requires
    // that cookie. Assets stay public — the hashed shell is inert without the
    // gated index, which is what reveals the session list.
    if (secretPath !== undefined) {
      if (req.method === 'GET' && (pathname === `/${secretPath}` || pathname === `/${secretPath}/`)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': './',
          'set-cookie': `${GATE_COOKIE}=${encodeURIComponent(secretPath)}; Max-Age=${String(GATE_COOKIE_MAX_AGE_SECONDS)}; Path=/; HttpOnly; SameSite=Lax`,
        })
        res.end()
        return
      }
    }
    // A `?share=<id>` link opens one session's isolated view and is exempt from
    // the knock: the recipient reaches only that session, never the list, and
    // no gate cookie is set, so the bare root stays 404 for them. The hash form
    // (`#share=`) never reaches the server, so the share link must carry the id
    // as this query param to pass the gate.
    const sharing = requestUrl.searchParams.has('share')
    const gatePasses = (): boolean => {
      if (secretPath === undefined || sharing) return true
      if (readCookie(req, GATE_COOKIE) === encodeURIComponent(secretPath)) return true
      // No knock cookie: the index does not exist for this caller.
      res.writeHead(404)
      res.end()
      return false
    }
    await serveStatic(
      pathname,
      res,
      distRoot,
      distIndex,
      () => gatePasses() && ctx.connection.authorizeIndex(req, res),
      renderIndex,
    )
  }), 'frontend-static: fallback seat')
}
