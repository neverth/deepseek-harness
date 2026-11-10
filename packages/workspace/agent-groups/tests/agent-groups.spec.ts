import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import AgentGroupRegistry from '../src/index.ts'
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

function group(id: string, name: string, sessionIds: string[]): AgentGroupRecord {
  return { id, name, sessionIds: sessionIds.map(SessionId) }
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
})
