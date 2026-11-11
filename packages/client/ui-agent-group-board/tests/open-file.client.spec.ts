// @vitest-environment jsdom
/**
 * The board → preview bridge: message validation (source, sandbox origin, type,
 * path, line) and the address construction that keeps a board path out of the
 * raw-URL/raw-address space.
 */

import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  boardFileAddress,
  MAX_BOARD_FILE_LINE,
  MAX_BOARD_FILE_PATH,
  readBoardOpenFile,
} from '../src/client/open-file.ts'

const sid = (value: string): SessionId => value as SessionId
const frameWindow = {} as Window

/** One message event shaped like the browser delivers from the board iframe. */
function message(
  data: unknown,
  options: { origin?: string; source?: MessageEventSource | null } = {},
): MessageEvent {
  return new MessageEvent('message', {
    data,
    origin: options.origin ?? 'null',
    source: options.source === undefined ? frameWindow : options.source,
  })
}

const valid = { type: 'dsh:open-file', path: '.tmp/qa-run/report/qa-report.md' }

describe('readBoardOpenFile', () => {
  it('accepts the target window, sandbox origin, type, path, and line', () => {
    expect(readBoardOpenFile(message(valid), frameWindow)).toEqual({ path: valid.path })
    expect(readBoardOpenFile(message({ ...valid, line: 24 }), frameWindow))
      .toEqual({ path: valid.path, line: 24 })
    expect(readBoardOpenFile(message({ ...valid, line: 1 }), frameWindow)?.line).toBe(1)
    expect(readBoardOpenFile(message({ ...valid, line: MAX_BOARD_FILE_LINE }), frameWindow)?.line)
      .toBe(MAX_BOARD_FILE_LINE)
    expect(readBoardOpenFile(message({ ...valid, extra: 'ignored' }), frameWindow))
      .toEqual({ path: valid.path })
  })

  it('rejects a message from another window', () => {
    expect(readBoardOpenFile(message(valid, { source: {} as Window }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message(valid), null)).toBeUndefined()
  })

  it('rejects a real origin, including the app origin after frame navigation', () => {
    expect(readBoardOpenFile(message(valid, { origin: 'http://10.37.242.122:3080' }), frameWindow))
      .toBeUndefined()
    expect(readBoardOpenFile(message(valid, { origin: '' }), frameWindow)).toBeUndefined()
  })

  it('rejects an unknown type and non-object payloads', () => {
    expect(readBoardOpenFile(message({ ...valid, type: 'dsh:open-url' }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message({ path: valid.path }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message(null), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message('dsh:open-file'), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message([valid]), frameWindow)).toBeUndefined()
  })

  it('rejects a missing, empty, non-string, or overlong path', () => {
    expect(readBoardOpenFile(message({ type: 'dsh:open-file' }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message({ ...valid, path: '' }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message({ ...valid, path: 42 }), frameWindow)).toBeUndefined()
    expect(readBoardOpenFile(message({ ...valid, path: 'x'.repeat(MAX_BOARD_FILE_PATH + 1) }), frameWindow))
      .toBeUndefined()
    expect(readBoardOpenFile(message({ ...valid, path: 'x'.repeat(MAX_BOARD_FILE_PATH) }), frameWindow))
      .toEqual({ path: 'x'.repeat(MAX_BOARD_FILE_PATH) })
  })

  it('rejects a line outside the positive integer range', () => {
    for (const line of [0, -1, 1.5, MAX_BOARD_FILE_LINE + 1, '3', null]) {
      expect(readBoardOpenFile(message({ ...valid, line }), frameWindow)).toBeUndefined()
    }
  })
})

describe('boardFileAddress', () => {
  it('resolves a workspace-relative path from the live working directory', () => {
    expect(boardFileAddress(sid('session-root'), '/data/ws', '/data/ws/.tmp/qa-run', 'report/qa-report.md'))
      .toBe('dsh-resource://file/session/session-root/.tmp/qa-run/report/qa-report.md')
  })

  it('scopes an absolute path inside the workspace to the Session', () => {
    expect(boardFileAddress(sid('session-root'), '/data/ws', undefined, '/data/ws/docs/a b.md'))
      .toBe('dsh-resource://file/session/session-root/docs/a%20b.md')
  })

  it('never turns a board path into a raw URL or an absolute-scope address', () => {
    const relative = boardFileAddress(sid('session-root'), '/data/ws', '/data/ws', 'https://evil.example/x')
    expect(relative.startsWith('dsh-resource://file/session/session-root/')).toBe(true)
    expect(relative.startsWith('https://')).toBe(false)
    expect(relative).not.toContain('://file/absolute/')
  })
})
