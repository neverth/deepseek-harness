/** Wire contract of POST /agent-task: validation, orchestration order, and answers. */

import { Readable } from 'node:stream'
import { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { handleAgentTask } from '../src/handler.ts'

/** Minimal body-and-headers request for the route handler. */
function requestWith(body: unknown, options: {
  method?: string
  contentType?: string | null
  host?: string
  chunks?: readonly (Buffer | Uint8Array)[]
} = {}): IncomingMessage {
  const chunks = options.chunks ?? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? null))]
  const request = Readable.from(chunks) as IncomingMessage
  const headers: Record<string, string> = {}
  const contentType = options.contentType
  if (contentType !== null) headers['content-type'] = contentType ?? 'application/json'
  if (options.host !== undefined) headers.host = options.host
  Object.assign(request, { url: '/agent-task', method: options.method ?? 'POST', headers })
  return request
}

/** Response recorder compatible with the handler's writes. */
function recorder(): {
  response: ServerResponse
  state: { status?: number; headers?: Record<string, string>; body?: string }
} {
  const state: { status?: number; headers?: Record<string, string>; body?: string } = {}
  const chunks: Buffer[] = []
  const response: ServerResponse = Object.assign(Object.create(ServerResponse.prototype), {
    setHeader(name: string, value: string) {
      state.headers = { ...state.headers, [name]: value }
    },
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      if (headers !== undefined) state.headers = { ...state.headers, ...headers }
      return this
    },
    write() { return true },
    end(value?: string) {
      if (value !== undefined) chunks.push(Buffer.from(value))
      state.body = Buffer.concat(chunks).toString()
      return this
    },
  })
  return { response, state }
}

/** One decoded answer body. */
interface Answer {
  error?: string
  groupId?: string
  sessionId?: string
  url?: string
}

/** Decode the recorded response body. */
function answerOf(state: { body?: string }): Answer {
  return JSON.parse(state.body ?? '') as Answer
}

interface BenchOptions {
  trusted?: boolean
  workspaceFound?: boolean
  modelFailure?: unknown
  provideTeams?: boolean
  liveAgent?: boolean
  createFailure?: string
  promptFailure?: unknown
  noConnection?: boolean
  origin?: string
}

/** Boot the handler over fake Host services, recording the orchestration order. */
function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  const calls: string[] = []
  const selections: unknown[] = []
  const prompts: unknown[] = []
  const teamCalls: unknown[] = []
  const sessionId = SessionId('session-new')
  const agent = { model: { select: (selection: unknown) => { selections.push(selection) } } }
  if (options.noConnection !== true) {
    ctx.provide('connection', {
      isTrustedRequest: () => options.trusted ?? true,
    } as never)
  }
  ctx.provide('workspaceRegistry', {
    get: (id: string) => options.workspaceFound === false ? undefined : { id },
  } as never)
  ctx.provide('llm', {
    resolveCallConfig: async (selection: unknown) => {
      if (options.modelFailure !== undefined) throw options.modelFailure
      return selection
    },
  } as never)
  ctx.provide('agentGroups', {
    ensure: async (name: string) => {
      calls.push(`ensure:${name}`)
      return { id: 'custom:9', name, sessionIds: [] }
    },
    addSession: async (groupId: string, sid: string) => { calls.push(`add:${groupId}:${sid}`) },
  } as never)
  ctx.provide('sessionController', {
    create: async () => {
      calls.push('create')
      if (options.createFailure !== undefined) throw new Error(options.createFailure)
      return { sessionId }
    },
    prompt: async (request: unknown) => {
      calls.push('prompt')
      if (options.promptFailure !== undefined) throw options.promptFailure
      prompts.push(request)
      return { accepted: true }
    },
  } as never)
  ctx.provide('agents', {
    get: (id: string) => options.liveAgent === false || id !== sessionId ? undefined : agent,
  } as never)
  if (options.provideTeams !== false) {
    ctx.provide('agentTeams', {
      setEnabled: async (target: unknown, enabled: boolean) => { teamCalls.push([target, enabled]) },
    } as never)
  }
  ctx.provide('webServer', {
    protocol: 'http:',
    getOrigin: () => options.origin ?? 'http://10.37.242.122:3080',
  } as never)
  return { ctx, calls, selections, prompts, teamCalls, agent, sessionId }
}

const BODY = { name: '任务-1', prompt: '开始任务', workspaceId: 'ws-one' }

describe('POST /agent-task', () => {
  it('creates the group, Session, membership, and prompt in order and answers the link', async () => {
    const b = bench()
    const { response, state } = recorder()
    await handleAgentTask(b.ctx, requestWith(BODY, { host: '10.37.242.122:3080' }), response)
    expect(state.status).toBe(200)
    expect(answerOf(state)).toEqual({
      groupId: 'custom:9',
      sessionId: 'session-new',
      url: 'http://10.37.242.122:3080/?group=custom:9&template=modellaunch',
    })
    expect(b.calls).toEqual(['ensure:任务-1', 'create', 'add:custom:9:session-new', 'prompt'])
    expect(b.selections).toEqual([])
    expect(b.teamCalls).toEqual([])
    expect(b.prompts).toMatchObject([{ content: [{ type: 'text', text: '开始任务' }], mode: 'queue' }])
  })

  it('applies the requested model route, reasoning effort, and Team mode before the prompt', async () => {
    const b = bench()
    const { response, state } = recorder()
    await handleAgentTask(b.ctx, requestWith({
      ...BODY,
      model: { provider: 'deepseek-account', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
      team: true,
    }), response)
    expect(state.status).toBe(200)
    expect(b.selections).toEqual([
      { provider: 'deepseek-account', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
    ])
    expect(b.teamCalls).toEqual([[b.agent, true]])
    expect(b.calls).toEqual(['ensure:任务-1', 'create', 'add:custom:9:session-new', 'prompt'])
  })

  it('omits reasoning effort when the caller names only a model route', async () => {
    const b = bench()
    const { response, state } = recorder()
    await handleAgentTask(b.ctx, requestWith({
      ...BODY,
      model: { provider: 'deepseek-account', model: 'deepseek-v4.1-flash' },
    }), response)
    expect(state.status).toBe(200)
    expect(b.selections).toEqual([{ provider: 'deepseek-account', model: 'deepseek-v4.1-flash' }])
  })

  it('falls back to the bound origin when the request names no Host', async () => {
    for (const host of [{}, { host: '' }]) {
      const b = bench()
      const { response, state } = recorder()
      await handleAgentTask(b.ctx, requestWith(BODY, host), response)
      expect(state.status).toBe(200)
      expect(answerOf(state).url)
        .toBe('http://10.37.242.122:3080/?group=custom:9&template=modellaunch')
    }
  })

  it('accepts a request body delivered as a plain Uint8Array chunk', async () => {
    const b = bench()
    const { response, state } = recorder()
    await handleAgentTask(b.ctx, requestWith(undefined, {
      chunks: [new Uint8Array(Buffer.from(JSON.stringify(BODY)))],
    }), response)
    expect(state.status).toBe(200)
  })

  it('refuses an untrusted Host, a non-POST request, and non-JSON media types', async () => {
    const untrusted = recorder()
    await handleAgentTask(bench({ trusted: false }).ctx, requestWith(BODY), untrusted.response)
    expect(untrusted.state.status).toBe(403)

    const wrongMethod = recorder()
    await handleAgentTask(bench().ctx, requestWith(undefined, { method: 'GET' }), wrongMethod.response)
    expect(wrongMethod.state.status).toBe(405)
    expect(wrongMethod.state.headers?.allow).toBe('POST')

    for (const contentType of [null, 'text/plain']) {
      const wrongMedia = recorder()
      await handleAgentTask(bench().ctx, requestWith(BODY, { contentType }), wrongMedia.response)
      expect(wrongMedia.state.status).toBe(415)
    }
  })

  it('answers a missing trust fence as an internal failure', async () => {
    const { response, state } = recorder()
    await handleAgentTask(bench({ noConnection: true }).ctx, requestWith(BODY), response)
    expect(state.status).toBe(500)
    expect(answerOf(state).error).toMatch(/trust fence/)
  })

  it('rejects malformed JSON, schema violations, blank text, and unknown Workspaces', async () => {
    const cases: readonly {
      request: IncomingMessage
      status: number
      message: RegExp
      options?: BenchOptions
    }[] = [
      { request: requestWith('{not json'), status: 400, message: /not valid JSON/ },
      { request: requestWith({ ...BODY, prompt: undefined }), status: 400, message: /prompt/ },
      { request: requestWith({ ...BODY, name: '   ' }), status: 400, message: /name must not be blank/ },
      { request: requestWith({ ...BODY, prompt: ' \n ' }), status: 400, message: /prompt must not be blank/ },
      { request: requestWith(BODY), status: 404, message: /not found/, options: { workspaceFound: false } },
    ]
    for (const testCase of cases) {
      const { response, state } = recorder()
      await handleAgentTask(bench(testCase.options).ctx, testCase.request, response)
      expect(state.status).toBe(testCase.status)
      expect(answerOf(state).error).toMatch(testCase.message)
    }
  })

  it('rejects an unavailable model route before creating anything', async () => {
    for (const modelFailure of [new Error('route is not registered'), 'route is not registered']) {
      const b = bench({ modelFailure })
      const { response, state } = recorder()
      await handleAgentTask(b.ctx, requestWith({
        ...BODY,
        model: { provider: 'missing', model: 'missing' },
      }), response)
      expect(state.status).toBe(400)
      expect(answerOf(state).error).toMatch(/model route is unavailable: route is not registered/)
      expect(b.calls).toEqual([])
    }
  })

  it('refuses Team mode when this deployment mounts no Team service', async () => {
    const b = bench({ provideTeams: false })
    const { response, state } = recorder()
    await handleAgentTask(b.ctx, requestWith({ ...BODY, team: true }), response)
    expect(state.status).toBe(501)
    expect(b.calls).toEqual([])
  })

  it('answers an oversized body without reading the rest', async () => {
    const { response, state } = recorder()
    await handleAgentTask(bench().ctx, requestWith(undefined, {
      chunks: [Buffer.alloc(1024 * 1024 + 1)],
    }), response)
    expect(state.status).toBe(413)
    expect(answerOf(state).error).toMatch(/exceeds/)
  })

  it('reports the created group and Session when creation or prompting fails', async () => {
    const createFailed = bench({ createFailure: 'workspace refused the Session' })
    const createAnswer = recorder()
    await handleAgentTask(createFailed.ctx, requestWith(BODY), createAnswer.response)
    expect(createAnswer.state.status).toBe(500)
    expect(answerOf(createAnswer.state)).toEqual({
      error: 'workspace refused the Session',
      groupId: 'custom:9',
    })

    const noAgent = bench({ liveAgent: false })
    const noAgentAnswer = recorder()
    await handleAgentTask(noAgent.ctx, requestWith(BODY), noAgentAnswer.response)
    expect(noAgentAnswer.state.status).toBe(500)
    expect(answerOf(noAgentAnswer.state)).toMatchObject({
      groupId: 'custom:9',
      sessionId: 'session-new',
    })

    for (const promptFailure of [new Error('prompt admission failed'), 'prompt admission failed']) {
      const promptFailed = bench({ promptFailure })
      const promptAnswer = recorder()
      await handleAgentTask(promptFailed.ctx, requestWith(BODY), promptAnswer.response)
      expect(promptAnswer.state.status).toBe(500)
      expect(answerOf(promptAnswer.state)).toMatchObject({
        error: 'prompt admission failed',
        groupId: 'custom:9',
        sessionId: 'session-new',
      })
    }
  })
})
