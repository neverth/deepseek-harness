/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  computeColumns, MOBILE_DRAWER, MOBILE_MAX, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  // Every navigable session, not just the non-blank one the details column
  // tracks: the mobile drawer must also close when the user picks a blank one.
  const currentSession = useSessions(s => s.current)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  // Soft keyboard (mobile): the layout viewport keeps its full height while the
  // *visual* viewport shrinks and pans, so the app's own box stays taller than
  // the part of the screen the user can see. Everything bottom-anchored then
  // sits below the keys, and iOS starts panning to drag the focused editor back
  // into view — a pan that fires again on every height change, which is what
  // made the composer sink on a deleted line and snap back a frame later.
  //
  // The frame is therefore glued to the visual viewport in the mobile regime
  // (AppFrame.module.css consumes both properties): its top follows the pan and
  // its height follows the shrink, so the layout box *is* the visible box. Any
  // floor inside it is above the keys as ordinary layout, with no per-component
  // keyboard arithmetic, and the focused editor is never out of view, so iOS has
  // nothing left to pan toward and the oscillation stops at the source.
  //
  // `interactive-widget=resizes-content` in the shell would have the engine do
  // this; no WebKit release implements it (iOS Safari 26 and 27 included), so
  // the measurement is the load-bearing path on the phones this ships to.
  //
  // Both numbers come from `visualViewport`, never `window.innerHeight`: iOS 26
  // made innerHeight track the *visual* viewport, so the difference the previous
  // measurement relied on is identically zero there and its published inset
  // never left 0 no matter how much screen the keys took (measured with the
  // keyboard up: innerHeight 253, documentElement.clientHeight 714, visual
  // height 253, offsetTop 461).
  //
  // The measurements ride CSS custom properties rather than React state: the
  // keyboard moves the visual viewport during typing, scrolling, and the
  // editor's own growth, and re-rendering the whole frame on each of those
  // stutters. The properties update in place, so only the rules that read them
  // reflow.
  //
  // `scroll` matters as much as `resize`: iOS pans the visual viewport without
  // resizing it whenever the focused box changes height, and the frame has to
  // follow that pan to stay on the visible region.
  useEffect(() => {
    const vv = window.visualViewport
    if (vv === null || vv === undefined) return
    const root = document.documentElement
    let raf: number | null = null
    const update = (): void => {
      raf = null
      const frame = frameRef.current
      if (frame !== null && frame.getBoundingClientRect().width <= MOBILE_MAX) {
        root.style.setProperty('--dsh-visual-viewport-height', `${String(Math.round(vv.height))}px`)
        root.style.setProperty('--dsh-visual-viewport-top', `${String(Math.round(vv.offsetTop))}px`)
        return
      }
      root.style.removeProperty('--dsh-visual-viewport-height')
      root.style.removeProperty('--dsh-visual-viewport-top')
    }
    const schedule = (): void => {
      if (raf !== null) return
      raf = requestAnimationFrame(update)
    }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf !== null) cancelAnimationFrame(raf)
      root.style.removeProperty('--dsh-visual-viewport-height')
      root.style.removeProperty('--dsh-visual-viewport-top')
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  // Mobile regime: the sidebar leaves the grid and rides above the
  // conversation as an overlay drawer (same narrowExpanded toggle), the
  // details column stays closed, and the center column owns the full width.
  const mobile = viewport <= MOBILE_MAX
  const drawerOpen = mobile && panels.narrowExpanded
  const drawerWidth = Math.min(MOBILE_DRAWER, Math.max(0, viewport - 56))
  // The drawer covers the conversation, so navigating to a session inside it
  // must reveal that session: close on every actual session change.
  const lastDrawerSession = useRef(currentSession)
  useEffect(() => {
    if (lastDrawerSession.current !== currentSession && drawerOpen) actions.toggleSidebar()
    lastDrawerSession.current = currentSession
  }, [actions, currentSession, drawerOpen])
  const cols = mobile
    ? { sidebar: 0, center: viewport, details: 0 }
    : computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        // The mobile drawer leaves the grid (absolute), so the frame drops to
        // the two tracks that remain in flow: center takes the width and the
        // details column closes.
        gridTemplateColumns: mobile
          ? 'minmax(0, 1fr) 0px'
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
      data-mobile={mobile || undefined}
      data-drawer-open={drawerOpen || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      <div
        className={css.sidebarCol}
        style={mobile ? { width: drawerWidth } : undefined}
      >
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). The mobile drawer always renders the
            expanded column — it slides out of the frame instead of railing. */}
        {renderSlot('sidebar', {
          collapsed: mobile ? false : sidebarCollapsed,
          width: mobile ? drawerWidth : cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* Mobile chrome: the drawer trigger is the only way back to a sidebar
          that has left the frame, and the scrim dismisses it. */}
      {mobile && (
        <button
          type="button"
          className={css.drawerTrigger}
          aria-label={t('nav.sessions')}
          aria-expanded={drawerOpen}
          onClick={() => { actions.toggleSidebar() }}
        >
          {t('nav.sessions')}
        </button>
      )}
      {drawerOpen && (
        <div
          className={css.scrim}
          role="presentation"
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      {/* Visible dismiss affordance riding above the scrim (not inside it:
          the scrim closes on click, so a nested button would double-toggle
          and immediately reopen the drawer). */}
      {drawerOpen && (
        <button
          type="button"
          className={css.drawerClose}
          aria-label={t('nav.closeDrawer')}
          onClick={() => { actions.toggleSidebar() }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed, and
          the mobile regime has no draggable column edges at all. */}
      {!mobile && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!mobile && cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
