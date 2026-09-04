/**
 * The pure half of the preview's pinning UI.
 *
 * These functions carry the logic behind the drag-and-drop and the section
 * selects; jsdom cannot exercise a real drag, so this is where that behaviour
 * is pinned. `PreviewList.tsx` only translates events into these calls.
 */

import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import type { ListModel, Publication } from '@/core/types'
import {
  overlayDraftPins,
  rebuildOrderPins,
  setCategoryPin,
  type SectionRefs,
} from '../pins'
import { emptyDraft, type WizardDraft } from '../wizard'

function pub(overrides: Partial<Publication> & { key: string }): Publication {
  return {
    title: 'A title',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'J Test',
    year: 2024,
    sources: ['researchmap'],
    seedIds: ['yukifurukawa'],
    trust: 'confirmed',
    ...overrides,
  }
}

/** An English paper in a non-review journal: files under `en-original`. */
const PAPER = pub({ key: 'pmid:1', pmid: '1', language: 'en' })

/** No DOI, no PMID, no rmId: nothing a pin could name it by. */
const UNPINNABLE = pub({ key: 'title:nothing' })

function draftWith(overrides: Partial<WizardDraft>): WizardDraft {
  return { ...emptyDraft('person'), orcid: 'x', ...overrides }
}

describe('setCategoryPin', () => {
  it('writes a pin for a category the record would not file under', () => {
    const next = setCategoryPin(draftWith({}), PAPER, 'ja-review')
    expect(next.categoryPins).toEqual({ 'pmid:1': 'ja-review' })
  })

  it('keys the pin by DOI before PMID, like every other reference', () => {
    const both = pub({ key: 'doi:10.1/a', doi: '10.1/a', pmid: '9' })
    const next = setCategoryPin(draftWith({}), both, 'award')
    expect(next.categoryPins).toEqual({ 'doi:10.1/a': 'award' })
  })

  it('falls back to the researchmap achievement id', () => {
    const rmOnly = pub({ key: 'title:x', rmId: '12345' })
    const next = setCategoryPin(draftWith({}), rmOnly, 'award')
    expect(next.categoryPins).toEqual({ 'rm:12345': 'award' })
  })

  it('deletes the pin instead of storing a no-op one', () => {
    // `PAPER` files under en-original on its own; choosing that very section
    // must clear the override, not restate it — a restating pin would keep
    // overriding upstream metadata fixes for ever.
    const pinned = draftWith({ categoryPins: { 'pmid:1': 'ja-review' } })
    const next = setCategoryPin(pinned, PAPER, 'en-original')
    expect(next.categoryPins).toEqual({})
  })

  it('returns the draft untouched when nothing changes', () => {
    const clean = draftWith({})
    expect(setCategoryPin(clean, PAPER, 'en-original')).toBe(clean)
    const pinned = draftWith({ categoryPins: { 'pmid:1': 'ja-review' } })
    expect(setCategoryPin(pinned, PAPER, 'ja-review')).toBe(pinned)
  })

  it('cannot address a record with no identifier at all', () => {
    const clean = draftWith({})
    expect(setCategoryPin(clean, UNPINNABLE, 'award')).toBe(clean)
  })
})

describe('rebuildOrderPins', () => {
  const sections: SectionRefs[] = [
    { key: 'a', refs: ['pmid:1', 'pmid:2'] },
    { key: 'b', refs: ['pmid:3', 'pmid:4'] },
    { key: 'c', refs: ['pmid:5'] },
  ]

  it('writes only the touched section on the first drag', () => {
    const next = rebuildOrderPins(sections, [], 'b', ['pmid:4', 'pmid:3'])
    expect(next).toEqual(['pmid:4', 'pmid:3'])
  })

  it('keeps a previously touched section, in section order', () => {
    // Section b was reordered earlier (its refs are in the existing pins, in
    // the display order the earlier drag produced); now a is reordered.
    // Untouched c still contributes nothing.
    const next = rebuildOrderPins(
      sections,
      ['pmid:4', 'pmid:3'],
      'a',
      ['pmid:2', 'pmid:1'],
    )
    expect(next).toEqual(['pmid:2', 'pmid:1', 'pmid:3', 'pmid:4'])
  })

  it('an untouched section is ruled by the default sort, not by pins', () => {
    const next = rebuildOrderPins(sections, [], 'a', ['pmid:2', 'pmid:1'])
    expect(next).not.toContain('pmid:5')
    expect(next).not.toContain('pmid:3')
  })

  it('keeps pins whose records are hidden right now', () => {
    // pmid:9 was ordered once, then a date filter took its record off the
    // list. Narrowing the view must not erase the ordering work.
    const next = rebuildOrderPins(sections, ['pmid:9'], 'a', ['pmid:2', 'pmid:1'])
    expect(next).toEqual(['pmid:2', 'pmid:1', 'pmid:9'])
  })

  it('never writes the same ref twice', () => {
    const next = rebuildOrderPins(
      sections,
      ['pmid:1', 'pmid:3'],
      'a',
      ['pmid:2', 'pmid:1'],
    )
    expect(new Set(next).size).toBe(next.length)
  })
})

describe('overlayDraftPins', () => {
  const model: ListModel = {
    config: normalizeConfig({ seeds: { researchmap: ['yukifurukawa'] } }),
    members: [],
    publications: [PAPER],
    candidates: [],
    warnings: [],
    generatedAt: '2026-09-01T00:00:00.000Z',
  }

  it('leaves a standard draft’s model without gyoseki fields', () => {
    const out = overlayDraftPins(model, {
      taxonomy: 'standard',
      categoryPins: {},
      orderPins: [],
    })
    expect(out.config.taxonomy).toBeUndefined()
    expect(out.config.categoryPins).toBeUndefined()
    expect(out.config.orderPins).toBeUndefined()
    expect(out.publications).toBe(model.publications)
  })

  it('writes the taxonomy and categorizes every record, pins applied', () => {
    const out = overlayDraftPins(model, {
      taxonomy: 'gyoseki',
      categoryPins: { 'pmid:1': 'ja-report' },
      orderPins: ['pmid:1'],
    })
    expect(out.config.taxonomy).toBe('gyoseki')
    expect(out.config.categoryPins).toEqual(['pmid:1=ja-report'])
    expect(out.config.orderPins).toEqual(['pmid:1'])
    expect(out.publications[0].gyosekiCategory).toBe('ja-report')
  })

  it('recomputes over a baked category, so removing a pin reverts it', () => {
    // The model was built while a pin filed this paper under ja-report; the
    // pin has since been deleted from the draft. Trusting the baked field
    // would make the un-pin invisible until the next network rebuild.
    const baked: ListModel = {
      ...model,
      publications: [{ ...PAPER, gyosekiCategory: 'ja-report' as const }],
    }
    const out = overlayDraftPins(baked, {
      taxonomy: 'gyoseki',
      categoryPins: {},
      orderPins: [],
    })
    expect(out.publications[0].gyosekiCategory).toBe('en-original')
  })

  it('strips stale gyoseki fields from a model built under the old draft', () => {
    const built = {
      ...model,
      config: normalizeConfig({
        seeds: { researchmap: ['yukifurukawa'] },
        taxonomy: 'gyoseki',
        categoryPins: ['pmid:1=award'],
        orderPins: ['pmid:1'],
      }),
    }
    const out = overlayDraftPins(built, {
      taxonomy: 'standard',
      categoryPins: {},
      orderPins: [],
    })
    expect(out.config.taxonomy).toBeUndefined()
    expect(out.config.categoryPins).toBeUndefined()
    expect(out.config.orderPins).toBeUndefined()
  })
})
