import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestWorkspaces } from '@deepseek-ai/dsh-client-test-runtime'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { mirrorViewSnapshots } from '../src/client/view-host.ts'

const stabilize = async (fn: () => void | Promise<void>): Promise<void> => { await fn() }

/** Let the mirror's queued pushes settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

function pushedGroups(workspaces: TestWorkspaces): unknown[] {
  return workspaces.calls
    .filter(call => call.method === 'saveGroups')
    .map(call => call.args[0])
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('mirrorViewSnapshots', () => {
  it('seeds the Host with the local group document and pushes later edits after the quiet period', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[]])

    view.actions.createCustomGroup('Release')
    view.actions.moveCustomMember('s1', 'custom:1')
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[], [{ id: 'custom:1', name: 'Release', sessionIds: ['s1'] }]])
    dispose()
  })

  it('does not push a document the Host already stored', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(1)

    // Expansion and order edits leave the group document unchanged.
    view.actions.setGroupExpanded('custom:1', false)
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(1)
    dispose()
  })

  it('reports a refused push and retries it on the next interval', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('saveGroups', () => Promise.reject(new Error('Host unavailable')))
    const view = createWorkspaceViewStore().create()
    view.actions.createCustomGroup('Release')
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(error).toHaveBeenCalledWith(
      '[ui-workspace] saving the Host group document failed:',
      expect.objectContaining({ message: 'Host unavailable' }),
    )

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(2)
    dispose()
  })
})
