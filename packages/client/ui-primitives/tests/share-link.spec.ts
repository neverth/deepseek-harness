import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLinkFor, shareSessionId } from '../src/share-link.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Session share links', () => {
  it('reports no shared Session outside a browser', () => {
    expect(shareSessionId()).toBeUndefined()
  })

  it('reads the query form before the legacy hash', () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/app?share=query-session#share=hash-session',
        hash: '#share=hash-session',
      },
    })
    expect(shareSessionId()).toBe('query-session')
  })

  it('reads a legacy encoded hash', () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/app#share=legacy%20session',
        hash: '#share=legacy%20session',
      },
    })
    expect(shareSessionId()).toBe('legacy session')
  })

  it('replaces the share query and clears the hash', () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/app?mode=compact#section',
      },
    })
    expect(shareLinkFor('session id')).toBe(
      'https://example.test/app?mode=compact&share=session+id',
    )
  })
})
