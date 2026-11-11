import { describe, expect, it } from 'vitest'
import { NO_WORKSPACE_LAUNCH, readWorkspaceLaunch } from '../src/client/launch.ts'

describe('readWorkspaceLaunch', () => {
  it('treats a page without a group as an ordinary launch', () => {
    expect(readWorkspaceLaunch('')).toEqual(NO_WORKSPACE_LAUNCH)
    expect(readWorkspaceLaunch('?token=abc')).toEqual(NO_WORKSPACE_LAUNCH)
  })

  it('reads the named group alone', () => {
    expect(readWorkspaceLaunch('?group=custom:2'))
      .toEqual({ groupId: 'custom:2', template: undefined })
  })

  it('reads a recognized template only together with a group', () => {
    expect(readWorkspaceLaunch('?group=custom:2&template=modellaunch'))
      .toEqual({ groupId: 'custom:2', template: 'modellaunch' })
    expect(readWorkspaceLaunch('?group=custom:2&template=other'))
      .toEqual({ groupId: 'custom:2', template: undefined })
    expect(readWorkspaceLaunch('?template=modellaunch')).toEqual(NO_WORKSPACE_LAUNCH)
  })

  it('ignores an empty group', () => {
    expect(readWorkspaceLaunch('?group=&template=modellaunch')).toEqual(NO_WORKSPACE_LAUNCH)
  })
})
