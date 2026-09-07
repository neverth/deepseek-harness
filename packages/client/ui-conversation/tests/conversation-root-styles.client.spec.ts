/**
 * Mobile-regime declarations of ConversationRoot as CSS text. jsdom has no
 * layout and CSS Modules are not applied in the component specs, so these read
 * the source rather than measuring boxes.
 *
 * The font floor is the load-bearing one: iOS zooms the whole page in whenever
 * focus lands on a control rendering under 16px and never zooms back out,
 * which also pushes the fixed composer out of the visual viewport. Since
 * iOS 10 Safari deliberately ignores `maximum-scale` and `user-scalable=no`,
 * so the rendered font is the only lever, and it has to reach the editor's
 * descendants because iOS reads the focused node rather than its container.
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
  it('floors the draft font at 16px so iOS never zooms the page in', () => {
    const selector = '.root[data-mobile] [data-composer-input],\n.root[data-mobile] [data-composer-input] *'
    expect(declarations(selector)).toEqual([
      'font-size: max(16px, var(--dsh-content-font-size, 14px))',
    ])
  })

  it('keeps the reader font preference above the floor', () => {
    // `max()`, not a flat 16px: a reader who raised the preference keeps it.
    expect(css).toContain('max(16px, var(--dsh-content-font-size, 14px))')
    expect(css).not.toContain('font-size: 16px !important')
  })

  it('hides the view switcher, which costs a whole row of a phone screen', () => {
    expect(declarations('.root[data-mobile] .tabs')).toEqual(['display: none'])
  })
})
