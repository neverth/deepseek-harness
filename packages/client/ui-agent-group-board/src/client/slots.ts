/**
 * The board rail's injected face. The target `conversation.left-rail` slot is
 * declared and typed by ui-conversation; this package only contributes the
 * entry, so no SlotMap merge lives here.
 */

import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoardOpenFileRequest } from './open-file.ts'

/** Injected business face of the board rail. */
export interface AgentGroupBoardInjected {
  /** Page-URL launch options; a templated home shows no board rail. */
  readonly launch: {
    /** Hand-made group named by `group=`; absent on ordinary pages. */
    readonly groupId: string | undefined
    /** UI template named by `template=`; absent on ordinary pages. */
    readonly template: string | undefined
  }
  /**
   * Read the Host's current hand-made group document.
   * @returns the stored groups, including each group's board URL when set.
   */
  loadGroups: () => Promise<readonly AgentGroupView[]>
  /**
   * Open one board file in the native preview of the Session's right sidebar.
   * The path is resolved through this Session's workspace, never opened as a
   * URL or an arbitrary resource address.
   * @param sessionId - root Session whose workspace owns the file.
   * @param request - validated path and optional line anchor.
   */
  openFile: (sessionId: SessionId, request: BoardOpenFileRequest) => void
}
