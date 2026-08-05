import { afterEach, describe, expect, it } from 'vitest'

import {
  fetchResearchmapName,
  fetchResearchmapWorks,
  fetchResearchmapWorksWithWarnings,
  parseResearchmapDate,
} from '../researchmap'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

const papers = loadFixture<Record<string, unknown>>('researchmap-papers.json')
const profile = loadFixture<Record<string, unknown>>('researchmap-profile.json')

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('parseResearchmapDate', () => {
  it('accepts YYYY, YYYY-MM and YYYY-MM-DD', () => {
    expect(parseResearchmapDate('2026-07')).toEqual({ year: 2026, month: 7 })
    expect(parseResearchmapDate('2025-02-07')).toEqual({ year: 2025, month: 2 })
    expect(parseResearchmapDate('2024')).toEqual({ year: 2024, month: undefined })
    expect(parseResearchmapDate(null)).toEqual({ year: 0 })
  })
})

describe('fetchResearchmapWorks', () => {
  it('requests published_papers with format and limit', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    await fetchResearchmapWorks('https://researchmap.jp/ykanekopsy/')

    expect(stub.calls[0]).toBe(
      'https://api.researchmap.jp/ykanekopsy/published_papers?format=json&limit=1000',
    )
  })

  it('prefers the English title and journal when both languages exist', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy')
    const bilingual = pubs[1]

    expect(bilingual.title).toBe(
      'Association between daytime sleepiness and quality of life in outpatients with schizophrenia.',
    )
    // publication_name.ja is "Sleep and Biological Rhythms," — the en value wins.
    expect(bilingual.journal).toBe('Sleep and biological rhythms')
    expect(bilingual.language).toBe('en')
  })

  it('reads identifiers out of their arrays and tolerates a null identifiers block', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy')

    expect(pubs[0].doi).toBe('10.1007/s41105-026-00635-x')
    expect(pubs[0].pmid).toBe('42367617')
    expect(pubs[0].key).toBe('doi:10.1007/s41105-026-00635-x')

    // identifiers is literally `null` on this record.
    expect(pubs[2].doi).toBeUndefined()
    expect(pubs[2].pmid).toBeUndefined()
    expect(pubs[2].key.startsWith('title:')).toBe(true)
  })

  it('formats authors.en family-first (Japanese convention)', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy')

    // "Rei Otsuki" is stored family-first, so it must become "Rei O", not "Otsuki R".
    expect(pubs[0].authors[0]).toBe('Rei O')
    expect(pubs[0].authorsFull[0]).toBe('Rei Otsuki')
    // Names already in short form are passed through.
    expect(pubs[2].authors[0]).toBe('Furihata R')
  })

  it('marks a Japanese-only record as ja and leaves its names unabbreviated', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy')
    const japanese = pubs[3]

    expect(japanese.title).toBe('包括的なヘルスリテラシーとマンモグラフィ検診受診の関連')
    expect(japanese.journal).toBe('総合健診')
    expect(japanese.language).toBe('ja')
    expect(japanese.year).toBe(2026)
    expect(japanese.month).toBe(3)
    // Initialising 田口 良子 to "田口 良" would be wrong.
    expect(japanese.authors).toEqual(['田口 良子', '中山 和弘'])
    expect(japanese.authorsFull).toEqual(['田口 良子', '中山 和弘'])
    expect(japanese.sources).toEqual(['researchmap'])
    expect(japanese.trust).toBe('confirmed')
    expect(japanese.seedIds).toEqual(['ykanekopsy'])
  })

  it('warns instead of throwing on an unknown permalink', async () => {
    const stub = stubFetch(() => httpStatusResponse(404, { error: 'not_found' }))
    restore = stub.restore

    const result = await fetchResearchmapWorksWithWarnings('nobody')
    expect(result.publications).toEqual([])
    expect(result.warnings[0]).toContain('researchmap nobody')
  })
})

describe('fetchResearchmapName', () => {
  it('builds "Given Family" from the English name', async () => {
    const stub = stubFetch(() => profile)
    restore = stub.restore

    await expect(fetchResearchmapName('ykanekopsy')).resolves.toBe('Yoshiyuki Kaneko')
    expect(stub.calls[0]).toBe('https://api.researchmap.jp/ykanekopsy?format=json')
  })

  it('falls back to the Japanese 姓 名 order', async () => {
    const stub = stubFetch(() => ({
      family_name: { ja: '金子' },
      given_name: { ja: '宜之' },
    }))
    restore = stub.restore

    await expect(fetchResearchmapName('ykanekopsy')).resolves.toBe('金子 宜之')
  })
})
