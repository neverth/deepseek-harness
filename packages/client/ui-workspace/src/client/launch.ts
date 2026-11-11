/**
 * Page-URL launch options for a group-focused sidebar. `group` names one
 * hand-made group and `template` selects the UI template that group renders
 * under. Both are read once when the client boots: the page keeps its URL, so
 * a refresh or a session switch re-enters the same view.
 * @module
 */

/** UI templates a group launch may select. */
export type WorkspaceLaunchTemplate = 'modellaunch'

/** Fixed launch options for this page. */
export interface WorkspaceLaunch {
  /** Hand-made group named by `group=`; absent on ordinary pages. */
  readonly groupId: string | undefined
  /** Template named by `template=`, meaningful only together with a group. */
  readonly template: WorkspaceLaunchTemplate | undefined
}

/** Launch options of an ordinary page. */
export const NO_WORKSPACE_LAUNCH: WorkspaceLaunch = { groupId: undefined, template: undefined }

/** Recognized template names; any other value leaves the page untemplated. */
const TEMPLATES: readonly WorkspaceLaunchTemplate[] = ['modellaunch']

/**
 * Read the launch options from a query string.
 * @param search - `location.search`, with or without its leading `?`.
 * @returns the named group and its recognized template; a template without a group is ignored.
 */
export function readWorkspaceLaunch(search: string): WorkspaceLaunch {
  const params = new URLSearchParams(search)
  const groupId = params.get('group')?.trim()
  if (groupId === undefined || groupId === '') return NO_WORKSPACE_LAUNCH
  const requested = params.get('template')
  const template = TEMPLATES.find(candidate => candidate === requested)
  return { groupId, template }
}
