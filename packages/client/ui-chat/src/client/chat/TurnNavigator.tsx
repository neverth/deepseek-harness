import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnRailItem } from './turn-rail-items.ts'
import css from './TurnNavigator.module.css'

interface TurnNavigatorProps {
  readonly items: readonly TurnRailItem[]
  readonly activeTurn: number | null
  /** Turn whose jump is still paging history in; its row pulses. */
  readonly busyTurn: number | null
  readonly onNavigate: (item: TurnRailItem) => void
  readonly t: ChatViewSlotProps['t']
}

/** localStorage key for the dragged outline width preference (px). */
const WIDTH_PREF_KEY = 'dsh.chat.turnOutlineWidth'
/**
 * Width the outline takes with no stored preference. The transcript centres a
 * 680px column in roughly 912px of chat container at an ordinary window,
 * leaving about 116px of margin per side, so this sits a little into the
 * transcript's empty gutter and reads as a rail over it rather than a column
 * competing for width. The drag handle owns every choice past this one.
 */
const DEFAULT_WIDTH = 160
/** Narrowest useful outline: below this a summary reads as a few characters. */
const MIN_WIDTH = 120
/** Widest the outline may grow, whatever the margin allows. */
const MAX_WIDTH = 420

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))
}

/** Stored width preference, or the default when absent or damaged. */
function readWidthPreference(): number {
  const raw = localStorage.getItem(WIDTH_PREF_KEY)
  if (raw === null) return DEFAULT_WIDTH
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH
}

type OutlineFrameStyle = CSSProperties & { readonly '--turn-outline-width': string }
type PreviewStyle = CSSProperties & { readonly '--turn-preview-top': string }

function TurnNavigatorRail({ items, activeTurn, busyTurn, onNavigate, t }: TurnNavigatorProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const [previewTop, setPreviewTop] = useState(0)
  const [width, setWidth] = useState(readWidthPreference)
  const [dragging, setDragging] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  /** While the pointer works the rail, follow must not move it under the hand. */
  const pointerInsideRef = useRef(false)
  const dragBase = useRef({ origin: 0, width: 0 })
  const previewId = useId()

  // Keep the active row visible: centre it whenever it leaves the scrollport,
  // unless the reader's pointer is working the rail.
  useEffect(() => {
    const scroller = scrollerRef.current
    const row = activeRef.current
    if (scroller === null || row === null || pointerInsideRef.current) return
    const rowTop = row.offsetTop
    const viewTop = scroller.scrollTop
    const viewHeight = scroller.clientHeight
    if (viewHeight <= 0) return
    if (rowTop >= viewTop && rowTop + row.offsetHeight <= viewTop + viewHeight) return
    const target = Math.max(0, rowTop - viewHeight / 2 + row.offsetHeight / 2)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
    } else {
      scroller.scrollTop = target
    }
  }, [activeTurn, items])

  // The preview describes one row, so it opens beside that row's current
  // position inside the scrolled ladder rather than following the pointer.
  const showPreview = useCallback((turn: number, row: HTMLElement): void => {
    const frame = frameRef.current
    if (frame !== null) {
      setPreviewTop(row.getBoundingClientRect().top - frame.getBoundingClientRect().top)
    }
    setPreviewTurn(turn)
  }, [])

  const draggedWidth = (clientX: number): number =>
    // The rail is pinned to the right edge, so travel leftwards widens it.
    clampWidth(dragBase.current.width - (clientX - dragBase.current.origin))
  const onHandleDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragBase.current = { origin: event.clientX, width }
    setDragging(true)
  }, [width])
  const onHandleMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    setWidth(draggedWidth(event.clientX))
  }, [])
  const onHandleUp = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    localStorage.setItem(WIDTH_PREF_KEY, String(draggedWidth(event.clientX)))
  }, [])

  if (items.length < 2) return null
  const preview = items.find(item => item.turn === previewTurn)
  const frameStyle: OutlineFrameStyle = { '--turn-outline-width': `${String(width)}px` }
  return (
    <div className={css.slot}>
      <nav
        ref={frameRef}
        className={dragging ? `${css.frame} ${css.frameDragging}` : css.frame}
        style={frameStyle}
        aria-label={t('chat.turnNavigation.label')}
        onPointerEnter={() => { pointerInsideRef.current = true }}
        onPointerLeave={() => {
          pointerInsideRef.current = false
          setPreviewTurn(null)
        }}
      >
        {/* The rail's inner edge resizes it, mirroring the transcript's own
            width handles. */}
        <div
          className={css.handle}
          role="presentation"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        />
        <div ref={scrollerRef} className={css.scroller}>
          {items.map((item) => {
            const active = item.turn === activeTurn
            const classes = [css.row]
            if (item.anchor.kind === 'unloaded') classes.push(css.rowUnloaded)
            if (active) classes.push(css.rowActive)
            if (item.turn === busyTurn) classes.push(css.rowBusy)
            return (
              <button
                key={item.turn}
                ref={active ? activeRef : undefined}
                type="button"
                className={classes.join(' ')}
                aria-label={t(
                  item.anchor.kind === 'loaded' ? 'chat.turnNavigation.jump' : 'chat.turnNavigation.jumpLoad',
                  { turn: item.turn },
                )}
                aria-current={active ? 'true' : undefined}
                aria-busy={item.turn === busyTurn ? 'true' : undefined}
                aria-describedby={item.turn === previewTurn ? previewId : undefined}
                onClick={() => { onNavigate(item) }}
                onPointerEnter={(event) => { showPreview(item.turn, event.currentTarget) }}
                onFocus={(event) => { showPreview(item.turn, event.currentTarget) }}
                onBlur={() => { setPreviewTurn(null) }}
              >
                {item.prompt || t('chat.turnNavigation.turn', { turn: item.turn })}
              </button>
            )
          })}
        </div>
        {preview !== undefined && !dragging && (
          <div
            id={previewId}
            role="tooltip"
            className={css.preview}
            style={{ '--turn-preview-top': `${String(previewTop)}px` } as PreviewStyle}
          >
            <div className={css.previewPrompt}>
              {preview.prompt || t('chat.turnNavigation.turn', { turn: preview.turn })}
            </div>
            {preview.response !== '' && <div className={css.previewResponse}>{preview.response}</div>}
          </div>
        )}
      </nav>
    </div>
  )
}

/**
 * Standing outline of every known Turn: one always-readable row per Turn
 * carrying its prompt summary, in session order. A loaded row scrolls to its
 * Turn, an unloaded one pages history in first, and the active row keeps
 * itself in view while the pointer is elsewhere. Hover or focus opens the
 * fuller prompt-and-response preview beside that row, and the rail's inner
 * edge drags to a width kept in localStorage.
 *
 * Memoized because it renders one host element per Turn while the enclosing
 * view re-renders on every streaming delta: without the guard a long session
 * rebuilds hundreds of rows per commit for an outline that only changes when
 * a Turn is added, removed, or becomes active. Its props must therefore stay
 * referentially stable across those commits.
 */
export const TurnNavigator = memo(TurnNavigatorRail)
