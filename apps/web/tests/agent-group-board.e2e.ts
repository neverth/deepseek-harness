/**
 * Keyless board → native preview bridge over the shipped Web profile: a group
 * board URL, the Host-proxied iframe, the postMessage contract, and the right
 * sidebar's document preview. The board page is fulfilled by Playwright with
 * the same sandbox policy the Host sends, so the opaque-origin message path is
 * exercised for real.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const SESSION_ID = 'agent-group-board-bridge-e2e'
const SESSION_TITLE = 'Board file preview'
const GROUP_ID = 'custom:e2e-board'
const GROUP_NAME = 'E2E board'
// A source preview carries line anchors; the Markdown renderer has no source-line
// model, so a `.md` file opens rendered but does not mark a line.
const REPORT = 'board-report.txt'

it('opens a file posted by the sandboxed board iframe in the native preview', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const sessionId = await seedSession(scaffold, await readFile(SEED, 'utf8'), SESSION_ID)
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  await workspace.attachSession(sessionId)
  await scaffold.ctx.sessionController.rename({ sessionId, title: SESSION_TITLE })
  await scaffold.ctx.agentGroups.replace([{ id: GROUP_ID, name: GROUP_NAME, sessionIds: [sessionId] }])
  await scaffold.ctx.agentGroups.setBoardUrl(GROUP_ID, 'http://127.0.0.1:9/board.html')
  await writeFile(join(scaffold.workspaceCwd, REPORT), 'line one\nline two\nline three\n', 'utf8')

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'agent-group-board-bridge'))
  await page.route('**/agent-group-board?**', route => route.fulfill({
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups',
    },
    body: `<script>setTimeout(() => {
      parent.postMessage({ type: 'dsh:open-file', path: '${REPORT}', line: 2 }, '*')
    }, 300)</script>`,
  }))

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByText(SESSION_TITLE, { exact: true }).first().click()
  await page.locator(`iframe[title="${GROUP_NAME}"]`).waitFor({ timeout: 20_000 })

  const previewUrl = page.locator('[data-textpreview-url]')
  await expect.poll(async () => (await previewUrl.last().getAttribute('data-textpreview-url'))?.endsWith(`/${REPORT}`))
    .toBe(true)
  await expect.poll(() => page.locator('[data-textpreview-mark="2"]').count()).toBeGreaterThan(0)
  await page.getByText('line two', { exact: true }).waitFor()
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
