/**
 * The conversation-left board column: a hand-made group's HTML page, served
 * same-origin by the Host, scaled into the column with the same controls as
 * the launch-workbench demo (refresh, fit/1:1, open, collapse, drag width).
 *
 * The column follows the selected Session's group. Opening the group's root or
 * any direct subagent child shows the same board, because sidebar nesting does
 * not add children to the group's member list. The Host document is re-read
 * every few seconds so a board URL written by an agent appears without a page
 * reload; only the group lookup re-runs, never the iframe.
 * @module @deepseek-ai/dsh-client-ui-agent-group-board/client/AgentGroupBoard
 */

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { AgentGroupView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { boardGroupFor, rootSessionId, sameGroupDocument, type BoardGroup } from './board.ts'
import { readBoardOpenFile } from './open-file.ts'
import type { AgentGroupBoardInjected } from './slots.ts'
import type { AgentGroupBoardKey } from './locales.ts'
import css from './AgentGroupBoard.module.css'

/** `/agent-group-board` is the Host route registered by `@deepseek-ai/dsh-host-agent-group-board`. */
const BOARD_PATH = '/agent-group-board'
/** Width the board HTML is authored at; the iframe scales from it. */
const DESIGN_WIDTH = 760
/** How often the rail re-reads the Host group document. */
const POLL_INTERVAL_MS = 5_000
/** Persisted column width. */
const WIDTH_KEY = 'dsh-agent-group-board-width-v1'
const WIDTH_MIN = 320
const WIDTH_MAX = 960
const WIDTH_DEFAULT = 720

/** Locale namespace owned by this plugin. */
export const AGENT_GROUP_BOARD_NS = 'agentGroupBoard'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Board column copy. */
    agentGroupBoard: AgentGroupBoardKey
  }
}

/** Full props of the board rail entry. */
export type AgentGroupBoardProps =
  PropsRuntime<'conversation.left-rail'>
  & InjectFace<AgentGroupBoardInjected>
  & PropsLocale<typeof AGENT_GROUP_BOARD_NS>

/** Props of the harness-free rail body. */
export interface BoardRailProps {
  /** Current Session identity, absent while no Session is selected. */
  sessionId: SessionId | undefined
  /** Global Session-list selector hook supplied by the renderer. */
  useSessions: AgentGroupBoardProps['useSessions']
  /** Page-URL launch options; the templated home carries no Session concept. */
  launch: AgentGroupBoardInjected['launch']
  /** Read the Host group document. */
  loadGroups: AgentGroupBoardInjected['loadGroups']
  /** Open a board file in the native preview of the root Session's sidebar. */
  openFile: AgentGroupBoardInjected['openFile']
  /** Board-column copy. */
  t: AgentGroupBoardProps['t']
}

/** One drag's starting geometry. */
interface DragState {
  readonly startX: number
  readonly startWidth: number
}

/** Props of one resolved group's column. */
interface BoardPanelProps {
  readonly group: BoardGroup
  readonly root: SessionId
  readonly openFile: AgentGroupBoardInjected['openFile']
  readonly t: AgentGroupBoardProps['t']
}

/** Persisted column width, or the default outside its range. */
function initialWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(stored) && stored >= WIDTH_MIN && stored <= WIDTH_MAX) return stored
  } catch {
    // Private mode blocks storage; the default width still works.
  }
  return WIDTH_DEFAULT
}

/** Persist one column width; a refused write keeps the live width. */
function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // Private mode blocks storage; the live width still applies.
  }
}

/**
 * Board rail entry: resolves the selected Session's group board and renders
 * the column only while one exists.
 * @param props - the `conversation.left-rail` entry props.
 * @returns the board column, or null when no group board applies.
 */
export function BoardRail({ sessionId, useSessions, launch, loadGroups, openFile, t }: BoardRailProps) {
  const root = useSessions(state => sessionId === undefined ? undefined : rootSessionId(state.byId, sessionId))
  const [groups, setGroups] = useState<readonly AgentGroupView[] | null>(null)
  const loadGroupsRef = useRef(loadGroups)
  loadGroupsRef.current = loadGroups
  // The templated home launches tasks from a draft and exposes no stored
  // Session, so a reused draft's group board has no place on that page.
  const homeLaunch = launch.template === 'modellaunch' && launch.groupId === undefined
  const active = sessionId !== undefined && !homeLaunch

  useEffect(() => {
    if (!active) return undefined
    let live = true
    const load = (): void => {
      loadGroupsRef.current().then(
        (next) => {
          if (!live) return
          setGroups(current => current !== null && sameGroupDocument(current, next) ? current : next)
        },
        (error: unknown) => {
          // A failed read leaves the last known board in place; the next tick retries.
          console.error('[ui-agent-group-board] reading the Host group document failed:', error)
        },
      )
    }
    load()
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [active])

  const group = boardGroupFor(groups ?? [], sessionId, root)
  if (homeLaunch || group === undefined || sessionId === undefined || root === undefined) return null
  return <BoardPanel group={group} root={root} openFile={openFile} t={t} />
}

/**
 * One group's board column with its width, fit, refresh, and collapse state.
 * @param props - resolved group and copy.
 * @returns the complete rail.
 */
function BoardPanel({ group, root, openFile, t }: BoardPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [fit, setFit] = useState(true)
  const [width, setWidth] = useState(initialWidth)
  const [view, setView] = useState({ scale: 0.3, offset: 0, height: 2400 })
  const drag = useRef<DragState | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  const boardSrc = `${BOARD_PATH}?group=${encodeURIComponent(group.id)}`

  useEffect(() => {
    const element = viewport.current
    if (element === null) return undefined
    const measure = (): void => {
      const availableWidth = element.clientWidth
      const availableHeight = element.clientHeight
      const scale = availableWidth === 0 ? 0.3 : Math.min(1, availableWidth / DESIGN_WIDTH)
      const offset = Math.max(0, Math.round((availableWidth - DESIGN_WIDTH * scale) / 2))
      setView({
        scale,
        offset,
        height: fit ? (scale === 0 ? availableHeight : Math.ceil(availableHeight / scale)) : 2200,
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => { observer.disconnect() }
  }, [collapsed, fit, group.id])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const request = readBoardOpenFile(event, frame.current?.contentWindow ?? null)
      if (request === undefined) return
      openFileRef.current(root, request)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [root])

  if (collapsed) {
    return (
      <div className={css.rail} data-collapsed="">
        <div className={css.collapsed}>
          <button
            type="button"
            className={css.button}
            title={t('action.expand')}
            aria-label={t('action.expand')}
            onClick={() => { setCollapsed(false) }}
          >
            ›
          </button>
        </div>
      </div>
    )
  }

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width }
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return
    const next = Math.min(WIDTH_MAX, Math.max(
      WIDTH_MIN,
      drag.current.startWidth + (event.clientX - drag.current.startX),
    ))
    setWidth(next)
  }
  const endDrag = (): void => {
    if (drag.current === null) return
    drag.current = null
    storeWidth(width)
  }
  const resetWidth = (): void => {
    setWidth(WIDTH_DEFAULT)
    storeWidth(WIDTH_DEFAULT)
  }

  return (
    <div className={css.rail} style={{ width: `${width}px` }}>
      <div
        className={css.resize}
        title={t('rail.resize')}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetWidth}
      />
      <div className={css.tools}>
        <span className={css.name} title={`${group.name} — ${group.boardUrl}`}>{group.name}</span>
        <button
          type="button"
          className={css.button}
          onClick={() => { setNonce(value => value + 1) }}
        >
          {t('action.refresh')}
        </button>
        <button
          type="button"
          className={css.button}
          title={`${t('action.fit')} / ${t('action.actual')}`}
          onClick={() => { setFit(value => !value) }}
        >
          {fit ? t('action.actual') : t('action.fit')}
        </button>
        <button
          type="button"
          className={css.button}
          onClick={() => { window.open(boardSrc, '_blank', 'noopener') }}
        >
          {t('action.open')}
        </button>
        <button
          type="button"
          className={css.button}
          title={t('action.collapse')}
          aria-label={t('action.collapse')}
          onClick={() => { setCollapsed(true) }}
        >
          ‹
        </button>
      </div>
      <div className={css.scale} ref={viewport} data-scroll={fit ? undefined : ''}>
        <iframe
          key={`${group.id}:${group.boardUrl}`}
          ref={frame}
          className={css.frame}
          title={group.name}
          src={`${boardSrc}&_=${String(nonce)}`}
          style={{
            width: `${DESIGN_WIDTH}px`,
            height: `${String(view.height)}px`,
            left: `${fit ? view.offset : 0}px`,
            transform: `scale(${fit ? view.scale : 1})`,
          }}
        />
      </div>
    </div>
  )
}
