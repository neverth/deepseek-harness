import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { AgentGroupRecord } from '@deepseek-ai/dsh-agent-groups'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import * as agentGroupWorkspace from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function group(id: string, name: string, sessionIds: readonly string[], dirName?: string): AgentGroupRecord {
  return { id, name, sessionIds: sessionIds.map(SessionId), ...dirName === undefined ? {} : { dirName } }
}

interface FixtureOptions {
  /** Groups the fake Host registry starts with. */
  readonly groups: readonly AgentGroupRecord[]
  /** `null` means no Workspace owns any Session. */
  readonly workspacePath?: string | null
  /** Use a regular file as the Workspace root so directory creation fails. */
  readonly workspaceIsFile?: boolean
  /** Make the registry report no groups after the Session lookup. */
  readonly vanishOnAssign?: boolean
  /** Make the durable directory-name write fail. */
  readonly failAssignment?: boolean
  /** With `false`, the persona suppresses optional runtime context. */
  readonly includeRuntimeContext?: boolean
}

interface Fixture {
  readonly ctx: Context
  readonly root: string
  readonly agent: Agent
  readonly groups: AgentGroupRecord[]
  readonly assignments: { readonly groupId: string; readonly dirName: string }[]
  assemble(): Promise<PromptPresentation>
  [Symbol.asyncDispose](): Promise<void>
}

async function fixture(options: FixtureOptions): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agent-group-workspace-')))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  const groups = [...options.groups]
  const assignments: { groupId: string; dirName: string }[] = []
  const workspaceSessions = groups.flatMap(candidate => candidate.sessionIds)
  let workspacePath = options.workspacePath === undefined ? root : options.workspacePath
  if (options.workspaceIsFile === true) {
    workspacePath = join(root, 'workspace-is-a-file')
    await writeFile(workspacePath, '')
  }
  await mountAgentLoopTestDependencies(ctx, options.includeRuntimeContext === false
    ? { systemPrompt: { includeRuntimeContext: false } }
    : {})
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('agentGroups', {
    list: () => options.vanishOnAssign === true ? [] : groups,
    groupOf: (sessionId: SessionId) => groups.find(candidate => candidate.sessionIds.includes(sessionId)),
    setDirectoryName: async (groupId: string, dirName: string) => {
      if (options.failAssignment === true) throw new Error('storage unavailable')
      const index = groups.findIndex(candidate => candidate.id === groupId)
      if (index === -1) throw new Error(`missing group ${groupId}`)
      const updated: AgentGroupRecord = { ...groups[index]!, dirName }
      groups[index] = updated
      assignments.push({ groupId, dirName })
      return updated
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    list: () => workspacePath === null ? [] : [{ path: workspacePath, sessionIds: workspaceSessions }],
  } as never)
  await ctx.plugin(agentGroupWorkspace)
  const agent = await ctx.agentLoop.create(SessionId('session-a'), { provider: 'mock', model: 'mock' })
  return {
    ctx,
    root,
    agent,
    groups,
    assignments,
    assemble: () => ctx.systemPrompt.assemble(assembleContextFor(agent)),
    async [Symbol.asyncDispose]() {},
  }
}

function contextText(assembly: PromptPresentation): string | undefined {
  const text = assembly.contexts.find(entry => entry.name === 'agent-groups:temp')?.text
  return text === '' ? undefined : text
}

describe('plugin exports', () => {
  it('exports only the named plugin face the loader consumes', () => {
    expect(agentGroupWorkspace.name).toBe('agent-group-workspace')
    expect(agentGroupWorkspace.inject).toEqual(['agentGroups', 'workspaceRegistry', 'systemPrompt'])
    expect('default' in agentGroupWorkspace).toBe(false)
  })
})

describe('shared group directory', () => {
  it('creates the directory inside the owning Workspace and states its absolute path', async () => {
    await using f = await fixture({ groups: [group('custom:1', '模型上线测试 1110', ['session-a'])] })
    const text = contextText(await f.assemble())
    expect(f.assignments).toHaveLength(1)
    const directoryName = f.assignments[0]!.dirName
    expect(directoryName).toMatch(/^\d{10}-模型上线测试-1110-[0-9a-f]{6}$/)
    const directory = join(f.root, '.tmp', directoryName)
    expect(text).toBe(
      'Shared temporary workspace for this session\'s custom group "模型上线测试 1110": '
      + `${JSON.stringify(directory)}. Sessions in the same group share this directory; `
      + 'put temporary files, notes, and intermediate outputs there.',
    )
    expect((await stat(directory)).isDirectory()).toBe(true)
    expect(await readFile(join(f.root, '.tmp', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('reuses the assigned name and directory on later assemblies', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    const first = contextText(await f.assemble())
    const second = contextText(await f.assemble())
    expect(second).toBe(first)
    expect(f.assignments).toHaveLength(1)
  })

  it('keeps the directory name across a rename while stating the new group name', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    const first = contextText(await f.assemble())
    f.groups[0] = { ...f.groups[0]!, name: 'Renamed' }
    const second = contextText(await f.assemble())
    expect(f.assignments).toHaveLength(1)
    expect(second).toContain('custom group "Renamed": ')
    expect(second?.includes(JSON.stringify(join(f.root, '.tmp', f.assignments[0]!.dirName)))).toBe(true)
    expect(second).not.toBe(first)
  })

  it('sanitizes the group name into one path segment and truncates long names', async () => {
    await using f = await fixture({
      groups: [
        group('custom:1', 'Release / 发布: v1?', ['session-a']),
        group('custom:2', '...', ['session-b']),
        group('custom:3', 'x'.repeat(60), ['session-c']),
      ],
    })
    await f.assemble()
    for (const id of ['session-b', 'session-c']) {
      const agent = await f.ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
      await f.ctx.systemPrompt.assemble(assembleContextFor(agent))
    }
    expect(f.assignments[0]!.dirName).toMatch(/^\d{10}-Release-发布-v1-[0-9a-f]{6}$/)
    expect(f.assignments[1]!.dirName).toMatch(/^\d{10}-group-[0-9a-f]{6}$/)
    expect(f.assignments[2]!.dirName).toMatch(new RegExp(`^\\d{10}-${'x'.repeat(40)}-[0-9a-f]{6}$`))
  })

  it('assigns one name when two assemblies of the same group race', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    const [first, second] = await Promise.all([f.assemble(), f.assemble()])
    expect(contextText(first)).toBe(contextText(second))
    expect(f.assignments).toHaveLength(1)
  })
})

describe('omitted context', () => {
  it('contributes nothing for an ungrouped Session', async () => {
    await using f = await fixture({ groups: [] })
    expect(contextText(await f.assemble())).toBeUndefined()
    await expect(access(join(f.root, '.tmp'))).rejects.toThrow()
  })

  it('contributes nothing when no Workspace owns the Session', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'], '2611110036-Release-a1b2c3')],
      workspacePath: null,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
    expect(f.assignments).toHaveLength(0)
  })

  it('drops a stated directory when the directory cannot be created', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'], '2611110036-Release-a1b2c3')],
      workspaceIsFile: true,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
  })

  it('leaves an assembly that suppresses optional runtime context untouched', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'], '2611110036-Release-a1b2c3')],
      includeRuntimeContext: false,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
  })

  it('contributes nothing without an Agent', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    const assembly = await f.ctx.systemPrompt.assemble()
    expect(contextText(assembly)).toBeUndefined()
  })

  it('drops the line when the group disappears before its name is stored', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'])],
      vanishOnAssign: true,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
    expect(f.assignments).toHaveLength(0)
  })

  it('drops the line when the durable name cannot be stored', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'])],
      failAssignment: true,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
  })

  it('drops the line when the directory cannot be created', async () => {
    await using f = await fixture({
      groups: [group('custom:1', 'Release', ['session-a'])],
      workspaceIsFile: true,
    })
    expect(contextText(await f.assemble())).toBeUndefined()
  })
})

describe('ignore file', () => {
  it('keeps the line when only the ignore file cannot be written', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    await mkdir(join(f.root, '.tmp', '.gitignore'), { recursive: true })
    expect(contextText(await f.assemble())).toBeDefined()
  })
})

describe('cancellation', () => {
  it('refuses to create the directory for an aborted assembly', async () => {
    await using f = await fixture({ groups: [group('custom:1', 'Release', ['session-a'])] })
    const controller = new AbortController()
    controller.abort()
    await expect(f.ctx.systemPrompt.assemble(assembleContextFor(f.agent, controller.signal))).rejects.toThrow()
  })
})
