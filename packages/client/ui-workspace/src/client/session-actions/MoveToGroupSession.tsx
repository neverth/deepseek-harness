/**
 * The move-to-group action: a `sidebar.workspaces.session.menu.item` row that
 * raises the picker request, and the `shell.overlay` dialog entry that answers
 * it. Membership is browser-local, so the dialog's choice writes the viewing
 * store rather than a Host call — the one row action whose effect no other
 * client can observe. The dialog lives outside the row menu because the row
 * unmounts with the menu.
 */
import { IconFolderCloseRegular, IconFolderOpenRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type {
  GroupPickerProps, MoveToGroupInjected, SessionMenuItemProps,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 250): raise the picker for this Session. Absent until a
 * group exists — the row would open a dialog with nothing to choose.
 * @param props - owner share, menu open state, the group list, and the request hop.
 * @returns the row, or null while no group exists.
 */
export function MoveToGroupMenuItem({
  sessionId, displayTitle, useMenuOpenState, useCustomGroups, requestMoveToGroup, t,
}: SessionMenuItemProps<MoveToGroupInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  const groups = useCustomGroups(options => options)
  if (groups.length === 0) return null
  return (
    <MenuItemButton
      icon={<IconFolderCloseRegular />}
      onSelect={() => {
        setMenuOpen(false)
        requestMoveToGroup(sessionId, displayTitle)
      }}
    >
      {t('group.moveTo')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no move is requested, otherwise one
 * dialog per request (keyed by the Session, so a new request starts clean).
 * @param props - the request hook, its settlement, the membership write, and the locale seat.
 * @returns the open dialog, or null.
 */
export function GroupPickerDialog({ useMoveRequest, settleMoveToGroup, moveSessionToGroup, useCustomGroups, t }: GroupPickerProps) {
  const request = useMoveRequest(pending => pending)
  const groups = useCustomGroups(options => options)
  if (request === null) return null
  const current = groups.find(group => group.sessionIds.includes(request.sessionId))
  return (
    <Modal
      open
      onClose={settleMoveToGroup}
      closeLabel={t('close')}
      title={t('group.picker.title')}
      {...request.displayTitle === '' ? {} : { description: request.displayTitle }}
    >
      {groups.length === 0
        ? <div className={css.groupPickerEmpty}>{t('group.picker.empty')}</div>
        : (
          <div className={css.groupPickerList} role="listbox" aria-label={t('group.picker.title')}>
            {groups.map(group => (
              <button
                key={group.id}
                type="button"
                role="option"
                aria-selected={group.id === current?.id}
                className={clsx(css.groupPickerOption, group.id === current?.id && css.groupPickerOptionCurrent)}
                onClick={() => {
                  moveSessionToGroup(request.sessionId, group.id)
                  settleMoveToGroup()
                }}
              >
                {group.id === current?.id ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
                <span className={css.groupPickerName}>{group.name}</span>
              </button>
            ))}
            {current !== undefined && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className={css.groupPickerOption}
                onClick={() => {
                  moveSessionToGroup(request.sessionId, undefined)
                  settleMoveToGroup()
                }}
              >
                <IconFolderCloseRegular />
                <span className={css.groupPickerName}>{t('group.removeFrom')}</span>
              </button>
            )}
          </div>
        )}
    </Modal>
  )
}
