/**
 * Shared temporary directory for one hand-made sidebar group inside the
 * Workspace that owns the calling Session. Every Session of a group in the
 * same Workspace sees `<workspace>/.tmp/<dirName>`, and the model is told the
 * absolute path as runtime context before each prompt assembly.
 * @module @deepseek-ai/dsh-agent-group-workspace
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls AssembleContext.agent from the Agent runtime declaration.
import type {} from '@deepseek-ai/dsh-agent'
import type { AgentGroupRecord } from '@deepseek-ai/dsh-agent-groups'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the ctx.systemPrompt service declaration.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** Cordis plugin name. */
export const name = 'agent-group-workspace'

/** Group membership, the owning Workspace registry, and prompt assembly. */
export const inject = ['agentGroups', 'workspaceRegistry', 'systemPrompt']

/** Workspace-root directory holding every group's shared temporary directory. */
const TEMP_ROOT = '.tmp'

/** Ignore file written inside {@link TEMP_ROOT} so shared files stay untracked. */
const GITIGNORE_CONTENT = '*\n'

/** Runtime-context name reported in prompt assemblies. */
const CONTEXT_NAME = 'agent-groups:temp'

/** Longest group-name fragment kept in a generated directory name. */
const NAME_LIMIT = 40

/** Characters a generated directory name must not contain. */
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\:*?"<>|]/g

/** One Session's shared group directory resolved inside its owning Workspace. */
interface GroupDirectory {
  /** Group whose Sessions share this directory. */
  readonly group: AgentGroupRecord
  /** Absolute root of the Workspace that owns the calling Session. */
  readonly workspacePath: string
  /** Stable name below `.tmp`, fixed when assigned. */
  readonly directoryName: string
  /** Absolute shared directory path. */
  readonly path: string
}

/**
 * Format one `YYMMDDHHmm` local-time stamp for a generated directory name.
 * @param now - instant to format.
 * @returns the ten-digit stamp.
 */
function timestamp(now: Date): string {
  return [now.getFullYear() % 100, now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
    .map(part => String(part).padStart(2, '0'))
    .join('')
}

/**
 * Reduce a group name to one readable path segment, keeping non-ASCII letters.
 * @param name - user-visible group name.
 * @returns a non-empty name fragment without separators or reserved characters.
 */
function sanitizeName(name: string): string {
  const cleaned = name
    .replace(UNSAFE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, NAME_LIMIT)
    .replace(/[-.]$/, '')
  return cleaned.length === 0 ? 'group' : cleaned
}

/**
 * Own the shared temporary directories of one Host: assign each group's
 * durable directory name on first use, create the directory inside the
 * calling Session's Workspace, and state the absolute path to the model.
 * Sessions in the same group and Workspace share one directory; one group
 * spanning several Workspaces keeps one directory per Workspace.
 */
class SharedGroupDirectories {
  private readonly gitignored = new Set<string>()
  private assignments: Promise<unknown> = Promise.resolve()

  /** @param ctx - Host context carrying group, Workspace, and prompt services. */
  constructor(private readonly ctx: Context) {}

  /**
   * Read the shared directory without filesystem I/O.
   * @param sessionId - Session whose group directory is requested.
   * @returns the resolved directory, or `undefined` when the Session is
   * ungrouped, its name is not yet assigned, or no Workspace owns it.
   */
  resolve(sessionId: SessionId): GroupDirectory | undefined {
    const group = this.ctx.agentGroups.groupOf(sessionId)
    const directoryName = group?.dirName
    if (group === undefined || directoryName === undefined) return undefined
    const workspace = this.workspaceOf(sessionId)
    return workspace === undefined ? undefined : this.directory(group, workspace, directoryName)
  }

  /**
   * Resolve, name, and create the shared directory for one Session.
   * @param sessionId - Session whose group directory is required.
   * @param signal - cancellation for the naming write and directory creation.
   * @returns the created directory, or `undefined` when the Session is
   * ungrouped, no Workspace owns it, or the directory cannot be created.
   */
  async ensure(sessionId: SessionId, signal?: AbortSignal): Promise<GroupDirectory | undefined> {
    const group = this.ctx.agentGroups.groupOf(sessionId)
    if (group === undefined) return undefined
    const workspace = this.workspaceOf(sessionId)
    if (workspace === undefined) return undefined
    let directoryName = group.dirName
    if (directoryName === undefined) {
      try {
        directoryName = await this.assignDirectoryName(group)
      } catch (error) {
        this.ctx.logger.warn(`agent-group-workspace: cannot name the directory of group '${group.id}': ${String(error)}`)
        return undefined
      }
      if (directoryName === undefined) return undefined
    }
    const directory = this.directory(group, workspace, directoryName)
    signal?.throwIfAborted()
    try {
      await mkdir(directory.path, { recursive: true })
    } catch (error) {
      this.ctx.logger.warn(`agent-group-workspace: cannot create ${JSON.stringify(directory.path)}: ${String(error)}`)
      return undefined
    }
    await this.ensureGitignore(workspace.path)
    return directory
  }

  private workspaceOf(sessionId: SessionId): Workspace | undefined {
    return this.ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))
  }

  private directory(group: AgentGroupRecord, workspace: Workspace, directoryName: string): GroupDirectory {
    return {
      group,
      workspacePath: workspace.path,
      directoryName,
      path: join(workspace.path, TEMP_ROOT, directoryName),
    }
  }

  private assignDirectoryName(group: AgentGroupRecord): Promise<string | undefined> {
    const task = this.assignments.then(async () => {
      const current = this.ctx.agentGroups.list().find(candidate => candidate.id === group.id)
      if (current === undefined) return undefined
      if (current.dirName !== undefined) return current.dirName
      const stored = await this.ctx.agentGroups.setDirectoryName(current.id, this.newDirectoryName(current))
      return stored.dirName
    })
    this.assignments = task.then(() => {}, () => {})
    return task
  }

  private newDirectoryName(group: AgentGroupRecord): string {
    // The group id is unique, so its digest keeps two same-named groups in the
    // same minute apart without a registry scan; the name stays readable.
    const suffix = createHash('sha256').update(group.id).digest('hex').slice(0, 6)
    return `${timestamp(new Date())}-${sanitizeName(group.name)}-${suffix}`
  }

  private async ensureGitignore(workspacePath: string): Promise<void> {
    const file = join(workspacePath, TEMP_ROOT, '.gitignore')
    if (this.gitignored.has(file)) return
    try {
      await writeFile(file, GITIGNORE_CONTENT)
      this.gitignored.add(file)
    } catch (error) {
      this.ctx.logger.warn(`agent-group-workspace: cannot write ${JSON.stringify(file)}: ${String(error)}`)
    }
  }

  /**
   * The model-facing line for one created directory.
   * @param directory - directory the calling Session shares with its group.
   * @returns the runtime-context sentence stating the absolute path.
   */
  text(directory: GroupDirectory): string {
    return `Shared temporary workspace for this session's custom group ${JSON.stringify(directory.group.name)}: `
      + `${JSON.stringify(directory.path)}. Sessions in the same group share this directory; `
      + 'put temporary files, notes, and intermediate outputs there.'
  }
}

/**
 * Register the shared-directory runtime context and create each Session's
 * directory before every prompt assembly.
 * @param ctx - context carrying group, Workspace, and prompt services.
 */
export function apply(ctx: Context): void {
  const directories = new SharedGroupDirectories(ctx)
  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: ctx.systemPrompt.getContextOrder('AGENT_GROUPS_TEMP'),
    interpolate: false,
    text: (context) => {
      const session = context.agent?.session
      if (session === undefined) return ''
      const directory = directories.resolve(session.id)
      return directory === undefined ? '' : directories.text(directory)
    },
  })
  // Assembly asks the synchronous text provider above before the directory
  // necessarily exists, so the first turn of a group assigns the name,
  // creates the directory, and then states the path in the same assembly.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const session = context.agent?.session
    const directory = session === undefined ? undefined : await directories.ensure(session.id, context.signal)
    const assembly = await next()
    // The text provider ran before this listener created the directory; an
    // empty text removes a stale path, and an absent contribution means the
    // persona suppressed optional runtime context.
    const contribution = assembly.contexts.find(entry => entry.name === CONTEXT_NAME)
    if (contribution !== undefined) {
      contribution.text = directory === undefined ? '' : directories.text(directory)
      contribution.interpolate = false
    }
    return assembly
  }, { prepend: true })
}
