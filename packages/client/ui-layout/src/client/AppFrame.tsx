/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * receives live parameters from that solve. The root-scoped main slot selects
 * the Conversation or a global panel. Each column occupant owns its Session
 * binding and reports the geometry it needs.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { shareSessionId } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { CENTER_MIN, clampWidth, computeColumns, MOBILE_DRAWER, MOBILE_MAX, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.bottom' | 'shell.overlay' | 'shell.leading'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
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
  usePanelInfo,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth
  // Every navigable session, not just the one the right column tracks: the
  // mobile drawer must also close when the user picks a blank session.
  const currentSessionId = useSessions(state =>
    Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id)

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
  // visual viewport shrinks and pans, so the app's own box stays taller than
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
  // follow that pan to stay on the visible region. That follow is gated on the
  // keyboard being up (`vv.height` shorter than the layout viewport): with no
  // inner scroller able to consume the gesture — a short transcript, or a drag
  // over non-scrolling chrome such as the sidebar header — iOS rubber-bands the
  // document itself, and offsetTop then moves WITH the finger while the layout
  // viewport keeps full height. Following it there moves the frame the same way
  // the finger goes, reading as a reversed scroll. Keyboard pans are the only
  // pan worth following, and the keys always shrink vv.height first.
  useEffect(() => {
    const vv = window.visualViewport
    if (vv === null || vv === undefined) return
    const root = document.documentElement
    let raf: number | null = null
    const update = (): void => {
      raf = null
      const frame = frameRef.current
      if (frame !== null && frame.getBoundingClientRect().width <= MOBILE_MAX) {
        // documentElement.clientHeight stays the layout viewport height even on
        // iOS 26, where window.innerHeight tracks the visual viewport instead.
        const keyboardUp = vv.height < root.clientHeight - 1
        root.style.setProperty('--dsh-visual-viewport-height', `${String(Math.round(vv.height))}px`)
        root.style.setProperty(
          '--dsh-visual-viewport-top',
          keyboardUp ? `${String(Math.round(vv.offsetTop))}px` : '0px',
        )
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
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Mobile regime: the sidebar leaves the grid and rides above the
  // conversation as an overlay drawer (same narrowExpanded toggle), the
  // right column stays closed, and the center column owns the full width.
  const mobile = viewport <= MOBILE_MAX
  // Share mode (opened from a `#share=<id>` link): the sidebar is the only
  // surface that lists, searches, or starts other sessions, so hiding it
  // confines this page to the one shared session. Read once at mount — a
  // share link is a fresh page load, never an in-place hash edit.
  const shared = useMemo(() => shareSessionId() !== undefined, [])
  const drawerOpen = mobile && !shared && layoutInfo.narrowExpanded
  const drawerWidth = Math.min(MOBILE_DRAWER, Math.max(0, viewport - 56))
  // The drawer covers the conversation, so navigating to a session inside it
  // must reveal that session: close on every actual session change.
  const lastDrawerSession = useRef(currentSessionId)
  useEffect(() => {
    if (lastDrawerSession.current !== currentSessionId && drawerOpen) actions.toggleSidebar()
    lastDrawerSession.current = currentSessionId
  }, [actions, currentSessionId, drawerOpen])
  // Desktop reopen controls occupy the frame's shell.leading seat (macOS) or
  // the Windows caption row; neither platform keeps an icon rail.
  const darwin = document.documentElement.dataset.platform === 'darwin'
  const collapsedWidth = darwin
    || document.documentElement.hasAttribute('data-windows-titlebar') ? 0 : SIDEBAR_COLLAPSED
  // Share mode drops the sidebar track to zero width and keeps the center and
  // right columns: a zero preference with a zero collapsed rail leaves the
  // solver's center = viewport - 0 - rightbar invariant intact.
  const effectiveCollapsedWidth = shared ? 0 : collapsedWidth
  const effectiveSidebarPreference = shared ? 0 : sidebarPreference
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const closed = { sidebar: 0, center: viewport, rightbar: 0 }
  // A narrow frame with the right panel closed concedes the sidebar track too.
  const normalSidebar = !layoutInfo.rightbarShown && narrow ? 0 : effectiveSidebarPreference
  const normal = mobile
    ? closed
    : computeColumns(viewport, normalSidebar, rightbarPreference, effectiveCollapsedWidth)
  const cols = mobile
    ? closed
    : computeColumns(viewport, effectiveSidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0, effectiveCollapsedWidth)
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
  // Track easing is scoped to a discrete open/close toggle: data-animating
  // goes up when the collapse state or the rightbar track flips and comes down
  // at transition end (timeout as the reduced-motion/covered-frame fallback).
  // Steady-state viewport updates stay instant (AppFrame.module.css), and so
  // does a toggle arriving together with a viewport change — that is the
  // responsive auto-collapse firing mid window-resize, where easing would
  // chase the live window edge. The counter restarts the settle window when a
  // re-toggle interrupts a running transition.
  const [animating, setAnimating] = useState(0)
  const trackToggle = `${sidebarCollapsed}:${layoutInfo.rightbarTrack}`
  const previousToggle = useRef(trackToggle)
  const previousViewport = useRef(viewport)
  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewport
    previousViewport.current = viewport
    if (previousToggle.current === trackToggle) return
    previousToggle.current = trackToggle
    if (viewportChanged) return
    setAnimating(token => token + 1)
  }, [trackToggle, viewport])
  useEffect(() => {
    if (animating === 0) return
    const frame = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (frame === null) return
    const settle = () => { setAnimating(0) }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === frame && event.propertyName === 'grid-template-columns') settle()
    }
    frame.addEventListener('transitionend', onTransitionEnd)
    const timer = setTimeout(settle, 600)
    return () => {
      frame.removeEventListener('transitionend', onTransitionEnd)
      clearTimeout(timer)
    }
  }, [animating])
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
  // The rendered template lets the grid solve the squeeze natively: the centre
  // declares its protected minimum and the right column bids up to the clamped
  // preference, so a window resize lands in the same layout pass as the frame
  // edge. The JS solve lags the viewport by a ResizeObserver + rAF frame; when
  // it priced the squeeze itself, the centre column absorbed each width change
  // whole and was corrected two frames later — visible jitter. cols keeps only
  // the discrete decisions (track present, collapse state) and the drag base.
  const rightbarMax = cols.rightbar === 0 ? 0 : clampWidth(rightbarPreference, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO)
  const sidebar = useMemo(() => shared ? null : renderSlot('sidebar', {
    collapsed: mobile ? false : sidebarCollapsed,
    width: mobile ? drawerWidth : cols.sidebar,
  }), [shared, renderSlot, mobile, sidebarCollapsed, drawerWidth, cols.sidebar])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])
  // Window-chrome seat over the main panels' top-left corner: only a fully
  // hidden sidebar column on macOS desktop leaves window chrome without a
  // home — the Windows zero-width collapse keeps its controls in the caption
  // row (ui-sidebar). AppFrame.module.css publishes the matching
  // --dsh-frame-leading-clearance under the same collapsed condition.
  const leading = useMemo(() => renderSlot('shell.leading', {}), [renderSlot])
  const leadingMounted = darwin && sidebarCollapsed && !shared

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        ...(document.documentElement.hasAttribute('data-windows-titlebar')
          ? { '--dsh-windows-sidebar-width': `${mobile ? drawerWidth : cols.sidebar}px` } : {}),
        // The mobile drawer leaves the grid (absolute), so the frame drops to
        // the two tracks that remain in flow: center takes the width and the
        // right column closes.
        gridTemplateColumns: mobile
          ? 'minmax(0, 1fr) 0px'
          : `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : CENTER_MIN}px, 1fr) minmax(0px, ${rightbarMax}px)`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-dragging={dragging || undefined}
      data-animating={animating > 0 || undefined}
      data-mobile={mobile || undefined}
      data-drawer-open={drawerOpen || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      <div className={css.sidebarCol} style={mobile ? { width: drawerWidth } : undefined}>
        {sidebar}
      </div>
      <>
        <CenterColumn>{main}</CenterColumn>
        <RightbarColumn>
          {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
      </>
      <div className={css.bottomRow} data-shell-bottom>
        {renderSlot('shell.bottom', {})}
      </div>
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {leadingMounted && (
        <div className={css.leadingSeat} data-shell-leading>
          {leading}
        </div>
      )}
      {/* Mobile chrome: the drawer trigger is the only way back to a sidebar
          that has left the frame, and the scrim dismisses it. Share mode has
          no sidebar to return to, so it carries no trigger. */}
      {mobile && !shared && (
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
          the mobile regime has no draggable column edges at all. Share mode
          has no sidebar column, so it carries no handle either. */}
      {!mobile && !shared && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!mobile && layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
