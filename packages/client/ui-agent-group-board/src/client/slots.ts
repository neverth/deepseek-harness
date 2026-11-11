/**
 * The board rail's injected face. The target `conversation.left-rail` slot is
 * declared and typed by ui-conversation; this package only contributes the
 * entry, so no SlotMap merge lives here.
 */

import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Injected business face of the board rail. */
export interface AgentGroupBoardInjected {
  /**
   * Read the Host's current hand-made group document.
   * @returns the stored groups, including each group's board URL when set.
   */
  loadGroups: () => Promise<readonly AgentGroupView[]>
}
