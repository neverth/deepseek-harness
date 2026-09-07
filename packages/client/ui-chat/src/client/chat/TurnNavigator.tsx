import { memo, useEffect, useRef } from 'react'
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

function TurnNavigatorRail({ items, activeTurn, busyTurn, onNavigate, t }: TurnNavigatorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  /** While the pointer works the rail, follow must not move it under the hand. */
  const pointerInsideRef = useRef(false)

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

  if (items.length < 2) return null
  return (
    <div className={css.slot}>
      <nav
        className={css.frame}
        aria-label={t('chat.turnNavigation.label')}
        onPointerEnter={() => { pointerInsideRef.current = true }}
        onPointerLeave={() => { pointerInsideRef.current = false }}
      >
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
                title={item.prompt || undefined}
                onClick={() => { onNavigate(item) }}
              >
                {item.prompt || t('chat.turnNavigation.turn', { turn: item.turn })}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/**
 * Standing outline of every known Turn: one always-readable row per Turn
 * carrying its prompt summary, in session order. A loaded row scrolls to its
 * Turn, an unloaded one pages history in first, and the active row keeps
 * itself in view while the pointer is elsewhere. Rows the outline gave no
 * prompt fall back to their Turn number.
 *
 * Memoized because it renders one host element per Turn while the enclosing
 * view re-renders on every streaming delta: without the guard a long session
 * rebuilds hundreds of rows per commit for an outline that only changes when
 * a Turn is added, removed, or becomes active. Its props must therefore stay
 * referentially stable across those commits.
 */
export const TurnNavigator = memo(TurnNavigatorRail)
