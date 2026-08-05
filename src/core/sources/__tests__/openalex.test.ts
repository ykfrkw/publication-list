import { afterEach, describe, expect, it } from 'vitest'

import { pubKey } from '../../ids'
import type { Publication } from '../../types'
import {
  OPENALEX_CHUNK_SIZE,
  TITLE_SEARCH_LIMIT,
  enrichByDoi,
  enrichByDoiWithWarnings,
  enrichByPmid,
  enrichByTitleWithWarnings,
} from '../openalex'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

interface OpenAlexFixture {
  results: Array<Record<string, unknown>>
}

const works = loadFixture<OpenAlexFixture>('openalex-works.json')
/**
 * `works?filter=doi:10.1093/sleepadvances/zpaf070`, captured 2026-08-05 — the
 * record researchmap supplies as `Türkmen C`, `van Dalfsen JH` and so on.
 */
const shortFormWork = loadFixture<OpenAlexFixture>('openalex-works-short-form.json')

function pub(overrides: Partial<Publication> & Pick<Publication, 'title'>): Publication {
  const base: Publication = {
    key: '',
    authors: [],
    authorsFull: [],
    journal: '',
    year: 0,
    sources: ['orcid'],
    seedIds: ['seed'],
    trust: 'confirmed',
    ...overrides,
  }
  return { ...base, key: base.key || pubKey(base) }
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('enrichByDoi', () => {
  // NARROWED 2026-08-05. This used to read "never overwrites a populated
  // field", which is still true of every scalar and of an author list that is
  // full and aligned — the case asserted below. It is NOT true of author names
  // in general any more: a populated `authorsFull` full of short forms, or one
  // that came from researchmap, is now upgraded rather than preserved. That
  // rule change has its own tests further down; this one pins the half that
  // still holds, because "OpenAlex must not win over a curated seed record" is
  // the reason this module exists.
  it('fills only the gaps, and never overwrites a populated scalar or a usable author list', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const input = [
      // Journal and authors already curated by the seed: OpenAlex must not win.
      pub({
        title: 'The PRISMA 2020 statement',
        journal: 'The BMJ (seed value)',
        authors: ['Page MJ'],
        authorsFull: ['Matthew Page'],
        doi: '10.1136/bmj.n71',
        pmid: '99999999',
        year: 2021,
        month: 3,
        openAlexType: 'article',
      }),
      // Nothing but a DOI: everything should be filled in.
      pub({ title: '', doi: '10.1007/s41105-026-00635-x' }),
    ]

    const out = await enrichByDoi(input)

    expect(out[0].journal).toBe('The BMJ (seed value)')
    expect(out[0].authors).toEqual(['Page MJ'])
    expect(out[0].authorsFull).toEqual(['Matthew Page'])
    expect(out[0].pmid).toBe('99999999')
    expect(out[0].openAlexType).toBe('article')
    expect(out[0].year).toBe(2021)
    expect(out[0].month).toBe(3)

    expect(out[1].journal).toBe('Sleep and Biological Rhythms')
    expect(out[1].openAlexType).toBe('article')
    expect(out[1].pmid).toBe('42367617')
    expect(out[1].authorsFull[0]).toBe('Rei Otsuki')
    expect(out[1].authors[0]).toBe('Otsuki R')
    expect(out[1].year).toBe(2026)
    expect(out[1].month).toBe(2)

    // The input array is not mutated.
    expect(input[1].journal).toBe('')
  })

  it('upgrades short forms that were stored as full names', async () => {
    const stub = stubFetch(() => shortFormWork)
    restore = stub.restore

    // Exactly what researchmap used to hand over for this DOI: `Türkmen C` and
    // friends parked in `authorsFull`, which made every downstream consumer
    // believe the full names were already known.
    const input = [
      pub({
        title: 'Cognitive behavioral therapy for insomnia as a suicide prevention strategy',
        authors: ['Türkmen C', 'Schneider CL', 'Furukawa Y', 'van Dalfsen JH'],
        authorsFull: ['Türkmen C', 'Schneider CL', 'Furukawa Y', 'van Dalfsen JH'],
        doi: '10.1093/sleepadvances/zpaf070',
      }),
    ]

    const out = await enrichByDoi(input)

    expect(out[0].authorsFull.slice(0, 4)).toEqual([
      'Cagdas Türkmen',
      'Carlotta L. Schneider',
      'Yuki Furukawa',
      'Jens H. van Dalfsen',
    ])
    // Replaced together, so the two arrays stay index-aligned — format.ts stops
    // bolding anyone the moment they diverge.
    expect(out[0].authors).toHaveLength(out[0].authorsFull.length)
    expect(out[0].authors.slice(0, 4)).toEqual([
      'Türkmen C',
      'Schneider CL',
      'Furukawa Y',
      'van Dalfsen JH',
    ])
    expect(out[0].authorsSource).toBe('openalex')
  })

  it('upgrades researchmap-derived names even when they look full', async () => {
    const stub = stubFetch(() => shortFormWork)
    restore = stub.restore

    // Raw researchmap strings of undetermined order: full-looking, but nothing
    // established whether they read given-first or family-first.
    const input = [
      pub({
        title: 'Cognitive behavioral therapy for insomnia as a suicide prevention strategy',
        authors: ['Cagdas Türkmen', 'Carlotta L. Schneider'],
        authorsFull: ['Cagdas Türkmen', 'Carlotta L. Schneider'],
        authorsSource: 'researchmap',
        doi: '10.1093/sleepadvances/zpaf070',
      }),
    ]

    const out = await enrichByDoi(input)

    expect(out[0].authors[0]).toBe('Türkmen C')
    expect(out[0].authorsSource).toBe('openalex')
  })

  it('leaves researchmap names alone when OpenAlex has none to offer', async () => {
    const stub = stubFetch(() => ({ results: [{ doi: 'https://doi.org/10.1/x', authorships: [] }] }))
    restore = stub.restore

    const out = await enrichByDoi([
      pub({
        title: 'x',
        authors: ['Otsuki R'],
        authorsFull: ['Rei Otsuki'],
        authorsSource: 'researchmap',
        doi: '10.1/x',
      }),
    ])

    expect(out[0].authors).toEqual(['Otsuki R'])
    expect(out[0].authorsFull).toEqual(['Rei Otsuki'])
  })

  it('does not re-request a DOI whose record was already built from OpenAlex', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const out = await enrichByDoi(
      [
        pub({ title: 'Pinned', doi: '10.1136/bmj.n71' }),
        pub({ title: 'Seeded', doi: '10.1007/s41105-026-00635-x' }),
      ],
      undefined,
      { skipDois: new Set(['10.1136/bmj.n71']) },
    )

    const filter = decodeURIComponent(new URL(stub.calls[0]).searchParams.get('filter') ?? '')
    expect(stub.calls).toHaveLength(1)
    expect(filter).toBe('doi:10.1007/s41105-026-00635-x')
    expect(out[0].journal).toBe('')
  })

  it('makes no request at all when every DOI is already enriched', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    await enrichByDoi([pub({ title: 'Pinned', doi: '10.1136/bmj.n71' })], undefined, {
      skipDois: new Set(['10.1136/bmj.n71']),
    })

    expect(stub.calls).toHaveLength(0)
  })

  it('sends a select= projection and no mailto', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    await enrichByDoi([pub({ title: 'x', doi: '10.1136/bmj.n71' })])

    const url = stub.calls[0]
    expect(url).toContain('https://api.openalex.org/works?filter=doi:')
    expect(url).toContain('per-page=50')
    expect(url).toContain('select=id,doi,ids,type,title')
    expect(url).not.toContain('mailto')
  })

  it('chunks at 50 DOIs per request', async () => {
    const stub = stubFetch(() => ({ results: [] }))
    restore = stub.restore

    const input = Array.from({ length: 120 }, (_, i) =>
      pub({ title: `Paper ${i}`, doi: `10.1234/test.${i}` }),
    )

    const out = await enrichByDoi(input)

    expect(OPENALEX_CHUNK_SIZE).toBe(50)
    expect(stub.calls).toHaveLength(3)
    const doiCount = (url: string) =>
      decodeURIComponent(new URL(url).searchParams.get('filter') ?? '')
        .replace(/^doi:/, '')
        .split('|').length
    expect(doiCount(stub.calls[0])).toBe(50)
    expect(doiCount(stub.calls[1])).toBe(50)
    expect(doiCount(stub.calls[2])).toBe(20)
    expect(out).toHaveLength(120)
  })

  it('makes no request when nothing has a DOI', async () => {
    const stub = stubFetch(() => ({ results: [] }))
    restore = stub.restore

    await enrichByDoi([pub({ title: 'No identifiers at all' })])
    expect(stub.calls).toHaveLength(0)
  })

  it('warns instead of throwing when a batch fails', async () => {
    const stub = stubFetch(() => httpStatusResponse(403, { error: 'forbidden' }))
    restore = stub.restore

    const result = await enrichByDoiWithWarnings([pub({ title: 'x', doi: '10.1136/bmj.n71' })])

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('OpenAlex doi batch')
    expect(result.publications[0].journal).toBe('')
  })
})

describe('enrichByPmid', () => {
  it('matches on ids.pmid and re-keys a title-keyed record once a DOI appears', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const input = [pub({ title: 'Whatever', pmid: '42367617' })]
    expect(input[0].key).toBe('pmid:42367617')

    const out = await enrichByPmid(input)

    expect(stub.calls[0]).toContain('filter=ids.pmid:42367617')
    expect(out[0].journal).toBe('Sleep and Biological Rhythms')
    // enrichByPmid never sets a DOI, so the key is unchanged.
    expect(out[0].key).toBe('pmid:42367617')
  })
})

describe('enrichByTitleWithWarnings', () => {
  it('accepts the top hit only when the slugged titles match exactly', async () => {
    const stub = stubFetch(() => ({ results: [works.results[0]] }))
    restore = stub.restore

    const good = pub({
      title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
    })
    const bad = pub({ title: 'Something entirely different' })

    const result = await enrichByTitleWithWarnings([good, bad])

    expect(stub.calls).toHaveLength(2)
    expect(stub.calls[0]).toContain('filter=title.search:')
    expect(result.publications[0].doi).toBe('10.1136/bmj.n71')
    expect(result.publications[0].key).toBe('doi:10.1136/bmj.n71')
    expect(result.publications[1].doi).toBeUndefined()
    expect(result.publications[1].journal).toBe('')
  })

  it('caps the number of lookups and says so', async () => {
    const stub = stubFetch(() => ({ results: [] }))
    restore = stub.restore

    const input = Array.from({ length: 25 }, (_, i) => pub({ title: `Untitled ${i}` }))
    const result = await enrichByTitleWithWarnings(input)

    expect(TITLE_SEARCH_LIMIT).toBe(20)
    expect(stub.calls).toHaveLength(20)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('only the first 20')
  })

  it('skips records that already have a DOI or a PMID', async () => {
    const stub = stubFetch(() => ({ results: [] }))
    restore = stub.restore

    await enrichByTitleWithWarnings([
      pub({ title: 'Has doi', doi: '10.1/x' }),
      pub({ title: 'Has pmid', pmid: '123' }),
    ])

    expect(stub.calls).toHaveLength(0)
  })
})
