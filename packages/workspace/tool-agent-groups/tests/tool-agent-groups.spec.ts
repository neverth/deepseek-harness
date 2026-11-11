import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as toolAgentGroups from '../src/index.ts'

const contexts: Context[] = []
let callNumber = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function observation(
  id: string,
  title: string | undefined,
  cwd?: string,
): SessionTitleObservationResult {
  const sessionId = SessionId(id)
  return {
    sessionId,
    status: 'fulfilled',
    value: {
      session: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 1_700_000_000_000,
        isSeeded: false,
        ...cwd === undefined ? {} : { cwd },
      },
      ...title === undefined ? {} : {
        title: { title, messageSeqs: [], source: { kind: 'fallback' }, eventSeq: SessionSeq(1), updatedAt: 1 },
      },
    },
  }
}

async function harness(
  group: { readonly id: string; readonly name: string; readonly sessionIds: readonly string[] } | undefined,
  observations: (ids: readonly SessionId[]) => Promise<SessionTitleObservationResult[]> = ids =>
    Promise.resolve(ids.map(id => observation(id, `title-${id}`))),
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const readTitleSnapshots = vi.fn(observations)
  const setBoardUrl = vi.fn(async (_groupId: string, boardUrl: string) => {
    if (group === undefined) throw new Error('agent groups: unknown group id')
    return { id: group.id, name: group.name, sessionIds: group.sessionIds.map(SessionId), boardUrl }
  })
  ctx.provide('sessionQuery', { readTitleSnapshots } as never)
  ctx.provide('agentGroups', {
    groupOf: (sessionId: SessionId) => group !== undefined && group.sessionIds.includes(sessionId)
      ? { id: group.id, name: group.name, sessionIds: group.sessionIds.map(SessionId) }
      : undefined,
    setBoardUrl,
  } as never)
  await ctx.plugin(toolAgentGroups)
  const agent = await ctx.agentLoop.create(SessionId('session-a'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, readTitleSnapshots, setBoardUrl }
}

async function execute(
  ctx: Context,
  agent: Awaited<ReturnType<typeof harness>>['agent'],
  args: Record<string, unknown> = {},
  name = 'group_members',
) {
  const toolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'mock', model: 'mock' },
    signal: new AbortController().signal,
  })
  try {
    return await executeToolFixture(ctx, {
      callId: ToolCallId(`groups-call-${++callNumber}`),
      name,
      arguments: args,
      signal: new AbortController().signal,
      toolSet,
      agent,
    })
  } finally {
    toolSet.dispose()
  }
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('plugin exports', () => {
  it('exports only the named plugin face the preset loader consumes', () => {
    // The loader reads `apply`/`inject` from named exports; a default export
    // becomes the plugin itself and silently drops the injection declaration.
    expect(toolAgentGroups.inject).toEqual(['tools', 'agentGroups', 'sessionQuery', 'systemPrompt'])
    expect('default' in toolAgentGroups).toBe(false)
  })
})

describe('runtime context', () => {
  it('names the group the calling Session belongs to', async () => {
    const { ctx, agent } = await harness(
      { id: 'custom:1', name: 'Release', sessionIds: ['session-a', 'session-b'] },
    )
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.contexts.find(entry => entry.name === 'agent-groups:current')?.text).toBe(
      'This session belongs to the custom sidebar group "Release". '
      + 'It has 1 other session; call group_members to list them with their titles, working directories, and creation times.',
    )
  })

  it('contributes no text for an ungrouped Session', async () => {
    const { ctx, agent } = await harness(undefined)
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.contexts.find(entry => entry.name === 'agent-groups:current')?.text).toBe('')
  })
})

describe('group_members', () => {
  it('reports a null group when the calling Session is ungrouped', async () => {
    const { ctx, agent, readTitleSnapshots } = await harness(undefined)
    const result = await execute(ctx, agent)
    expect(JSON.parse(text(result))).toEqual({ group: null, members: [] })
    expect(readTitleSnapshots).not.toHaveBeenCalled()
  })

  it('lists every member with its title, directory, creation time, and current flag', async () => {
    const { ctx, agent } = await harness(
      { id: 'custom:1', name: 'Release', sessionIds: ['session-a', 'session-b'] },
      ids => Promise.resolve(ids.map(id => observation(id, `title-${id}`, `/work/${id}`))),
    )
    const result = await execute(ctx, agent)
    expect(JSON.parse(text(result))).toEqual({
      group: { id: 'custom:1', name: 'Release' },
      members: [
        {
          sessionId: 'session-a',
          title: 'title-session-a',
          cwd: '/work/session-a',
          createdAt: 1_700_000_000_000,
          current: true,
        },
        {
          sessionId: 'session-b',
          title: 'title-session-b',
          cwd: '/work/session-b',
          createdAt: 1_700_000_000_000,
          current: false,
        },
      ],
    })
  })

  it('keeps a member whose log could not be read', async () => {
    const { ctx, agent } = await harness(
      { id: 'custom:1', name: 'Release', sessionIds: ['session-a', 'session-b'] },
      ids => Promise.resolve(ids.map((id): SessionTitleObservationResult => id === SessionId('session-b')
        ? { sessionId: id, status: 'rejected', reason: new Error('unreadable log') }
        : observation(id, undefined))),
    )
    const result = await execute(ctx, agent)
    expect(JSON.parse(text(result))).toEqual({
      group: { id: 'custom:1', name: 'Release' },
      members: [
        { sessionId: 'session-a', title: null, createdAt: 1_700_000_000_000, current: true },
        { sessionId: 'session-b', title: null, current: false },
      ],
    })
  })
})

describe('set_group_board', () => {
  it('writes the board URL onto the calling Session\'s group', async () => {
    const { ctx, agent, setBoardUrl } = await harness(
      { id: 'custom:1', name: 'Release', sessionIds: ['session-a'] },
    )
    const url = 'http://10.37.242.122:8765/t/qa-20261111105329-8b272f20'
    const result = await execute(ctx, agent, { url }, 'set_group_board')
    expect(JSON.parse(text(result))).toEqual({
      group: { id: 'custom:1', name: 'Release' },
      boardUrl: url,
    })
    expect(setBoardUrl).toHaveBeenCalledWith('custom:1', url)
  })

  it('refuses an ungrouped Session without writing', async () => {
    const { ctx, agent, setBoardUrl } = await harness(undefined)
    const result = await execute(ctx, agent, { url: 'https://boards.example/qa' }, 'set_group_board')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('belong to a custom sidebar group')
    expect(setBoardUrl).not.toHaveBeenCalled()
  })

  it('surfaces a registry rejection to the model', async () => {
    const { ctx, agent, setBoardUrl } = await harness(
      { id: 'custom:1', name: 'Release', sessionIds: ['session-a'] },
    )
    setBoardUrl.mockRejectedValueOnce(new Error('agent groups: a board URL must be an absolute http(s) URL'))
    const result = await execute(ctx, agent, { url: 'file:///etc/passwd' }, 'set_group_board')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('absolute http(s) URL')
  })
})
