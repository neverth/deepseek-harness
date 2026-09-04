/**
 * Mobile-regime declarations of ConversationRoot as CSS text. jsdom has no
 * layout and CSS Modules are not applied in the component specs, so these read
 * the source rather than measuring boxes.
 *
 * The mobile regime keeps the official sidebar drawer and the header entries;
 * it only moves the docked composer behind a floating trigger.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * Declarations of one rule, by its exact selector list.
 * @param selector - the selector text as written in the sheet.
 * @returns each declaration, trimmed, in source order.
 */
function declarations(selector: string): string[] {
  const rule = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\/-]/g, '\\$&')}\\s*\\{([^{}]*)\\}`,
  ).exec(declarationText)
  if (rule === null) throw new Error(`ConversationRoot.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('ConversationRoot.module.css mobile regime', () => {
  it('lets the transcript use the whole narrow column', () => {
    expect(declarations('.root[data-mobile]')).toContain(
      '--dsh-chat-content-width: var(--dsh-conversation-column-width, 100%)',
    )
  })

  it('collapses the docked composer without unmounting its measurements', () => {
    expect(declarations('.composerSeat[data-composer-collapsed]')).toEqual([
      'visibility: hidden',
      'pointer-events: none',
      'height: 0',
      'overflow: hidden',
    ])
  })

  it('floats the open composer over the transcript', () => {
    const selector = ".root[data-mobile][data-phase='active'] .composerSeat:not([data-composer-collapsed])"
    const rules = declarations(selector)
    expect(rules).toContain('position: absolute')
    expect(rules).toContain('bottom: env(safe-area-inset-bottom, 0px)')
  })

  it('keeps the last message clear of the collapsed composer floating pill', () => {
    const selector = ".root[data-mobile][data-phase='active'] .scrollBody:has(.composerSeat[data-composer-collapsed])"
    expect(declarations(selector)).toEqual(['padding-bottom: 84px'])
  })
})
