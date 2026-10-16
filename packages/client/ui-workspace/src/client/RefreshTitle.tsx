/**
 * Composer control beside the permission chip: regenerates the Session title
 * from the conversation so far. The title lives on the Host, so this only asks
 * and then reports the answer — a provider that kept the title it anchored to
 * reports nothing accepted, which reads as "unchanged" rather than as failure.
 */
import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the composer bar's slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './RefreshTitle.module.css'

/** How long the button reports an accepted refresh before returning to its action label. */
const CONFIRMED_MS = 1000

/** Registration-side face: the Host ask, with failure reporting owned by the plugin. */
export interface RefreshTitleInjected {
  /**
   * Ask the Host to regenerate one Session's title.
   * @param sessionId - Session whose title is regenerated.
   * @returns true when the Host accepted a title, false when nothing was accepted or the call failed.
   */
  refreshTitle: (sessionId: SessionId) => Promise<boolean>
}

/** Full props for the composer's title-regeneration control. */
export type RefreshTitleProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<RefreshTitleInjected>
  & PropsLocale<'workspace'>

/**
 * @param props - Session identity, the regeneration ask, and the composer's locale.
 * @returns the regeneration trigger in its current state.
 */
export function RefreshTitle({ sessionId, refreshTitle, t }: RefreshTitleProps) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'confirmed'>('idle')
  // A second click while one refresh is in flight would queue a third title
  // revision onto the Host, so the button stays inert until the answer lands.
  const run = (): void => {
    if (phase !== 'idle') return
    setPhase('pending')
    void refreshTitle(sessionId).then((accepted) => {
      if (!accepted) {
        setPhase('idle')
        return
      }
      setPhase('confirmed')
      window.setTimeout(() => { setPhase('idle') }, CONFIRMED_MS)
    })
  }
  const label = phase === 'confirmed'
    ? t('regenerate.confirmed')
    : phase === 'pending' ? t('regenerate.pending') : t('regenerate')
  return (
    <button
      type="button"
      className={css.regenerate}
      disabled={phase === 'pending'}
      onClick={run}
    >
      <IconRefreshOutlineRegular />
      <span className={css.label}>{label}</span>
    </button>
  )
}
