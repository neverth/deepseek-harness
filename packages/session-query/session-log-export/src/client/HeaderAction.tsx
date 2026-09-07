import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Session download props plus the optional feedback action. */
export type SessionLogDownloadHeaderProps = SessionLogDownloadDialogProps & InjectFace<SessionLogDownloadHeaderInjected>

/**
 * Host the export result dialog in the Session Header, plus feedback when that plugin is loaded.
 *
 * This build has no Header download control: `/export` is the entry point, and this seat
 * still renders the command's result dialog. The more-actions menu appears only while
 * feedback is available.
 * @param props - Session runtime, download controller, feedback action, and localized copy.
 * @returns the optional feedback menu and the Session-scoped result dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadHeaderProps): ReactNode {
  const { sessionId, useFeedbackAvailable, openFeedback, t } = props
  const feedbackAvailable = useFeedbackAvailable(value => value)
  const [open, setOpen] = useState(false)

  return (
    <>
      {feedbackAvailable && (
        <Menu
          open={open}
          align="end"
          dense
          onClose={() => { setOpen(false) }}
          items={[
            { id: 'feedback', label: t('menu.feedback'), icon: <IconPaperPlaneOutlineRegular /> },
          ]}
          onSelect={() => {
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
      )}
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
