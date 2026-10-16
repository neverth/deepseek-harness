/**
 * Host-held snapshots of the sidebar view document. A browser keeps working
 * from its own localStorage copy; each client periodically pushes the current
 * document here, and the Host retains the newest {@link MAX_VIEW_SNAPSHOTS} so
 * a lost browser copy stays recoverable. The document belongs to the browser
 * store that writes it (`@deepseek-ai/dsh-client-ui-workspace`); the schema
 * here pins the format, and the storage domain materializes the archive under
 * the storage root (`$DSH_HOME/storages`) on the first write.
 * @module @deepseek-ai/dsh-api-workspace-controller/src/view
 */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

/** Snapshots retained per Host; older ones are dropped as changed ones land. */
export const MAX_VIEW_SNAPSHOTS = 20

/** One hand-made group: name plus the browser-local identity it is keyed by. */
const customGroup = z.object({
  /** Browser-local identity, prefixed so it never collides with a Workspace id. */
  id: z.string().min(1),
  name: z.string(),
}).strict()

/** Sidebar view document: the browser's whole persisted viewing state. */
const viewDocument = z.object({
  groupBy: z.enum(['workspace', 'workspace-tree', 'flat', 'custom']),
  orderBy: z.enum(['manual', 'updated']),
  groupExpansion: z.record(z.string(), z.boolean()),
  sessionOrderByAccount: z.record(z.string(), z.array(z.string())),
  customGroups: z.array(customGroup),
  customMembers: z.record(z.string(), z.array(z.string())),
  customGroupSeq: z.number().int().min(0),
  /** Absent in snapshots written before the archived filter existed. */
  archivedFilter: z.enum(['default', 'show', 'only']).optional(),
}).strict()

/** One sidebar view document as stored and carried over the wire. */
export type WorkspaceViewDocument = z.infer<typeof viewDocument>

/** One stored snapshot: the document plus when a client pushed it. */
const viewSnapshot = z.object({
  /** ISO-8601 instant the pushing client stamped. */
  takenAt: z.string(),
  document: viewDocument,
}).strict()

/** One stored snapshot of the sidebar view document. */
export type WorkspaceViewSnapshot = z.infer<typeof viewSnapshot>

/** Global slot of {@link workspaceViewDomain}: the retained snapshots, oldest first. */
const viewArchive = z.object({ snapshots: z.array(viewSnapshot) }).strict()

/** State before the first write; the global stays absent on the medium until then. */
const archiveInitial: z.infer<typeof viewArchive> = { snapshots: [] }

/** Stored sidebar view domain: one global snapshot archive and no tables. */
export const workspaceViewDomain = defineDomain({
  name: 'workspace_view',
  version: 1,
  global: { schema: viewArchive, initial: archiveInitial },
  tables: {},
})

/**
 * Keeps the Host's ring of sidebar view snapshots. Each write stores a
 * document only when it differs from the newest stored one — the archive is a
 * history of changed states, not of pushes — and drops the oldest beyond
 * {@link MAX_VIEW_SNAPSHOTS}.
 */
export class WorkspaceViewStore {
  private pending: Promise<Domain<typeof workspaceViewDomain>> | undefined

  /**
   * @param ctx - Host context carrying the storage facility.
   */
  constructor(private readonly ctx: Context) {
    this.ctx.effect(() => () => {
      const pending = this.pending
      if (pending === undefined) return
      return pending.then(domain => domain.close())
    }, 'workspaceController.viewStoreClose')
    // Open at load so an unreadable or malformed archive fails loudly here
    // instead of silently disabling the backup on first use.
    void this.domain().catch((error: unknown) => {
      this.ctx.logger.error(`workspace view storage unavailable: ${String(error)}`)
    })
  }

  /**
   * Store one snapshot when the document changed, dropping the oldest beyond
   * the retained window.
   * @param document - the pushing client's complete document, validated at this wire boundary.
   * @returns the stored snapshot, or undefined when it repeats the newest stored one.
   */
  async record(document: WorkspaceViewDocument): Promise<WorkspaceViewSnapshot | undefined> {
    const domain = await this.domain()
    const parsed = viewDocument.parse(document)
    const stored = domain.global.get().snapshots
    const newest = stored.at(-1)
    if (newest !== undefined && deepEqualJson(newest.document, parsed)) return undefined
    const snapshot: WorkspaceViewSnapshot = { takenAt: new Date().toISOString(), document: parsed }
    await domain.global.set({ snapshots: [...stored, snapshot].slice(-MAX_VIEW_SNAPSHOTS) })
    return snapshot
  }

  private domain(): Promise<Domain<typeof workspaceViewDomain>> {
    return this.pending ??= this.ctx.storageDomain.open(workspaceViewDomain)
  }
}
