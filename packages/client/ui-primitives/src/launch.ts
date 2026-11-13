/**
 * Page-URL launch options shared by the client surfaces a group link drives.
 * A page may carry `group=<hand-made group id>`, `template=modellaunch`, or
 * both; the values stay fixed for the page's lifetime.
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
 * @returns the named group and its recognized template; either may stand alone.
 */
export function readWorkspaceLaunch(search: string): WorkspaceLaunch {
  const params = new URLSearchParams(search)
  const groupId = params.get('group')?.trim()
  const requested = params.get('template')
  const template = TEMPLATES.find(candidate => candidate === requested)
  if ((groupId === undefined || groupId === '') && template === undefined) return NO_WORKSPACE_LAUNCH
  return {
    groupId: groupId === undefined || groupId === '' ? undefined : groupId,
    template,
  }
}

/**
 * Whether the page URL selects the model-launch template.
 * @param search - `location.search`, with or without its leading `?`.
 * @returns true when a group and `template=modellaunch` are both present.
 */
export function usesModelLaunchTemplate(search: string): boolean {
  return readWorkspaceLaunch(search).template === 'modellaunch'
}
