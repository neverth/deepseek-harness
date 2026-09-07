import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { ConversationContentProps, ConversationViewsProps, InputZone } from '../contract/slots.ts'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

function ConversationSessionView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', {})
}

function NoConversationWidthControls() {
  return null
}

/** Column width at or below which the composer collapses to a floating trigger
 * (mirrors the layout frame's mobile regime). */
const MOBILE_MAX = 768

/**
 * Render the shared Conversation body and its occurrence-selected local Components.
 * @param props - Factory input, standard Session sources, and Conversation seats.
 * @returns the Conversation view, Composer, and optional width controls.
 */
export function ConversationContent(props: ConversationContentProps) {
  const {
    sessionId, phase, hero, useSession, useSessions, useSessionStatus,
    useWorkspaces, useInput, useComposerBlock, renderSlot, renderSlotChain,
    selectWorkspace, t, useFactorySlot,
  } = props
  const session = useSession(snapshot => snapshot)
  const Views = useFactorySlot('views', ConversationSessionView)
  const WidthControls = useFactorySlot('widthControls', NoConversationWidthControls)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const pendingInteraction = useSessionStatus(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId)?.pendingInteraction)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  // Mobile regime: the composer leaves the flow and opens from a floating
  // trigger, so a narrow column shows the transcript full-height. Only the
  // main column: an embedded occurrence keeps its inline composer.
  const [mobile, setMobile] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const mainColumn = props.variant !== 'embedded'
  useLayoutEffect(() => {
    if (body === null || !mainColumn) return
    const measure = () => {
      const next = body.offsetWidth <= MOBILE_MAX
      setMobile(next)
      body.parentElement?.toggleAttribute('data-mobile', next)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    measure()
    return () => {
      observer.disconnect()
      body.parentElement?.removeAttribute('data-mobile')
    }
  }, [body, mainColumn])
  // Escape is the second exit from the open sheet, beside its collapse button.
  useEffect(() => {
    if (!composerOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setComposerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [composerOpen])

  // iOS Safari zooms the page in when focus lands on a control whose font is
  // under 16px, and never zooms back out. The composer's draft font follows a
  // user preference that is 14px by default, so the fix is to refuse the zoom
  // rather than to force the font up: `maximum-scale=1` while a control holds
  // focus, restored on blur so pinch-zoom stays available for reading.
  // Safari only re-reads the viewport tag on the next focus, so this listens
  // on the capture phase of focusin, before the control's own focus handling.
  useEffect(() => {
    if (!mobile) return
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (meta === null) return
    const resting = meta.content
    const clamp = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      // The composer is a contenteditable div, the settings fields are inputs.
      // Read the attribute rather than `isContentEditable`: that property is
      // rendering-dependent and jsdom leaves it undefined.
      const editable = target.getAttribute('contenteditable')
      const typing = (editable !== null && editable !== 'false')
        || ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (!typing) return
      meta.content = `${resting}, maximum-scale=1`
    }
    const release = (): void => { meta.content = resting }
    document.addEventListener('focusin', clamp, true)
    document.addEventListener('focusout', release, true)
    return () => {
      document.removeEventListener('focusin', clamp, true)
      document.removeEventListener('focusout', release, true)
      meta.content = resting
    }
  }, [mobile])

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  // The two land at different levels: viewport height is the scrollport's own
  // fact, while composer height goes on the band that holds BOTH the
  // scrollport and the mobile composer toggle — a sibling of the scroller
  // cannot inherit a variable set on it.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    const band = scroller?.parentElement ?? null
    if (seat === null || scroller === null || band === null) return
    seatObserver.current = new ResizeObserver(() => {
      band.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
      scroller.style.setProperty(
        '--dsh-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      )
    })
    seatObserver.current.observe(seat)
    seatObserver.current.observe(scroller)
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  // A title still automatic reads in the reader's language, matching the
  // sidebar row the same Workspace has there.
  const storedChipTitle = pendingWorkspace?.title
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))
  const chipTitle = storedChipTitle === undefined
    ? undefined
    : workspaceDisplayTitle(storedChipTitle, t('workspace.defaultName'))

  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
  })

  const composerBar = (
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroShell t={t} renderSlot={renderSlot} />}
      {hero && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave a business-owned takeover at the content
  // end off-screen when the user is not pinned to the floor.
  // Mobile only collapses the docked composer: the hero IS the composer, and
  // hiding it would leave the blank session with nothing to act on.
  const collapsedComposer = mainColumn && mobile && phase === 'active' && !composerOpen
  const composerSeat = (
    <div
      ref={seatResizeRef}
      className={css.composerSeat}
      data-composer-seat=""
      data-conversation-region="composer"
      {...collapsedComposer ? { 'data-composer-collapsed': '' } : {}}
    >
      {composer}
    </div>
  )

  return (
    <div
      ref={setBody}
      className={clsx(css.body, props.variant === 'embedded' && css.embeddedBody)}
      data-conversation-content=""
      data-conversation-session={sessionId}
      data-conversation-region="chat"
      data-content-phase={phase}
    >
      <div className={css.scrollBody} data-conversation-scroll="">
        {sessionId === undefined ? null : <Views />}
        {composerSeat}
      </div>
      {mainColumn && mobile && phase === 'active' && (
        <button
          type="button"
          className={css.composerTrigger}
          data-composer-open={composerOpen || undefined}
          aria-expanded={composerOpen}
          aria-label={composerOpen ? t('input.close') : t('input.open')}
          onClick={() => { setComposerOpen(open => !open) }}
        >
          {composerOpen ? <IconChevronDownOutlineRegular size={18} /> : t('input.open')}
        </button>
      )}
      <WidthControls container={body} phase={phase} />
    </div>
  )
}
