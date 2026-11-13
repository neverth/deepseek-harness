/**
 * Host mirrors of the sidebar view store. The browser keeps working from its
 * own localStorage copy — that copy stays the source of truth for what the
 * user sees — and the Host keeps the newest view snapshots so a lost browser
 * copy stays recoverable. The Host also stores the current hand-made group
 * document, because tools read that mapping to learn which sessions share a
 * group.
 * @module
 */

import type {
  AgentGroupView, IWorkspaces, WorkspaceViewDocument,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceViewInstance } from './stores.ts'

/** How often one browser pushes its current view document to the Host. */
const SNAPSHOT_INTERVAL_MS = 5 * 60_000

/** How long a group edit waits before one push, coalescing a drag's repeated updates. */
const GROUPS_DEBOUNCE_MS = 1_000

/**
 * Push this browser's view document and hand-made groups to the Host.
 * @param workspaces - Client Workspace service carrying the snapshot Remote methods.
 * @param view - the browser's single view-store instance.
 * @param launchGroupId - the group a page URL names; set only for a group link,
 * so an ordinary page keeps its own local view. A launched page also takes the
 * members the Host knows for that group, including Sessions started through the
 * task-launch endpoint after this browser stored its copy.
 * @returns the disposer stopping the timer and subscription; it must run on plugin teardown.
 */
export function mirrorViewSnapshots(
  workspaces: IWorkspaces,
  view: WorkspaceViewInstance,
  launchGroupId?: string,
): () => void {
  let pushedGroups: string | undefined
  let groupTimer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()

  const groupDocument = (): AgentGroupView[] => {
    const state = view.getSnapshot()
    return state.customGroups.map(group => ({
      id: group.id,
      name: group.name,
      sessionIds: (state.customMembers[group.id] ?? []).map(sessionId => SessionId(sessionId)),
    }))
  }

  const pushGroups = (): void => {
    const groups = groupDocument()
    const encoded = JSON.stringify(groups)
    if (encoded === pushedGroups) return
    pending = pending.then(async () => {
      try {
        await workspaces.saveGroups(groups)
        pushedGroups = encoded
      } catch (error) {
        // The Host copy enables model-facing group reads, not rendering: a
        // refused push leaves the browser's own grouping untouched, and the
        // next edit or interval tick tries again.
        console.error('[ui-workspace] saving the Host group document failed:', error)
      }
    })
  }

  // Group edits arrive in bursts (a drag reorders members several times), so
  // one push follows the quiet period instead of each intermediate document.
  const scheduleGroups = (): void => {
    if (JSON.stringify(groupDocument()) === pushedGroups) return
    clearTimeout(groupTimer)
    groupTimer = setTimeout(pushGroups, GROUPS_DEBOUNCE_MS)
  }

  // The Host already holding a document means another browser (or an earlier
  // session of this one) is the current owner. A newly opened tab, a second
  // machine, or a stale copy must not replace it on open, or a rename made in
  // one browser would flip back whenever another one loads. Only a later real
  // edit in this browser writes the document; a Host without groups still
  // seeds from this browser's local copy.
  // The call sits inside an async function so a missing or throwing Remote
  // method rejects this task instead of escaping `apply` synchronously and
  // taking the whole sidebar plugin down with it.
  const seedGroups = async (): Promise<void> => {
    const hostGroups = await workspaces.listGroups()
    if (hostGroups.length > 0) {
      // A group link opened in a browser without this document (another
      // machine, a fresh profile) shows the Host's groups instead of an empty
      // view; groups this browser already holds keep their names and their own
      // memberships, except the launched group, which also takes members the
      // Host learned after this browser saved its copy.
      if (launchGroupId !== undefined) view.actions.adoptHostGroups(hostGroups)
      const launched = launchGroupId === undefined
        ? undefined
        : hostGroups.find(group => group.id === launchGroupId)
      if (launched !== undefined) {
        for (const sessionId of launched.sessionIds) view.actions.moveCustomMember(sessionId, launched.id)
      }
      // Record the local copy as already pushed so unrelated view changes do
      // not schedule a replacement of the Host's document.
      pushedGroups = JSON.stringify(groupDocument())
      return
    }
    pushGroups()
  }
  void seedGroups().catch((error: unknown) => {
    // Without the Host's current document, an opening push could erase it;
    // keep the local copy and let the next real edit replace the document.
    console.error('[ui-workspace] reading the Host group document failed:', error)
    pushedGroups = JSON.stringify(groupDocument())
  })
  const unsubscribe = view.subscribe(scheduleGroups)
  // Group documents are pushed on edits only. A periodic re-push from every
  // open tab would let a stale copy overwrite a rename made in another one.
  const timer = setInterval(() => {
    void saveSnapshot(workspaces, view)
  }, SNAPSHOT_INTERVAL_MS)
  return () => {
    clearInterval(timer)
    clearTimeout(groupTimer)
    unsubscribe()
  }
}

/**
 * Push one snapshot of the current store state.
 * @param workspaces - Client Workspace service carrying the snapshot Remote method.
 * @param view - the browser's single view-store instance.
 * @returns resolution once the Host answered, successfully or not.
 */
async function saveSnapshot(workspaces: IWorkspaces, view: WorkspaceViewInstance): Promise<void> {
  const document: WorkspaceViewDocument = view.getSnapshot()
  try {
    await workspaces.saveViewSnapshot(document)
  } catch (error) {
    // The mirror is a backup, not part of the rendering path: a Host that
    // cannot take this snapshot leaves the user's own copy untouched, and the
    // next tick tries again.
    console.error('[ui-workspace] saving the Host view snapshot failed:', error)
  }
}
