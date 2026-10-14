/**
 * Session share links: a frontend presentation gate paired with the host
 * secret-path gate. A share link carries one session id in the `share` query
 * param (`?share=<id>`). Unlike a URL hash, the query reaches the server, so
 * the host gate can let a share link through its secret-path knock while the
 * bare root stays closed — the recipient opens only that one session's view and
 * never the session list. The client reads the same param to pin its view and
 * hide every surface that lists or starts other sessions.
 */

/** Query parameter carrying the shared session id. */
const SHARE_PARAM = 'share'

/**
 * The shared session id named by the current URL, or undefined when the page
 * was not opened from a share link. Reads the `?share=` query param; also
 * accepts a legacy `#share=` hash so links copied before the query form still
 * pin the view.
 * @returns the raw session id string, or undefined.
 */
export function shareSessionId(): string | undefined {
  const fromQuery = new URL(window.location.href).searchParams.get(SHARE_PARAM)
  if (fromQuery !== null && fromQuery !== '') return fromQuery
  const hash = window.location.hash
  const legacyPrefix = '#share='
  if (hash.startsWith(legacyPrefix)) {
    const id = decodeURIComponent(hash.slice(legacyPrefix.length))
    if (id !== '') return id
  }
  return undefined
}

/**
 * The absolute share link for a session: this page's origin and path with the
 * session id in the `?share=` query param. The query form is required so the
 * host secret-path gate sees it and admits the recipient; a hash would never
 * reach the server.
 * @param sessionId - the session to share.
 * @returns the share URL.
 */
export function shareLinkFor(sessionId: string): string {
  const url = new URL(window.location.href)
  url.hash = ''
  url.searchParams.set(SHARE_PARAM, sessionId)
  return url.href
}
