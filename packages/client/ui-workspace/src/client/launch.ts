/**
 * Workspace launch options re-exported from the shared client primitives, so
 * this package's internal imports keep one local module while every client
 * surface reads the same page-URL contract.
 * @module
 */

export {
  NO_WORKSPACE_LAUNCH, readWorkspaceLaunch,
  type WorkspaceLaunch, type WorkspaceLaunchTemplate,
} from '@deepseek-ai/dsh-client-ui-primitives'
