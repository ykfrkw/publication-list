/**
 * @vitest-environment jsdom
 *
 * The Static HTML output in the results panel.
 *
 * This is the route where the credit link ends up permanently pasted into a
 * third party's markup with no script anywhere near it, so two things are
 * pinned here: the single checkbox in the snippet panel governs it (one block
 * on, zero off), and what comes out is *only* a list — no `<script>` tag, no
 * `.publist-embed` wrapper, no `data-*` attributes for a script to read.
 *
 * The assertions run against the text the copy button actually puts on the
 * clipboard rather than against `renderHtml`, because the thing worth testing
 * is the wiring: a correct renderer reached through the wrong flag would still
 * be wrong.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListConfig, ListModel, Publication } from '@/core/types'

const buildListMock =
  vi.fn<
    (
      config: ListConfig,
      opts?: {
        signal?: AbortSignal
        onProgress?: (pct: number, message: string) => void
      },
    ) => Promise<ListModel>
  >()

vi.mock('@/core/pipeline', () => ({ buildList: buildListMock }))

const { default: App } = await import('../App')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PUBLICATION: Publication = {
  key: 'doi:10.1136/bmj.n71',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ'],
  authorsFull: ['Matthew J Page'],
  journal: 'BMJ',
  year: 2021,
  doi: '10.1136/bmj.n71',
  pmid: '33782057',
  sources: ['orcid'],
  seedIds: ['0000-0003-1317-0220'],
  trust: 'confirmed',
  category: 'original',
}

function makeModel(config: ListConfig): ListModel {
  return {
    config,
    members: [{ id: '0000-0003-1317-0220', name: 'Yuki Furukawa' }],
    publications: [PUBLICATION],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

const STATIC_LABEL = 'Static HTML (no auto-update)'

let container: HTMLDivElement
let root: Root
let copied: string[]

beforeEach(() => {
  localStorage.clear()
  buildListMock.mockReset()
  buildListMock.mockImplementation((config) => Promise.resolve(makeModel(config)))

  copied = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text)
        return Promise.resolve()
      },
    },
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  act(() => {
    root.render(<App />)
  })
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * The *most specific* element matching `selector` whose text contains `text`.
 *
 * Deliberately not the first in document order: every ancestor of a match also
 * "contains" the text, so `div` + a label would otherwise resolve to the page
 * wrapper and any `querySelector` from there would find the wrong control.
 * Shortest text wins, which is the innermost match.
 */
function byText(selector: string, text: string): HTMLElement {
  const matches = Array.from(
    container.querySelectorAll<HTMLElement>(selector),
  ).filter((el) => (el.textContent ?? '').includes(text))
  const match = matches.reduce<HTMLElement | undefined>(
    (best, el) =>
      best == null || (el.textContent ?? '').length < (best.textContent ?? '').length
        ? el
        : best,
    undefined,
  )
  if (!match) throw new Error(`no ${selector} containing "${text}"`)
  return match
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Build a list, then read what the Static HTML button copies. */
async function staticHtml(): Promise<string> {
  copied.length = 0
  click(byText('button', STATIC_LABEL))
  await flush()
  expect(copied.length).toBe(1)
  return copied[0]
}

function creditCount(html: string): number {
  return html.split('class="publist-credit"').length - 1
}

async function build() {
  render()
  click(byText('button', 'Try it with ORCID'))
  await flush()
}

function creditCheckbox(): HTMLInputElement {
  const box = byText('div', 'Include a credit link').querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )
  if (!box) throw new Error('no credit checkbox')
  return box
}

describe('the static HTML output', () => {
  it('is offered as soon as there is a list, and says it does not update', async () => {
    await build()
    expect(container.textContent).toContain(STATIC_LABEL)
    expect(container.textContent).toContain('will not update itself')
  })

  it('carries exactly one credit block while the checkbox is on', async () => {
    await build()
    expect(creditCheckbox().checked).toBe(true)

    const html = await staticHtml()
    expect(creditCount(html)).toBe(1)
    expect(html).toContain(
      '<a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a>',
    )
  })

  it('carries no credit block at all once the checkbox is off', async () => {
    await build()
    click(creditCheckbox())
    expect(creditCheckbox().checked).toBe(false)

    const html = await staticHtml()
    expect(creditCount(html)).toBe(0)
    expect(html).not.toContain('yukifurukawa.jp')
    // Turning it off withholds nothing else: the list is unchanged.
    expect(html).toContain('The PRISMA 2020 statement')
  })

  it('is a bare list in both states — no script, no wrapper, no data attributes', async () => {
    await build()

    for (const state of ['on', 'off'] as const) {
      if (state === 'off') click(creditCheckbox())
      const html = await staticHtml()

      expect(html).toContain('<section class="publist">')
      expect(html).toContain('The PRISMA 2020 statement')
      expect(html).not.toContain('<script')
      expect(html).not.toContain('publist-embed')
      expect(html).not.toContain('data-')
      expect(html).not.toContain('<iframe')
    }
  })
})
