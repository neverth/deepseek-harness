/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from that solve, and the session-aware
 * occupants render in fixed column positions; the strict right-column entry
 * gates itself on current-session availability while the session-maybe
 * conversation retains identity.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  computeColumns, MOBILE_DRAWER, MOBILE_MAX, RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'rightbar' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol} data-rightbar-col>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
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
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = panels.viewportWidth
  // Every navigable session, not just a non-blank one: the mobile drawer must
  // also close when the user picks a blank session from inside it.
  const currentSession = useSessions(s => s.current)

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

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
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  // Mobile regime: the sidebar leaves the grid and rides above the
  // conversation as an overlay drawer (same narrowExpanded toggle), the right
  // column stays closed, and the center column owns the full width.
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
  const rightbarPreference = panels.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  // A phone has no room for the right panel beside the conversation, so the
  // mobile regime reports it unavailable and the occupant never gets a track.
  const normal = mobile
    ? { sidebar: 0, center: viewport, rightbar: 0 }
    : computeColumns(viewport, !panels.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference)
  const cols = mobile
    ? { sidebar: 0, center: viewport, rightbar: 0 }
    : computeColumns(viewport, sidebarPreference, panels.rightbarTrack ? rightbarPreference : 0)
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        // The mobile drawer leaves the grid (absolute), so the frame drops to
        // the two tracks that remain in flow: center takes the width and the
        // right column closes.
        gridTemplateColumns: mobile
          ? 'minmax(0, 1fr) 0px'
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={panels.rightbarFullscreen || undefined}
      data-rightbar-instant={panels.rightbarInstant || undefined}
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
            the shell's own pending rendering. The conversation is
            session-maybe; SessionProvider withholds the strict right-column
            entry while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <RightbarColumn>
          {/* Strict session entry: with no session there is no surface, and the
              column is an empty zero-width track. The occupant receives the
              panel width it should draw at; the track is the frame's business. */}
          <SessionProvider>
            {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
          </SessionProvider>
        </RightbarColumn>
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
      {!mobile && panels.rightbarShown && !panels.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
