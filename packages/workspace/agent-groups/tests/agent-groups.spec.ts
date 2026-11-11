import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import AgentGroupRegistry, { agentGroupsDomainState } from '../src/index.ts'
import type { AgentGroupRecord } from '../src/index.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** Boot the real storage/domain/registry composition over one medium. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const changes: unknown[] = []
  ctx.on('domain/changed', (change) => { changes.push(change) })
  await ctx.plugin(AgentGroupRegistry)
  changes.length = 0
  return { ctx, registry: ctx.agentGroups, changes, pool }
}

function group(id: string, name: string, sessionIds: string[], dirName?: string, boardUrl?: string): AgentGroupRecord {
  return {
    id,
    name,
    sessionIds: sessionIds.map(SessionId),
    ...dirName === undefined ? {} : { dirName },
    ...boardUrl === undefined ? {} : { boardUrl },
  }
}

describe('AgentGroupRegistry', () => {
  it('starts empty and answers the group a Session belongs to', async () => {
    const { registry } = await harness()
    expect(registry.list()).toEqual([])
    expect(registry.groupOf(SessionId('s1'))).toBeUndefined()

    const groups = [group('custom:1', 'Release', ['s1', 's2']), group('custom:2', 'Docs', ['s3'])]
    await expect(registry.replace(groups)).resolves.toEqual(groups)
    expect(registry.list()).toEqual(groups)
    expect(registry.groupOf(SessionId('s2'))?.id).toBe('custom:1')
    expect(registry.groupOf(SessionId('s3'))?.id).toBe('custom:2')
    expect(registry.groupOf(SessionId('s4'))).toBeUndefined()
  })

  it('skips the durable write when the browser repeats the stored document', async () => {
    const { registry, changes } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    expect(changes).toHaveLength(1)
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    expect(changes).toHaveLength(1)
  })

  it('rejects duplicate group ids and a Session placed in two groups without changing the document', async () => {
    const { registry } = await harness()
    const original = [group('custom:1', 'Release', ['s1'])]
    await registry.replace(original)

    await expect(registry.replace([
      group('custom:1', 'Release', ['s1']),
      group('custom:1', 'Again', []),
    ])).rejects.toThrow(/duplicate group id/)
    await expect(registry.replace([
      group('custom:1', 'Release', ['s1']),
      group('custom:2', 'Docs', ['s1']),
    ])).rejects.toThrow(/appears in groups/)
    expect(registry.list()).toEqual(original)
  })

  it('rejects a document that repeats one member inside its own group', async () => {
    const { registry } = await harness()
    await expect(registry.replace([group('custom:1', 'Release', ['s1', 's1'])]))
      .rejects.toThrow(/appears in groups/)
    expect(registry.list()).toEqual([])
  })

  it('reloads the stored document from the same medium', async () => {
    const { registry, pool } = await harness()
    const groups = [group('custom:1', 'Release', ['s1'])]
    await registry.replace(groups)

    const reopened = await harness(pool)
    expect(reopened.registry.list()).toEqual(groups)
  })

  it('stores one shared directory name and keeps it across browser pushes and renames', async () => {
    const { registry, changes } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1']), group('custom:2', 'Docs', ['s2'])])
    const named = await registry.setDirectoryName('custom:1', '2611110036-Release-a1b2c3')
    expect(named.dirName).toBe('2611110036-Release-a1b2c3')
    expect(registry.list()).toEqual([
      group('custom:1', 'Release', ['s1'], '2611110036-Release-a1b2c3'),
      group('custom:2', 'Docs', ['s2']),
    ])
    expect(changes).toHaveLength(2)

    await expect(registry.setDirectoryName('custom:1', '2611110036-Release-a1b2c3')).resolves.toEqual(named)
    expect(changes).toHaveLength(2)

    await expect(registry.replace([
      group('custom:1', 'Release renamed', ['s1']),
      group('custom:2', 'Docs', ['s2']),
    ])).resolves.toEqual([
      group('custom:1', 'Release renamed', ['s1'], '2611110036-Release-a1b2c3'),
      group('custom:2', 'Docs', ['s2']),
    ])
  })

  it('reloads the shared directory name from the same medium', async () => {
    const { registry, pool } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    await registry.setDirectoryName('custom:1', '2611110036-Release-a1b2c3')

    const reopened = await harness(pool)
    expect(reopened.registry.groupOf(SessionId('s1'))?.dirName).toBe('2611110036-Release-a1b2c3')
  })

  it('rejects a shared directory name for an unknown group', async () => {
    const { registry } = await harness()
    await expect(registry.setDirectoryName('custom:missing', '2611110036-Release-a1b2c3'))
      .rejects.toThrow(/unknown group id/)
  })

  it('stores a board URL and keeps it across browser pushes and renames', async () => {
    const { registry, changes } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    const boardUrl = 'http://10.37.242.122:8765/t/qa-20261111105329-8b272f20'
    const stored = await registry.setBoardUrl('custom:1', boardUrl)
    expect(stored.boardUrl).toBe(boardUrl)
    expect(registry.list()).toEqual([group('custom:1', 'Release', ['s1'], undefined, boardUrl)])
    expect(changes).toHaveLength(2)

    await expect(registry.setBoardUrl('custom:1', boardUrl)).resolves.toEqual(stored)
    expect(changes).toHaveLength(2)

    await expect(registry.replace([group('custom:1', 'Release renamed', ['s1'])]))
      .resolves.toEqual([group('custom:1', 'Release renamed', ['s1'], undefined, boardUrl)])
  })

  it('reloads the board URL from the same medium', async () => {
    const { registry, pool } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    await registry.setBoardUrl('custom:1', 'https://boards.example/qa')

    const reopened = await harness(pool)
    expect(reopened.registry.groupOf(SessionId('s1'))?.boardUrl).toBe('https://boards.example/qa')
  })

  it('rejects a board URL for an unknown group', async () => {
    const { registry } = await harness()
    await expect(registry.setBoardUrl('custom:missing', 'https://boards.example/qa'))
      .rejects.toThrow(/unknown group id/)
  })

  it('rejects stored board URLs that are not absolute http(s)', async () => {
    const { registry } = await harness()
    await registry.replace([group('custom:1', 'Release', ['s1'])])
    for (const boardUrl of ['file:///etc/passwd', 'javascript:alert(1)', '/relative', 'not a url']) {
      await expect(registry.setBoardUrl('custom:1', boardUrl))
        .rejects.toThrow(/absolute http\(s\) URL/)
    }
    expect(registry.list()).toEqual([group('custom:1', 'Release', ['s1'])])
  })

  it('rejects a stored document whose board URL is not absolute http(s)', () => {
    expect(agentGroupsDomainState.safeParse({
      groups: [group('custom:1', 'Release', ['s1'], undefined, 'ftp://boards.example/qa')],
    }).success).toBe(false)
  })

  it('rejects stored directory names that are not one path segment', () => {
    expect(agentGroupsDomainState.safeParse({
      groups: [group('custom:1', 'Release', ['s1'], '../escape')],
    }).success).toBe(false)
  })

  it('refuses reads before the durable document is opened', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const registry = new AgentGroupRegistry(ctx)
    expect(() => registry.list()).toThrow(/not initialized/)
  })
})
