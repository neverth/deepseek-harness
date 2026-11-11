/**
 * The board route over a real WebServer: the trust fence, the group lookup,
 * the same-origin proxy (refresh stripped, base injected), and the readable
 * failures. Upstream HTTP is a stubbed `fetch`; the server and the request
 * path are real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as AgentGroupBoard from '../src/index.ts'

let context: Context | undefined
/** Answer the connection stub gives every request until a test changes it. */
const trust: { rejection: 401 | 403 | undefined } = { rejection: undefined }
/** The registry rows the route reads. */
const groups: { id: string; name: string; sessionIds: readonly string[]; boardUrl?: string }[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  trust.rejection = undefined
  groups.length = 0
  vi.unstubAllGlobals()
})

/** Boot the webserver plus the board route on an OS-assigned loopback port. */
async function boot(): Promise<string> {
  const ctx = new Context()
  context = ctx
  ctx.provide('connection', { requestRejection: () => trust.rejection } as never)
  ctx.provide('agentGroups', { list: () => groups } as never)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
  await ctx.plugin(AgentGroupBoard)
  return `http://127.0.0.1:${String(ctx.webServer.port)}`
}

/** Replace global fetch with a stub and return the real HTTP client for the test's own request. */
function stubUpstream(handler: () => Promise<Response>): { calls: string[]; request: typeof fetch } {
  const calls: string[] = []
  const request = globalThis.fetch.bind(globalThis)
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return handler()
  })
  return { calls, request }
}

/** One upstream HTML page; its own refresh and root-relative link make passthrough observable. */
function upstreamHtml(): string {
  return [
    '<!doctype html><html><head>',
    '<meta http-equiv="refresh" content="5">',
    '<title>QA board</title></head>',
    '<body><a href="/t/qa-2">next</a></body></html>',
  ].join('')
}

describe(`GET ${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}`, () => {
  it('proxies the stored board URL without rewriting the document', async () => {
    groups.push({
      id: 'custom:2',
      name: '模型上线测试-1111',
      sessionIds: [],
      boardUrl: 'http://127.0.0.1:8765/t/qa-20261111105329-8b272f20',
    })
    const upstream = stubUpstream(() => Promise.resolve(new Response(upstreamHtml(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))
    const base = await boot()

    const response = await upstream.request(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=custom%3A2`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(await response.text()).toBe(upstreamHtml())
    expect(upstream.calls).toEqual(['http://127.0.0.1:8765/t/qa-20261111105329-8b272f20'])
  })

  it('never fetches a URL from the query and answers 404 for an unknown group', async () => {
    const upstream = stubUpstream(() => Promise.resolve(new Response(upstreamHtml())))
    const base = await boot()

    const response = await upstream.request(
      `${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=missing&url=${encodeURIComponent('https://example.com/')}`,
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Board not found')
    expect(upstream.calls).toEqual([])
  })

  it('answers a readable page while the group has no board URL', async () => {
    groups.push({ id: 'custom:2', name: '模型上线测试-1111', sessionIds: [] })
    const upstream = stubUpstream(() => Promise.resolve(new Response(upstreamHtml())))
    const base = await boot()

    const response = await upstream.request(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=custom%3A2`)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('set_group_board')
    expect(upstream.calls).toEqual([])
  })

  it('answers 502 when the upstream page cannot be reached', async () => {
    groups.push({ id: 'custom:2', name: 'QA', sessionIds: [], boardUrl: 'http://127.0.0.1:8765/t/qa-1' })
    const upstream = stubUpstream(() => Promise.reject(new Error('connect ECONNREFUSED')))
    const base = await boot()

    const response = await upstream.request(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=custom%3A2`)

    expect(response.status).toBe(502)
    expect(await response.text()).toContain('ECONNREFUSED')
  })

  it('answers 502 when the upstream page is not HTML', async () => {
    groups.push({ id: 'custom:2', name: 'QA', sessionIds: [], boardUrl: 'http://127.0.0.1:8765/t/qa-1' })
    const upstream = stubUpstream(() => Promise.resolve(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const base = await boot()

    const response = await upstream.request(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=custom%3A2`)

    expect(response.status).toBe(502)
    expect(await response.text()).toContain('did not answer HTML')
  })

  it('rejects an untrusted request before reading the registry', async () => {
    trust.rejection = 403
    groups.push({ id: 'custom:2', name: 'QA', sessionIds: [], boardUrl: 'http://127.0.0.1:8765/t/qa-1' })
    const upstream = stubUpstream(() => Promise.resolve(new Response(upstreamHtml())))
    const base = await boot()

    const response = await upstream.request(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}?group=custom%3A2`)

    expect(response.status).toBe(403)
    expect(upstream.calls).toEqual([])
  })

  it('answers 405 outside GET', async () => {
    const base = await boot()

    const response = await fetch(`${base}${AgentGroupBoard.AGENT_GROUP_BOARD_PATH}`, { method: 'POST' })

    expect(response.status).toBe(405)
  })
})
