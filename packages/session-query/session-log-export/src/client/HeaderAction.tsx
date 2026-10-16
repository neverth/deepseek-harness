import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button, IconCopyOutlineRegular, IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/** Session download controls with observable feedback availability and a Session feedback action. */
export interface SessionLogDownloadHeaderInjected extends SessionLogDownloadDialogInjected {
  hooks: SessionLogDownloadDialogInjected['hooks'] & { feedbackAvailable: ObservableSnapshot<boolean> }
  /**
   * Open the existing Session feedback draft without recording feedback; no-op after the feedback plugin unloads.
   * @param sessionId - Session whose feedback form to open.
   */
  openFeedback: (sessionId: SessionId) => void
}

/** How long the menu's copy row shows its confirmation after an accepted write. */
const COPIED_FEEDBACK_MS = 1000

/** Session download props plus the optional feedback action. */
export type SessionLogDownloadHeaderProps = SessionLogDownloadDialogProps & InjectFace<SessionLogDownloadHeaderInjected>

/**
 * Host the export result dialog in the Session Header, plus the more-actions menu.
 *
 * This build has no Header download control: `/export` is the entry point, and this seat
 * still renders the command's result dialog. The more-actions menu always shows, because
 * copying the Session ID needs nothing loaded; the feedback row joins it only while that
 * plugin is loaded.
 * @param props - Session runtime, download controller, feedback action, and localized copy.
 * @returns the more-actions menu and the Session-scoped result dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadHeaderProps): ReactNode {
  const { sessionId, useFeedbackAvailable, openFeedback, t } = props
  const feedbackAvailable = useFeedbackAvailable(value => value)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // A refused write (denied permission, iframe policy) shows no confirmation:
  // the row keeps its copy label and the menu stays open to retry.
  const copySessionId = (): void => {
    if (copied) return
    void writeClipboard(sessionId).then((accepted) => {
      if (!accepted) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }

  return (
    <>
      <Menu
        open={open}
        align="end"
        dense
        onClose={() => { setOpen(false) }}
        items={[
          ...feedbackAvailable
            ? [{ id: 'feedback', label: t('menu.feedback'), icon: <IconPaperPlaneOutlineRegular /> }]
            : [],
          {
            id: 'copy-session-id',
            label: copied ? t('menu.copySessionId.copied') : t('menu.copySessionId'),
            icon: <IconCopyOutlineRegular />,
          },
        ]}
        onSelect={(id) => {
          if (id !== 'feedback') {
            // A copy leaves the menu up, so its row can confirm the accepted write.
            copySessionId()
            return
          }
          setOpen(false)
          openFeedback(sessionId)
        }}
        anchor={(
          <Button
            size="sm"
            className={css.moreButton}
            aria-label={t('header.more')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutlineRegular />
          </Button>
        )}
      />
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
