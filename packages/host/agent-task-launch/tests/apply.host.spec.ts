/** Route registration and disposal of the task-launch plugin. */

import { Readable } from 'node:stream'
import { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AGENT_TASK_PATH, apply, inject, name } from '../src/index.ts'

/** One route as the plugin registered it. */
interface RegisteredRoute {
  kind: string
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void
}

describe('agent-task-launch plugin', () => {
  it('registers the exact route, answers through the handler, and releases it on disposal', async () => {
    const ctx = new Context()
    const routes: RegisteredRoute[] = []
    ctx.provide('webServer', {
      register: (route: RegisteredRoute) => {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
    } as never)
    ctx.provide('connection', { isTrustedRequest: () => true } as never)
    const fiber = ctx.plugin(apply)
    await fiber.await()

    expect(name).toBe('agent-task-launch')
    expect(inject).toContain('webServer')
    expect(routes).toHaveLength(1)
    expect(routes[0]?.kind).toBe('exact')
    expect(routes[0]?.path).toBe(AGENT_TASK_PATH)

    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, {
      url: AGENT_TASK_PATH,
      method: 'GET',
      headers: { host: '127.0.0.1:3080' },
    })
    const state: { status?: number } = {}
    const response: ServerResponse = Object.assign(Object.create(ServerResponse.prototype), {
      setHeader() {},
      writeHead(status: number) {
        state.status = status
        return this
      },
      end() {
        return this
      },
    })
    await routes[0]?.handler(request, response)
    expect(state.status).toBe(405)

    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })
})
