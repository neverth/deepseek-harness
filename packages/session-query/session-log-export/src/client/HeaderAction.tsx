import type { ReactNode } from 'react'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'

/**
 * Host the export result dialog in the Session Header.
 *
 * The Header carries no download button in this build: `/export` is the entry
 * point, and this seat exists so the command's result still has somewhere to
 * render. Restoring the button means putting it back beside the dialog here.
 * @param props - Session runtime, download controller, and localized dialog copy.
 * @returns the Session-scoped result dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  return <SessionLogDownloadDialog {...props} />
}
