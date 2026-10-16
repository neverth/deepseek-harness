/**
 * Session Controller title-refresh delegation through the composed
 * SessionTitleService. The agent factory is the same structural stub the rename
 * spec uses, so every source here is already attached and `agentFor` resolves
 * without a resume. What this spec owns is the mapping of the three outcomes a
 * refresh can produce: an accepted revision, no eligible text, and a provider
 * failure.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionTitleService, { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

function request<P>(payload: P): P {
  return payload
}

async function composed(withTitles = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withTitles) {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
  }
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      await ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  return ctx
}

/** Register one live agent whose log holds `turns` completed turns. */
async function liveAgent(ctx: Context, id: string, turns: number): Promise<Session> {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('sessions.refreshTitle', () => {
  it('materializes the fallback without a provider and echoes the committed seq', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh', 1)

    const refreshed = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    const event = source.snapshotEvents().findLast(item => item.type === 'session/title')
    expect(event?.seq).toBe(refreshed.value.seq)
    expect(event?.data).toMatchObject({ title: refreshed.value.title })
  })

  it('returns an empty value when the Session holds no eligible human text', async () => {
    const ctx = await composed()
    const empty = await liveAgent(ctx, 'session-refresh-empty', 0)

    const refreshed = await remote(ctx).refreshTitle(request({ sessionId: empty.id }))
    expect(refreshed.ok).toBe(true)
    if (refreshed.ok) expect(refreshed.value).toEqual({})
  })

  it('maps a provider failure to internal', async () => {
    const ctx = await composed()
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('boom'),
      automatic: 'first-prompt',
      generate: () => Promise.reject(new Error('title backend failed')),
    })
    const source = await liveAgent(ctx, 'session-refresh-boom', 1)

    const refreshed = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(refreshed.ok).toBe(false)
    if (!refreshed.ok) {
      expect(refreshed.error.code).toBe('gateway/internal')
      expect(refreshed.error.message).toMatch(/title backend failed/)
    }
  })

  it('answers internal when the composition mounts no session-title service', async () => {
    const ctx = await composed(false)
    const source = await liveAgent(ctx, 'session-refresh-no-titles', 1)

    const refreshed = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(refreshed.ok).toBe(false)
    if (!refreshed.ok) {
      expect(refreshed.error.code).toBe('gateway/internal')
      expect(refreshed.error.message).toMatch(/mounts no session-title service/)
    }
  })
})
