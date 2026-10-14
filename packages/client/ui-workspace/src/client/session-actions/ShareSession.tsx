/** The share action: one `sidebar.workspaces.session.menu.item` row. */
import { IconShareOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionMenuItemProps, ShareSessionInjected } from '../contract/slots.ts'

/**
 * Menu row (order 500): copy a share link to this session. Opening that link
 * pins the page to this one session and hides every other-session surface.
 * @param props - owner share, menu open state, and the share share.
 * @returns the row.
 */
export function ShareSessionMenuItem({
  sessionId, useMenuOpenState, shareSession, t,
}: SessionMenuItemProps<ShareSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconShareOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        shareSession(sessionId)
      }}
    >
      {t('menu.share')}
    </MenuItemButton>
  )
}
