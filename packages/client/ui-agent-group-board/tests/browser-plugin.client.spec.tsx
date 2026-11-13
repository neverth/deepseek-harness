// @vitest-environment jsdom
/**
 * The browser half on a real cordis Context with a fake Workspace face: the
 * plugin registers one `conversation.left-rail` entry, its injected loader
 * reads the Host group document, and unloading the plugin drops the entry.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AGENT_GROUP_BOARD_NS, apply, inject } from '../src/client/index.ts'
import type { AgentGroupBoardInjected } from '../src/client/slots.ts'
import { apply as nodeApply } from '../src/index.ts'

const sid = (value: string): SessionId => value as SessionId

/** Boot the plugin over fake Workspace, Session, and Sidebar faces and a declared rail slot. */
async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const groups: readonly AgentGroupView[] = [{
    id: 'custom:2',
    name: '模型上线测试-1111',
    sessionIds: [],
    boardUrl: 'http://127.0.0.1:8765/t/qa-1',
  }]
  const listGroups = vi.fn(() => Promise.resolve(groups))
  const openResource = vi.fn()
  ctx.provide('workspaces', { listGroups } as never)
  ctx.provide('uiWorkspace', { launch: { groupId: undefined, template: undefined } } as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: { 'session-root': { cwd: '/data/ws' } } }) },
    binding: () => undefined,
  } as never)
  ctx.provide('sidebarRight', { openResource } as never)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'main.conversation': { kind: 'single', scope: 'session-maybe' } },
  } as never, (() => null) as never)
  ctx.slots.register({
    name: 'main.conversation',
    children: { 'conversation.left-rail': { kind: 'single', scope: 'session-maybe' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx,
    fiber,
    listGroups,
    openResource,
    entry: () => ctx.slots.entries('conversation.left-rail')[0],
  }
}

describe('ui-agent-group-board browser plugin', () => {
  it('registers the rail entry with its locale namespace and Host group loader', async () => {
    const b = await bench()
    const entry = b.entry()
    expect(entry).toBeDefined()
    expect(entry?.locale).toBe(AGENT_GROUP_BOARD_NS)
    const injected = (entry?.inject as (() => AgentGroupBoardInjected) | undefined)?.()
    expect(injected).toBeDefined()
    await expect(injected!.loadGroups()).resolves.toEqual([expect.objectContaining({
      id: 'custom:2',
      boardUrl: 'http://127.0.0.1:8765/t/qa-1',
    })])
    expect(b.listGroups).toHaveBeenCalledOnce()
  })

  it('opens a board path as a Session file address, with the line as a parameter', async () => {
    const b = await bench()
    const injected = (b.entry()?.inject as (() => AgentGroupBoardInjected) | undefined)?.()
    injected!.openFile(sid('session-root'), { path: '.tmp/qa/report.md' })
    expect(b.openResource).toHaveBeenLastCalledWith(
      'dsh-resource://file/session/session-root/.tmp/qa/report.md',
    )
    injected!.openFile(sid('session-root'), { path: '.tmp/qa/report.md', line: 24 })
    expect(b.openResource).toHaveBeenLastCalledWith(
      'dsh-resource://file/session/session-root/.tmp/qa/report.md',
      { params: { line: 24 } },
    )
  })

  it('drops the entry when the plugin fiber unloads', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
  })
})

describe('ui-agent-group-board node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
