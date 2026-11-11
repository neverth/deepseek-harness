/**
 * The board → native-preview bridge. A board page runs inside the Host-proxied
 * iframe under a `sandbox` CSP, so it has no access to the client commands or
 * Session identity. It asks the parent instead by posting one message:
 * `{ type: 'dsh:open-file', path, line? }`.
 *
 * Security boundary:
 * - Only the board iframe's own `contentWindow` may send; `event.source` is
 *   compared with that window.
 * - The Host sandbox gives the document an opaque origin, so the browser
 *   reports `event.origin` as `'null'`. A page navigated inside the same frame
 *   (a normal upstream page with a real origin) is therefore rejected.
 * - The message carries a file path only. It is never treated as a URL, a
 *   command, or a `dsh-resource://` address: `resolveWorkspacePath` and
 *   `fileAddressFor` build the address from the receiving Session's workspace.
 * - No other message type or capability is exposed here.
 * @module @deepseek-ai/dsh-client-ui-agent-group-board/client/open-file
 */

import { fileAddressFor, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Message type the board page posts to open one workspace file. */
export const BOARD_OPEN_FILE_TYPE = 'dsh:open-file'
/** Longest accepted path; a longer string is not a workspace path. */
export const MAX_BOARD_FILE_PATH = 4096
/** Highest accepted 1-based line anchor. */
export const MAX_BOARD_FILE_LINE = 1_000_000

/** One validated request to open a file in the native preview. */
export interface BoardOpenFileRequest {
  /** Workspace-relative or absolute file path. */
  readonly path: string
  /** Optional 1-based line to reveal after opening. */
  readonly line?: number
}

/**
 * Validate one `message` event from the board iframe.
 * @param event - the browser message event.
 * @param source - the board iframe's `contentWindow`, when it is mounted.
 * @returns the file request, or undefined for every rejected message.
 */
export function readBoardOpenFile(
  event: MessageEvent,
  source: Window | null,
): BoardOpenFileRequest | undefined {
  if (source === null || event.source !== source) return undefined
  // The Host serves the board under `sandbox` without `allow-same-origin`, so
  // the sending document has an opaque origin. A real origin here means the
  // frame navigated away from the proxied board page.
  if (event.origin !== 'null') return undefined
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  if (record.type !== BOARD_OPEN_FILE_TYPE) return undefined
  const path = record.path
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_BOARD_FILE_PATH) return undefined
  const line = record.line
  if (line !== undefined && (typeof line !== 'number'
    || !Number.isInteger(line) || line < 1 || line > MAX_BOARD_FILE_LINE)) return undefined
  return line === undefined ? { path } : { path, line }
}

/**
 * Address one board file through the receiving Session, never as a raw URL.
 * The relative path resolves from the Session's live working directory, then
 * the file address helper scopes it to the Session workspace.
 * @param sessionId - the Session whose workspace resolves the path.
 * @param cwd - the Session workspace root when known.
 * @param current - the Session's live working directory when known.
 * @param path - workspace-relative or absolute file path from the board.
 * @returns the `dsh-resource://file/session/<id>/<path>` address.
 */
export function boardFileAddress(
  sessionId: SessionId,
  cwd: string | undefined,
  current: string | undefined,
  path: string,
): string {
  return fileAddressFor(sessionId, cwd, resolveWorkspacePath(current, path))
}
