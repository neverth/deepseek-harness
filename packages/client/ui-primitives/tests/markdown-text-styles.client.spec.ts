/**
 * MarkdownText's table-wrapper and block-rhythm declarations as CSS text.
 * jsdom has no layout, so these read the source rather than measuring boxes.
 *
 * The table assertions pin the absence of a hover/focus box change on the
 * wrapper. A previous hover-revealed scrollbar swapped `overflow-x` and a
 * resting `padding-bottom`; because `md-table-wide` counts columns instead of
 * measuring overflow, a wide-hooked table that fits its column lost 8px on
 * hover and regained it on leave, which read as jitter under the pointer.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/markdown/MarkdownText.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`MarkdownText.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('MarkdownText.module.css table wrapper', () => {
  it('scrolls in one state so the browser owns bar visibility', () => {
    expect(declarations('.tableScroll')).toEqual(expect.arrayContaining([
      'overflow-x: auto',
      'overscroll-behavior-x: contain',
    ]))
  })

  it('gives the wide hook no hover or focus box change', () => {
    // Any of these selectors reintroduces the state difference that jittered.
    for (const selector of [
      '.tableScroll:global(.md-table-wide):hover',
      '.tableScroll:global(.md-table-wide):focus-visible',
      '.tableScroll:global(.md-table-wide)',
    ]) {
      expect(() => declarations(selector)).toThrow()
    }
    // The focus ring is a paint-only rule and stays.
    expect(declarations('.tableScroll:focus-visible')).toEqual(expect.arrayContaining([
      'outline: none',
    ]))
  })
})

describe('MarkdownText.module.css block rhythm', () => {
  it('declares the compact scale on one container', () => {
    expect(declarations('.markdown')).toEqual(expect.arrayContaining([
      '--dsh-md-block-gap: 8px',
      '--dsh-md-heading-lead: 16px',
      '--dsh-md-heading-trail: 6px',
      '--dsh-md-tight-gap: 4px',
      'line-height: calc(21px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  it('spaces blocks through the properties rather than literals', () => {
    expect(declarations('.markdown p')).toEqual(['margin: var(--dsh-md-block-gap) 0'])
    expect(declarations('.markdown h3')).toEqual(expect.arrayContaining([
      'margin: var(--dsh-md-heading-lead) 0 var(--dsh-md-heading-trail)',
    ]))
  })

  it('tightens every heading level against a following list', () => {
    // Sibling margins collapse to the larger, so both halves must move.
    expect(declarations('.markdown :where(h1, h2, h3, h4, h5, h6) + :where(ul, ol)'))
      .toEqual(['margin-top: var(--dsh-md-tight-gap)'])
    expect(declarations('.markdown :where(h1, h2, h3, h4, h5, h6):has(+ :where(ul, ol))'))
      .toEqual(['margin-bottom: var(--dsh-md-tight-gap)'])
  })

  it('lets the list marker inherit the body leading', () => {
    expect(declarations('.markdown li::marker')).toEqual(expect.arrayContaining([
      'line-height: inherit',
    ]))
  })
})
