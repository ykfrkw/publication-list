/**
 * @vitest-environment jsdom
 *
 * The section select on each preview row under the gyoseki taxonomy.
 *
 * The select is the keyboard- and screen-reader-reachable spelling of the
 * cross-section drag, and the only route into a section that is currently
 * empty. The harness below wires it exactly as `App.tsx` does — the select
 * calls `setCategoryPin`, the changed draft is overlaid back onto the model by
 * `overlayDraftPins` — so what is asserted is the real round trip: choose a
 * section, the pin is written and the record moves; choose the record's
 * natural section, the pin is deleted again.
 *
 * The drag itself is not exercised here: jsdom has no layout, so dnd-kit
 * cannot measure anything. The drag's outcome functions (`rebuildOrderPins`,
 * `setCategoryPin`) are pinned in `../../lib/__tests__/pins.test.ts`.
 */

import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import { GYOSEKI_LABELS, GYOSEKI_ORDER } from '@/core/types'
import type { ListModel, Publication } from '@/core/types'
import { overlayDraftPins, setCategoryPin } from '../../lib/pins'
import { emptyDraft, type WizardDraft } from '../../lib/wizard'
import { PreviewList, UNPINNABLE_REASON } from '../PreviewList'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** An English paper in a non-review journal: files under `en-original`. */
const PAPER: Publication = {
  key: 'pmid:33782057',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ'],
  authorsFull: ['Matthew J Page'],
  journal: 'BMJ',
  year: 2021,
  pmid: '33782057',
  language: 'en',
  sources: ['orcid'],
  seedIds: ['0000-0003-1317-0220'],
  trust: 'confirmed',
  category: 'original',
}

/** Neither DOI, PMID nor rmId: no reference a pin could name it by. */
const UNPINNABLE: Publication = {
  key: 'title:aconferenceabstract',
  title: 'A conference abstract',
  authors: ['Furukawa Y'],
  authorsFull: ['Yuki Furukawa'],
  journal: 'Sleep Medicine',
  year: 2023,
  language: 'en',
  sources: ['researchmap'],
  seedIds: ['yukifurukawa'],
  trust: 'confirmed',
  category: 'original',
}

const MODEL: ListModel = {
  config: normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] } }),
  members: [],
  publications: [PAPER, UNPINNABLE],
  candidates: [],
  warnings: [],
  generatedAt: '2026-09-01T00:00:00.000Z',
}

/** The last draft the harness rendered with, readable from the tests. */
let currentDraft: WizardDraft

/** `App.tsx` in miniature: draft state, the overlay, and the two callbacks. */
function Harness() {
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    ...emptyDraft('person'),
    orcid: '0000-0003-1317-0220',
    taxonomy: 'gyoseki',
  }))
  // In an effect rather than during render, to keep the harness on the same
  // purity rules as real components; `act` flushes it before assertions run.
  useEffect(() => {
    currentDraft = draft
  }, [draft])
  const model = overlayDraftPins(MODEL, draft)
  return (
    <PreviewList
      model={model}
      onCategoryPin={(pub, category) =>
        setDraft((prev) => setCategoryPin(prev, pub, category))
      }
      onOrderPins={(orderPins) => setDraft((prev) => ({ ...prev, orderPins }))}
    />
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function rowOf(text: string): HTMLElement {
  const item = Array.from(
    container.querySelectorAll<HTMLElement>('li.publist-item'),
  ).find((li) => (li.textContent ?? '').includes(text))
  if (!item) throw new Error(`no list item containing "${text}"`)
  return item
}

function selectOf(text: string): HTMLSelectElement {
  const select = rowOf(text).querySelector('select')
  if (!select) throw new Error(`no section select on "${text}"`)
  return select
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('the section select', () => {
  it('offers all ten sections and shows where the record files now', () => {
    const select = selectOf('PRISMA')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      ...GYOSEKI_ORDER,
    ])
    expect(Array.from(select.options).map((o) => o.text)).toEqual(
      GYOSEKI_ORDER.map((category) => GYOSEKI_LABELS[category]),
    )
    expect(select.value).toBe('en-original')
  })

  it('writes the pin and moves the record on the spot', () => {
    choose(selectOf('PRISMA'), 'ja-review')

    expect(currentDraft.categoryPins).toEqual({
      'pmid:33782057': 'ja-review',
    })
    // The overlay re-filed the record: its row now sits under the 和文総説
    // heading, and the select reads back the pinned section.
    const headings = Array.from(
      container.querySelectorAll('.publist-heading'),
    ).map((h) => h.textContent)
    expect(headings).toContain(GYOSEKI_LABELS['ja-review'])
    expect(selectOf('PRISMA').value).toBe('ja-review')
  })

  it('choosing the natural section deletes the pin rather than restating it', () => {
    choose(selectOf('PRISMA'), 'ja-review')
    expect(currentDraft.categoryPins).not.toEqual({})

    choose(selectOf('PRISMA'), 'en-original')
    expect(currentDraft.categoryPins).toEqual({})
  })

  it('is disabled, with the reason, on a record no pin can name', () => {
    const select = selectOf('conference abstract')
    expect(select.disabled).toBe(true)
    const description = `${select.getAttribute('aria-label') ?? ''} ${
      select.parentElement?.getAttribute('title') ?? ''
    }`
    expect(description).toContain(UNPINNABLE_REASON)
  })
})

describe('the drag handle', () => {
  it('is present on a pinnable record and disabled with the reason otherwise', () => {
    const handle = rowOf('PRISMA').querySelector('button')
    expect(handle).not.toBeNull()
    expect(handle!.disabled).toBe(false)
    expect(handle!.getAttribute('aria-label')).toContain('Drag to reorder')

    const disabled = rowOf('conference abstract').querySelector('button')
    expect(disabled).not.toBeNull()
    expect(disabled!.disabled).toBe(true)
    const description = `${disabled!.getAttribute('aria-label') ?? ''} ${
      disabled!.parentElement?.getAttribute('title') ?? ''
    }`
    expect(description).toContain(UNPINNABLE_REASON)
  })
})
