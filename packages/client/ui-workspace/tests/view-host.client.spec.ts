import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestWorkspaces } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
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
  vi.unstubAllGlobals()
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

  it('does not erase an existing Host document from a browser with no local groups', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', async () => [{ id: 'custom:9', name: 'Host', sessionIds: [] }])
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([])

    // A real edit still replaces the document, including a later clear.
    view.actions.createCustomGroup('Release')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[{ id: 'custom:1', name: 'Release', sessionIds: [] }]])
    dispose()
  })

  it('leaves an existing Host document alone when this browser holds a stale copy', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', async () => [{ id: 'custom:1', name: 'Renamed elsewhere', sessionIds: [] }])
    const view = createWorkspaceViewStore().create()
    view.actions.createCustomGroup('Stale')
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([])

    // An unrelated view change must not write the stale document either.
    view.actions.setGroupExpanded('custom:1', false)
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([])

    // A real edit is this browser's own decision and replaces the document.
    view.actions.renameCustomGroup('custom:1', 'Edited')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[{ id: 'custom:1', name: 'Edited', sessionIds: [] }]])
    dispose()
  })

  it('keeps the opening push quiet when the Host document cannot be read', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', () => Promise.reject(new Error('Host unavailable')))
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(error).toHaveBeenCalledWith(
      '[ui-workspace] reading the Host group document failed:',
      expect.objectContaining({ message: 'Host unavailable' }),
    )
    expect(pushedGroups(workspaces)).toEqual([])
    dispose()
  })

  it('survives a Host group reader that throws synchronously', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', () => { throw new Error('missing method') })
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(error).toHaveBeenCalledWith(
      '[ui-workspace] reading the Host group document failed:',
      expect.objectContaining({ message: 'missing method' }),
    )
    expect(pushedGroups(workspaces)).toEqual([])
    dispose()
  })

  it('adopts Host groups for a group link opened in a browser that holds none', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', async () => [{ id: 'custom:9', name: 'Host', sessionIds: [SessionId('s9')] }])
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view, 'custom:9')
    await flush()
    expect(view.getSnapshot().customGroups).toEqual([{ id: 'custom:9', name: 'Host' }])
    expect(view.getSnapshot().customMembers['custom:9']).toEqual(['s9'])
    expect(view.getSnapshot().groupExpansion['custom:9']).toBe(true)
    expect(pushedGroups(workspaces)).toEqual([])
    dispose()
  })

  it('keeps a local group whose id the Host document also names', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', async () => [{ id: 'custom:1', name: 'Host', sessionIds: [SessionId('s9')] }])
    const view = createWorkspaceViewStore().create()
    view.actions.createCustomGroup('Local')
    const dispose = mirrorViewSnapshots(workspaces, view, 'custom:2')
    await flush()
    expect(view.getSnapshot().customGroups).toEqual([{ id: 'custom:1', name: 'Local' }])
    expect(view.getSnapshot().customMembers['custom:1']).toEqual([])
    expect(pushedGroups(workspaces)).toEqual([])
    dispose()
  })

  it('adds Host members the launched group predates', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('listGroups', async () => [
      { id: 'custom:9', name: 'Host', sessionIds: [SessionId('s1'), SessionId('s2')] },
      { id: 'custom:10', name: 'Other', sessionIds: [SessionId('s3')] },
    ])
    const view = createWorkspaceViewStore().create()
    view.actions.createCustomGroup('Local')
    view.actions.moveCustomMember('s4', 'custom:1')
    view.actions.adoptHostGroups([{ id: 'custom:9', name: 'Host', sessionIds: ['s1'] }])
    const dispose = mirrorViewSnapshots(workspaces, view, 'custom:9')
    await flush()
    // The launched group takes the Host's later member; the local group and the
    // other Host group keep their own memberships.
    expect(view.getSnapshot().customMembers['custom:9']).toEqual(['s1', 's2'])
    expect(view.getSnapshot().customMembers['custom:1']).toEqual(['s4'])
    expect(view.getSnapshot().customMembers['custom:10']).toEqual(['s3'])
    expect(pushedGroups(workspaces)).toEqual([])
    dispose()
  })

  it('skips a debounced push whose document matches the stored one again', async () => {
    vi.useFakeTimers()
    const workspaces = new TestWorkspaces(stabilize)
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[]])

    // Create and remove within one quiet period: the timer still fires, but the
    // document it would push already matches the Host.
    view.actions.createCustomGroup('Release')
    view.actions.deleteCustomGroup('custom:1')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[]])
    dispose()
  })

  it('pushes a persisted group whose members entry is missing as empty membership', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({
        groupBy: 'workspace',
        orderBy: 'updated',
        groupExpansion: {},
        sessionOrderByAccount: {},
        customGroups: [{ id: 'custom:9', name: 'Host' }],
        customMembers: {},
        customGroupSeq: 9,
        archivedFilter: 'default',
      }),
      setItem: () => {},
      removeItem: () => {},
    })
    const workspaces = new TestWorkspaces(stabilize)
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    expect(pushedGroups(workspaces)).toEqual([[{ id: 'custom:9', name: 'Host', sessionIds: [] }]])
    dispose()
  })

  it('reports a refused view snapshot and keeps mirroring', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const workspaces = new TestWorkspaces(stabilize)
    workspaces.stub('saveViewSnapshot', () => Promise.reject(new Error('Host unavailable')))
    const view = createWorkspaceViewStore().create()
    const dispose = mirrorViewSnapshots(workspaces, view)
    await flush()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flush()
    expect(error).toHaveBeenCalledWith(
      '[ui-workspace] saving the Host view snapshot failed:',
      expect.objectContaining({ message: 'Host unavailable' }),
    )
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

  it('reports a refused push and retries it on the next edit, not on a timer', async () => {
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
    expect(pushedGroups(workspaces)).toHaveLength(1)

    view.actions.renameCustomGroup('custom:1', 'Release 2')
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(2)

    // The snapshot interval never re-pushes a group document on its own.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flush()
    expect(pushedGroups(workspaces)).toHaveLength(2)
    dispose()
  })
})
