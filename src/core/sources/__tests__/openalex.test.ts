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
  it('fills only the gaps and never overwrites a populated field', async () => {
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
