/**
 * Session-header chip showing the Session's working directory beside its title.
 * The path is abbreviated against the Host account home — the same treatment the
 * sidebar hover card and the reference picker give a directory — and reads at
 * the header's own action-chip type. A Session with no directory yet (a blank
 * draft before its first Workspace) renders nothing.
 */
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
// Type-only: pulls the conversation header's slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './WorkingDirectory.module.css'

/** Registration-side face: the Host facts the path is abbreviated against. */
export interface WorkingDirectoryInjected {
  hooks: {
    /** Host account facts, bound by the renderer as useHostInfo. */
    hostInfo: HostObservable<RemoteHostFacts>
  }
}

/** Full props for the session-header working-directory chip. */
export type WorkingDirectoryProps =
  PropsRuntime<'conversation.session.header.actions'> & InjectFace<WorkingDirectoryInjected>

/**
 * @param props - Session identity, the Session list hook, and the Host-facts hook.
 * @returns the directory chip, or null while the Session has no directory.
 */
export function WorkingDirectory({ sessionId, useSessions, useHostInfo }: WorkingDirectoryProps) {
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const home = useHostInfo(facts => facts.home)
  if (cwd === undefined || cwd === '') return null
  // The chip truncates a long path; the bubble keeps the whole one readable.
  return (
    <Tooltip label={cwd}>
      <span className={css.cwd}>{abbreviateHomePath(cwd, home)}</span>
    </Tooltip>
  )
}
