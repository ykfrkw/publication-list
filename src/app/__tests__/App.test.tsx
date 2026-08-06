/**
 * @vitest-environment jsdom
 *
 * End-to-end wiring test for the wizard, with `buildList` stubbed.
 *
 * Nothing here touches the network: the pipeline module is mocked, so the test
 * exercises the parts this layer owns — mode → config projection, progress and
 * cancellation, the results panel, and the credit checkbox on the snippet.
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

function makeModel(config: ListConfig, over: Partial<ListModel> = {}): ListModel {
  return {
    config,
    members: [{ id: '0000-0003-1317-0220', name: 'Yuki Furukawa' }],
    publications: [PUBLICATION],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
    ...over,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  buildListMock.mockReset()
  buildListMock.mockImplementation((config) => Promise.resolve(makeModel(config)))
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

function snippetText(): string {
  const blocks = Array.from(container.querySelectorAll('pre'))
  return blocks.map((b) => b.textContent ?? '').join('\n')
}

function creditCount(text: string): number {
  return text.split('class="publist-credit"').length - 1
}

describe('the wizard shell', () => {
  it('renders all three modes and an empty state', () => {
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('Reference list')
    expect(text).toContain('My publications')
    expect(text).toContain('Lab or group')
    expect(text).toContain('Nothing built yet')
  })

  it('offers the owner’s ORCID as a first-run example', () => {
    render()
    expect(container.textContent).toContain('Try it with ORCID 0000-0003-1317-0220')
  })

  it('will not build until there is a seed or an identifier', () => {
    render()
    const generate = byText('button', 'Generate list') as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    expect(container.textContent).toContain(
      'Add at least one seed or identifier first',
    )
  })
})

describe('running a build', () => {
  it('seeds mode 2 with the example ORCID and shows the result', async () => {
    render()
    click(byText('button', 'Try it with ORCID'))
    await flush()

    expect(buildListMock).toHaveBeenCalledTimes(1)
    expect(buildListMock.mock.calls[0][0].seeds.orcid).toEqual([
      '0000-0003-1317-0220',
    ])
    expect(container.textContent).toContain('The PRISMA 2020 statement')
    expect(container.textContent).toContain('1 publication')
  })

  it('passes an AbortSignal and a progress callback to buildList', async () => {
    render()
    click(byText('button', 'Try it with ORCID'))
    await flush()

    const opts = buildListMock.mock.calls[0][1]
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
    expect(typeof opts?.onProgress).toBe('function')
  })

  it('reports the stage rather than a bare spinner, and cancels on demand', async () => {
    let report: ((pct: number, message: string) => void) | undefined
    buildListMock.mockImplementation(
      (_config, opts) =>
        new Promise<ListModel>(() => {
          report = opts?.onProgress
        }),
    )

    render()
    click(byText('button', 'Try it with ORCID'))
    await flush()

    act(() => report?.(58, 'Enriching metadata (OpenAlex)'))
    expect(container.textContent).toContain('Enriching metadata (OpenAlex)')

    const signal = buildListMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    click(byText('button', 'Cancel'))
    expect(signal?.aborted).toBe(true)
  })

  it('shows warnings instead of swallowing them', async () => {
    buildListMock.mockImplementation((config) =>
      Promise.resolve(
        makeModel(config, {
          warnings: ['Pinned PMID 999 could not be retrieved.'],
        }),
      ),
    )
    render()
    click(byText('button', 'Try it with ORCID'))
    await flush()

    expect(container.textContent).toContain('Pinned PMID 999 could not be retrieved.')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('the credit checkbox on the generated snippet', () => {
  async function renderWithResult() {
    render()
    click(byText('button', 'Try it with ORCID'))
    await flush()
  }

  it('is on by default and produces exactly one credit block', async () => {
    await renderWithResult()
    const box = byText('div', 'Include a credit link').querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    expect(box?.checked).toBe(true)
    expect(creditCount(snippetText())).toBe(1)
  })

  it('produces zero credit blocks once it is turned off', async () => {
    await renderWithResult()
    const box = byText('div', 'Include a credit link').querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!
    click(box)
    expect(box.checked).toBe(false)
    const text = snippetText()
    expect(creditCount(text)).toBe(0)
    expect(text).not.toContain('yukifurukawa.jp')
    // Nothing else is withheld: the snapshot and the script tag are still there.
    expect(text).toContain('The PRISMA 2020 statement')
    expect(text).toContain('embed.js')
  })
})

describe('persistence', () => {
  it('restores a half-built draft after a reload', async () => {
    render()
    const membersBox = container.querySelector('textarea')
    expect(membersBox).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(membersBox, '0000-0003-1317-0220')
      membersBox!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    // A reload: a fresh root reading the same localStorage.
    act(() => root.unmount())
    root = createRoot(container)
    render()
    expect(container.querySelector('textarea')?.value).toBe('0000-0003-1317-0220')
  })
})
