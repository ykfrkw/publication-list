import { afterEach, describe, expect, it } from 'vitest'

import {
  ESUMMARY_CHUNK_SIZE,
  fetchPubmedSummaries,
  fetchPubmedSummariesWithWarnings,
  isAuidQuery,
  mapPubmedLanguage,
  parsePubmedDate,
  pubmedTypeToken,
  searchPubmed,
  searchPubmedWithWarnings,
} from '../pubmed'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

const esearch = loadFixture<Record<string, unknown>>('pubmed-esearch.json')
const esummary = loadFixture<Record<string, unknown>>('pubmed-esummary.json')

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('isAuidQuery', () => {
  it('recognises ORCID author-identifier queries only', () => {
    expect(isAuidQuery('0000-0003-1317-0220[auid]')).toBe(true)
    expect(isAuidQuery('  0000-0003-1317-0220[auid]  ')).toBe(true)
    expect(isAuidQuery('Furukawa Y[au]')).toBe(false)
    expect(isAuidQuery('0000-0003-1317-0220[auid] AND 2024[dp]')).toBe(false)
  })
})

describe('parsePubmedDate', () => {
  it('handles the shapes E-utilities emits', () => {
    expect(parsePubmedDate('2026 Jun 10')).toEqual({ year: 2026, month: 6 })
    expect(parsePubmedDate('2026 Jun')).toEqual({ year: 2026, month: 6 })
    expect(parsePubmedDate('2026')).toEqual({ year: 2026 })
    expect(parsePubmedDate('2026 Jun-Jul')).toEqual({ year: 2026, month: 6 })
    expect(parsePubmedDate('2026 Winter')).toEqual({ year: 2026 })
    expect(parsePubmedDate('2026/06/10 00:00')).toEqual({ year: 2026, month: 6 })
    expect(parsePubmedDate(undefined)).toEqual({ year: 0 })
  })
})

describe('mapPubmedLanguage / pubmedTypeToken', () => {
  it('maps the language codes the contract names', () => {
    expect(mapPubmedLanguage('jpn')).toBe('ja')
    expect(mapPubmedLanguage('eng')).toBe('en')
    expect(mapPubmedLanguage('xyz')).toBe('xyz')
    expect(mapPubmedLanguage(undefined)).toBeUndefined()
  })

  it('collapses pubtype[] to one categorizable token', () => {
    expect(pubmedTypeToken(['Journal Article', 'Letter'])).toBe('letter')
    expect(pubmedTypeToken(['Editorial'])).toBe('editorial')
    expect(pubmedTypeToken(['Journal Article', 'Meta-Analysis'])).toBe('review')
    expect(pubmedTypeToken(['English Abstract', 'Journal Article'])).toBe('journal-article')
    expect(pubmedTypeToken([])).toBeUndefined()
  })
})

describe('searchPubmed', () => {
  it('returns the idlist and sends tool= but never email= or api_key=', async () => {
    const stub = stubFetch(() => esearch)
    restore = stub.restore

    const pmids = await searchPubmed('0000-0003-1317-0220[auid]', { retmax: 50 })

    expect(pmids).toHaveLength(10)
    expect(pmids[0]).toBe('41062142')

    const url = stub.calls[0]
    expect(url).toContain('esearch.fcgi')
    expect(url).toContain('db=pubmed')
    expect(url).toContain('retmode=json')
    expect(url).toContain('retmax=50')
    expect(url).toContain('tool=publication-list-generator')
    expect(url).not.toContain('email=')
    expect(url).not.toContain('api_key=')
  })

  it('surfaces an esearch error as a warning rather than throwing', async () => {
    const stub = stubFetch(() => ({ esearchresult: { error: 'Invalid field' } }))
    restore = stub.restore

    const result = await searchPubmedWithWarnings('bogus[nope]')
    expect(result.pmids).toEqual([])
    expect(result.warnings[0]).toContain('Invalid field')
  })
})

describe('fetchPubmedSummaries', () => {
  it('parses esummary documents', async () => {
    const stub = stubFetch(() => esummary)
    restore = stub.restore

    const pubs = await fetchPubmedSummaries(['41062142', '39199005', '42270380'], {
      seedIds: ['0000-0003-1317-0220[auid]'],
      trust: 'confirmed',
    })

    expect(pubs).toHaveLength(3)
    const first = pubs[0]
    expect(first.pmid).toBe('41062142')
    expect(first.journal).not.toBe('')
    expect(first.authors.length).toBeGreaterThan(0)
    // esummary gives short forms already; full names need OpenAlex.
    expect(first.authors[0]).toMatch(/^[^\s]+ [A-Z]+$/)
    expect(first.authorsFull).toEqual([])
    expect(first.sources).toEqual(['pubmed'])
    expect(first.seedIds).toEqual(['0000-0003-1317-0220[auid]'])
    expect(first.trust).toBe('confirmed')

    // pubtype lands in orcidType — the only "type the seed reported" slot the
    // Publication contract has — so categorize.ts can use it.
    expect(pubs.find((p) => p.pmid === '39199005')?.orcidType).toBe('letter')

    const url = stub.calls[0]
    expect(url).toContain('esummary.fcgi')
    expect(url).toContain('tool=publication-list-generator')
    expect(url).not.toContain('email=')
    expect(url).not.toContain('api_key=')
  })

  it('maps a Japanese-language record to language "ja"', async () => {
    const stub = stubFetch(() => esummary)
    restore = stub.restore

    const pubs = await fetchPubmedSummaries(['42270380'])
    const japanese = pubs.find((p) => p.pmid === '42270380')

    expect(japanese).toBeDefined()
    expect(japanese?.language).toBe('ja')
    expect(japanese?.journal).toBe('Nihon Koshu Eisei Zasshi')
    expect(japanese?.title).toContain('[Factors affecting insomnia')
    expect(japanese?.year).toBe(2026)
    expect(japanese?.month).toBe(6)
    expect(japanese?.doi).toBe('10.11236/jph.25-142')
    expect(japanese?.orcidType).toBe('journal-article')
    expect(japanese?.authors).toEqual(['Shimada K', 'Iwasa H'])
    // Trust defaults to candidate — the pipeline decides otherwise.
    expect(japanese?.trust).toBe('candidate')
  })

  it('chunks at 200 PMIDs per request', async () => {
    const pmids = Array.from({ length: 250 }, (_, i) => String(30000000 + i))
    const stub = stubFetch(() => ({ result: { uids: [] } }))
    restore = stub.restore

    await fetchPubmedSummaries(pmids)

    expect(ESUMMARY_CHUNK_SIZE).toBe(200)
    expect(stub.calls).toHaveLength(2)
    const idsOf = (url: string) =>
      (new URL(url).searchParams.get('id') ?? '').split(',').filter((s) => s !== '')
    expect(idsOf(stub.calls[0])).toHaveLength(200)
    expect(idsOf(stub.calls[1])).toHaveLength(50)
  })

  it('keeps the surviving chunk when one chunk fails', async () => {
    const pmids = Array.from({ length: 250 }, (_, i) => String(30000000 + i))
    let call = 0
    const stub = stubFetch(() => {
      call += 1
      if (call === 1) return httpStatusResponse(400, { error: 'bad request' })
      return esummary
    })
    restore = stub.restore

    const result = await fetchPubmedSummariesWithWarnings(pmids)

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('PubMed summaries')
    expect(result.publications).toHaveLength(3)
  })
})
