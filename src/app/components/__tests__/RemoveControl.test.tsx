/**
 * @vitest-environment jsdom
 *
 * Removing one publication from a built list.
 *
 * This is the route that closes the gap the `exclude`-beats-`include` fix
 * opened: the pipeline has been able to drop a wrongly pinned paper for a while,
 * but until there was a control on the list itself the only way to reach it was
 * to hand-edit `pubs.json`. Four things are pinned here.
 *
 *   1. Remove writes the `exclude` entry that does the work, and takes the ref
 *      out of `include` so the saved configuration does not pin and exclude the
 *      same paper.
 *   2. A record with neither a DOI nor a PMID cannot be referenced at all, so
 *      its control is disabled and says why rather than silently doing nothing.
 *   3. A removal is listed and undoable. A removal the user cannot see or
 *      reverse is how a real paper goes quietly missing from a CV.
 *   4. **None of it reaches the output.** Every copyable format is compared
 *      byte for byte against the pure renderer in `core/render.ts`, so the
 *      Remove controls cannot leak into anything anyone pastes or embeds.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesIdRef, parseIdRef } from '@/core/ids'
import {
  renderBibtex,
  renderClipboard,
  renderHtml,
  renderMarkdown,
  renderRis,
  renderWordpressBlocks,
} from '@/core/render'
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

const { default: App } = await import('../../App')
const { DRAFT_STORAGE_KEY, EXAMPLE_ORCID, emptyDraft } = await import(
  '../../lib/wizard'
)
const { UNREMOVABLE_REASON } = await import('../PreviewList')

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PINNED: Publication = {
  key: 'doi:10.1136/bmj.n71',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ'],
  authorsFull: ['Matthew J Page'],
  journal: 'BMJ',
  year: 2021,
  doi: '10.1136/bmj.n71',
  pmid: '33782057',
  sources: ['orcid'],
  seedIds: [EXAMPLE_ORCID],
  trust: 'confirmed',
  category: 'original',
}

const KEEPER: Publication = {
  key: 'pmid:33782058',
  title: 'Digital CBT for insomnia',
  authors: ['Furukawa Y'],
  authorsFull: ['Yuki Furukawa'],
  journal: 'Sleep',
  year: 2024,
  pmid: '33782058',
  sources: ['pubmed'],
  seedIds: [EXAMPLE_ORCID],
  trust: 'confirmed',
  category: 'original',
}

/** Neither a DOI nor a PMID: nothing `formatIdRef` can write down. */
const UNREFERENCEABLE: Publication = {
  key: 'title:aconferenceabstractwithnoidentifiers',
  title: 'A conference abstract with no identifiers',
  authors: ['Furukawa Y'],
  authorsFull: ['Yuki Furukawa'],
  journal: 'Sleep Medicine',
  year: 2023,
  sources: ['researchmap'],
  seedIds: [EXAMPLE_ORCID],
  trust: 'confirmed',
  category: 'original',
}

const ALL = [PINNED, KEEPER, UNREFERENCEABLE]

/**
 * `buildList`, minus the network: the one behaviour the mock has to reproduce
 * is pipeline stage 3, where an `exclude` entry takes a record off the list
 * however it got there.
 */
function makeModel(config: ListConfig): ListModel {
  const refs = (config.exclude ?? [])
    .map(parseIdRef)
    .filter((r) => r != null)
  return {
    config,
    members: [{ id: EXAMPLE_ORCID, name: 'Yuki Furukawa' }],
    publications: ALL.filter((pub) => !refs.some((ref) => matchesIdRef(pub, ref))),
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

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

/**
 * Start from a draft that already pins the PRISMA paper — the state a freeze
 * leaves behind, and the story this control exists for.
 */
function seedDraft(): void {
  localStorage.setItem(
    DRAFT_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      draft: {
        ...emptyDraft('person'),
        orcid: EXAMPLE_ORCID,
        include: ['doi:10.1136/bmj.n71'],
      },
    }),
  )
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

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

async function build() {
  seedDraft()
  act(() => root.render(<App />))
  click(byText('button', 'Generate list'))
  await flush()
}

function preview(): HTMLElement {
  const el = container.querySelector<HTMLElement>('.publist-preview')
  if (!el) throw new Error('no preview')
  return el
}

/** The Remove control on the row whose citation contains `text`. */
function removeButton(text: string): HTMLButtonElement {
  const item = Array.from(preview().querySelectorAll('li.publist-item')).find(
    (li) => (li.textContent ?? '').includes(text),
  )
  if (!item) throw new Error(`no list item containing "${text}"`)
  const button = item.querySelector('button')
  if (!button) throw new Error(`no Remove control on "${text}"`)
  return button
}

function lastConfig(): ListConfig {
  const call = buildListMock.mock.calls.at(-1)
  if (!call) throw new Error('buildList was never called')
  return call[0]
}

/** The model the panels are rendering, disclaimer applied as `App` applies it. */
function outputModel(): ListModel {
  const model = makeModel(lastConfig())
  return { ...model, config: { ...model.config, disclaimer: 'show' } }
}

async function copyOf(label: string): Promise<string> {
  copied.length = 0
  click(byText('button', label))
  await flush()
  expect(copied.length).toBe(1)
  return copied[0]
}

describe('removing a publication from the built list', () => {
  it('offers a Remove control on every row', async () => {
    await build()
    expect(preview().querySelectorAll('li.publist-item').length).toBe(3)
    expect(removeButton('PRISMA').textContent).toContain('Remove')
  })

  it('adds the ref to exclude and takes it out of include', async () => {
    await build()
    expect(lastConfig().include).toContain('doi:10.1136/bmj.n71')

    click(removeButton('PRISMA'))
    await flush()

    const config = lastConfig()
    expect(config.exclude).toContain('doi:10.1136/bmj.n71')
    expect(config.include ?? []).not.toContain('doi:10.1136/bmj.n71')
  })

  it('rebuilds, so the record leaves the list on the spot', async () => {
    await build()
    expect(preview().textContent).toContain('The PRISMA 2020 statement')

    click(removeButton('PRISMA'))
    await flush()

    expect(preview().textContent).not.toContain('The PRISMA 2020 statement')
    expect(preview().textContent).toContain('Digital CBT for insomnia')
  })

  it('uses the one shared rebuild path rather than a second one', async () => {
    await build()
    const before = buildListMock.mock.calls.length
    click(removeButton('PRISMA'))
    await flush()
    expect(buildListMock.mock.calls.length).toBe(before + 1)
  })

  it('leaves the free-text pins box alone', async () => {
    await build()
    click(removeButton('PRISMA'))
    await flush()
    // The user's own typing is not rewritten under them; the `exclude` entry is
    // what removes the record, and it outranks any pin.
    const boxes = Array.from(container.querySelectorAll('textarea'))
    for (const box of boxes) expect(box.value).not.toContain('10.1136')
  })
})

describe('a record that cannot be referenced', () => {
  it('has a disabled control that says why', async () => {
    await build()
    const button = removeButton('conference abstract')
    expect(button.disabled).toBe(true)

    const description = `${button.getAttribute('aria-label') ?? ''} ${
      button.parentElement?.getAttribute('title') ?? ''
    }`
    expect(description).toContain('neither a DOI nor a PMID')
    expect(description).toContain(UNREMOVABLE_REASON)
  })

  it('does not change anything when it is clicked anyway', async () => {
    await build()
    const before = buildListMock.mock.calls.length
    click(removeButton('conference abstract'))
    await flush()
    expect(buildListMock.mock.calls.length).toBe(before)
    expect(lastConfig().exclude ?? []).toEqual([])
  })
})

describe('the removed list', () => {
  it('names what was taken out and how many', async () => {
    await build()
    click(removeButton('PRISMA'))
    await flush()

    const details = byText('details', 'removed')
    expect(details.textContent).toContain('1 removed')
    expect(details.textContent).toContain('The PRISMA 2020 statement')
    expect(details.textContent).toContain('doi:10.1136/bmj.n71')
  })

  it('is not there before anything has been removed', async () => {
    await build()
    const all = Array.from(container.querySelectorAll('details'))
    expect(all.some((d) => (d.textContent ?? '').includes('removed'))).toBe(false)
  })

  it('undoes a removal, putting the record back on the list', async () => {
    await build()
    click(removeButton('PRISMA'))
    await flush()

    click(byText('button', 'Undo'))
    await flush()

    const config = lastConfig()
    expect(config.exclude ?? []).not.toContain('doi:10.1136/bmj.n71')
    // The pin the removal took out comes back with it. Without that, an undo
    // after a freeze would leave the record gone: its seed is no longer there.
    expect(config.include).toContain('doi:10.1136/bmj.n71')
    expect(preview().textContent).toContain('The PRISMA 2020 statement')
    // Undo forgets the decision entirely, so the entry goes with it.
    expect(
      Array.from(container.querySelectorAll('details')).some((d) =>
        (d.textContent ?? '').includes('removed'),
      ),
    ).toBe(false)
  })

  it('survives a reload, labels and all', async () => {
    await build()
    click(removeButton('PRISMA'))
    await flush()

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    click(byText('button', 'Generate list'))
    await flush()

    const details = byText('details', 'removed')
    expect(details.textContent).toContain('The PRISMA 2020 statement')
  })
})

describe('what the user copies', () => {
  /**
   * The load-bearing test: each copyable format is compared against the pure
   * renderer, so the wizard-only controls cannot appear in anything published.
   */
  it('is byte-identical to the renderers, with no trace of the controls', async () => {
    await build()
    click(removeButton('PRISMA'))
    await flush()

    const model = outputModel()
    const outputs: Record<string, string> = {
      'Static HTML (no auto-update)': renderHtml(model, { credit: true }),
      'WordPress blocks': renderWordpressBlocks(model),
      Markdown: renderMarkdown(model),
      BibTeX: renderBibtex(model),
      RIS: renderRis(model),
      'Copy All (for Word)': renderClipboard(model).plain,
    }

    for (const [label, expected] of Object.entries(outputs)) {
      const actual = await copyOf(label)
      expect(actual, label).toBe(expected)
      for (const trace of [
        'Remove',
        'Undo',
        '<button',
        'aria-label',
        'disabled',
      ]) {
        expect(actual, `${label} contains "${trace}"`).not.toContain(trace)
      }
      // And the removal really did reach the output.
      expect(actual, label).not.toContain('PRISMA')
      expect(actual, label).toContain('Digital CBT for insomnia')
    }
  })

  it('renders the same list the string renderer does', async () => {
    await build()

    // The preview is composed in React so each row can carry a control; strip
    // the controls and what is left has to be the same list, in the same order,
    // under the same headings as `renderHtml`.
    const shown = preview().cloneNode(true) as HTMLElement
    for (const button of Array.from(shown.querySelectorAll('button'))) {
      button.remove()
    }

    const expected = document.createElement('div')
    expected.innerHTML = renderHtml(outputModel(), { credit: false })

    // Element by element rather than one blob of text: `renderHtml` joins its
    // parts with newlines and the DOM has none, so only the text *inside* each
    // heading and each entry is comparable — which is the claim anyway.
    const parts = (el: HTMLElement) =>
      Array.from(
        el.querySelectorAll(
          'h3.publist-heading, h4.publist-subheading, li.publist-item, p.publist-disclaimer',
        ),
      ).map((n) => `${n.tagName.toLowerCase()}: ${(n.textContent ?? '').replace(/\s+/g, ' ').trim()}`)
    const shape = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('*'))
        .map((n) => `${n.tagName.toLowerCase()}.${n.className}`)
        .filter((s) => s.includes('publist'))
        .join('|')

    expect(parts(shown)).toEqual(parts(expected))
    expect(parts(shown).length).toBeGreaterThan(0)
    expect(shape(shown)).toBe(shape(expected))
  })
})
