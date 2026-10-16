/**
 * Periodic snapshot mirror for the sidebar view store. The browser keeps
 * working from its own localStorage copy — that copy stays the source of
 * truth for what the user sees — and the Host keeps the newest snapshots so a
 * lost browser copy stays recoverable.
 * @module
 */

import type { IWorkspaces, WorkspaceViewDocument } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceViewInstance } from './stores.ts'

/** How often one browser pushes its current view document to the Host. */
const SNAPSHOT_INTERVAL_MS = 5 * 60_000

/**
 * Push this browser's view document to the Host on a timer.
 * @param workspaces - Client Workspace service carrying the snapshot Remote method.
 * @param view - the browser's single view-store instance.
 * @returns the disposer stopping the timer; it must run on plugin teardown.
 */
export function mirrorViewSnapshots(workspaces: IWorkspaces, view: WorkspaceViewInstance): () => void {
  const timer = setInterval(() => {
    void saveSnapshot(workspaces, view)
  }, SNAPSHOT_INTERVAL_MS)
  return () => { clearInterval(timer) }
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
