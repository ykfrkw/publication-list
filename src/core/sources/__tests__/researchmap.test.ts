import { afterEach, describe, expect, it } from 'vitest'

import {
  fetchResearchmapName,
  fetchResearchmapProfile,
  fetchResearchmapWorks,
  fetchResearchmapWorksWithWarnings,
  parseResearchmapDate,
} from '../researchmap'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

const papers = loadFixture<Record<string, unknown>>('researchmap-papers.json')
const profile = loadFixture<Record<string, unknown>>('researchmap-profile.json')

/**
 * `api.researchmap.jp/yk_frkw/published_papers`, captured 2026-08-05. This
 * account writes `authors.en` GIVEN-first, which is the case that used to be
 * corrupted: `Yuki Furukawa` came out as `Yuki F`.
 */
const givenFirstPapers = loadFixture<Record<string, unknown>>(
  'researchmap-papers-given-first.json',
)
/**
 * `api.researchmap.jp/7000024045/published_papers`, captured 2026-08-05. Same
 * endpoint, opposite convention: `Osaka Ken'ichi` is family-first.
 */
const familyFirstPapers = loadFixture<Record<string, unknown>>(
  'researchmap-papers-family-first.json',
)
const familyFirstProfile = loadFixture<Record<string, unknown>>(
  'researchmap-profile-family-first.json',
)

/** ORCID 0000-0003-1317-0220 — `/person` returns the two halves separately. */
const YK_FRKW = { given: 'Yuki', family: 'Furukawa' }
/** researchmap 7000024045 — `given_name.en` / `family_name.en`. */
const OSAKA = { given: 'Kenichi', family: 'Osaka' }
/** researchmap ykanekopsy — the profile fixture next to this file. */
const KANEKO = { given: 'Yoshiyuki', family: 'Kaneko' }

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

  it('keeps names verbatim when no anchor can decide the order', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy')

    // Nothing here says whether "Rei Otsuki" means Otsuki Rei or Rei Otsuki,
    // and abbreviating on a guess renames a co-author. Held raw for OpenAlex.
    expect(pubs[0].authors[0]).toBe('Rei Otsuki')
    expect(pubs[0].authorsFull[0]).toBe('Rei Otsuki')
    expect(pubs[0].authorsSource).toBe('researchmap')
    // Names already in short form read the same under both conventions, so
    // those are still tidied rather than held back.
    expect(pubs[2].authors[0]).toBe('Furihata R')
  })

  it('uses the seed member to read this account as given-first', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    // The profile fixture for this permalink is Yoshiyuki Kaneko, and
    // "Yoshiyuki Kaneko" appears in the list given-first.
    const pubs = await fetchResearchmapWorks('ykanekopsy', { anchors: [KANEKO] })

    expect(pubs[0].authors).toEqual([
      'Otsuki R', 'Kojima Y', 'Fujii N', 'Kizuki J',
      'Kanamori T', 'Kaneko Y', 'Suzuki M',
    ])
  })

  it('accepts the anchors as a promise so the profile lookup can overlap', async () => {
    const stub = stubFetch(() => papers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('ykanekopsy', {
      anchors: Promise.resolve([KANEKO]),
    })

    expect(pubs[0].authors[0]).toBe('Otsuki R')
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

  it('reads yk_frkw as given-first and abbreviates from the right end', async () => {
    const stub = stubFetch(() => givenFirstPapers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('yk_frkw', { anchors: [YK_FRKW] })

    // Before the fix, applying the family-first formatter unconditionally gave
    // "Yuki F", "Natalia EF", "Toshiaki AF" — 25 of this account's 34 records.
    expect(pubs[0].authors).toEqual([
      'Fares-Otero NE',
      'Furukawa Y',
      'Sijbrandij M',
      'Leucht S',
      'Vieta E',
      'Cuijpers P',
      'Harrer M',
      'Seedat S',
    ])
    expect(pubs[2].authors).toEqual([
      'Furukawa Y',
      'Sakata M',
      'Furukawa TA',
      'Efthimiou O',
      'Perlis M',
    ])
    // A same-surname co-author must not be mistaken for the anchor and vote.
    expect(pubs[2].authorsFull[2]).toBe('Toshiaki A. Furukawa')
    // ORCID stores this one shouting; a single-author list still resolves.
    expect(pubs[3].authors).toEqual(['Furukawa Y'])
  })

  it('reads 7000024045 as family-first and abbreviates from the other end', async () => {
    const stub = stubFetch(() => familyFirstPapers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('7000024045', { anchors: [OSAKA] })

    // "Osaka Ken'ichi" is the anchor written family-first, so the whole list is.
    expect(pubs[0].authors).toEqual([
      'Tokuchi N',
      'Ohte N',
      'Osaka K',
      'Katsuyama M',
    ])
    expect(pubs[0].authorsFull).toEqual([
      'Tokuchi Naoko',
      'Ohte Nobuhito',
      "Osaka Ken'ichi",
      'Katsuyama Masanori',
    ])
  })

  it('survives the particle case: "van Dalfsen JH" is not "van DJ"', async () => {
    const stub = stubFetch(() => givenFirstPapers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('yk_frkw', { anchors: [YK_FRKW] })
    const shortForms = pubs[1]

    expect(shortForms.authors.slice(0, 4)).toEqual([
      'Türkmen C',
      'Schneider CL',
      'Furukawa Y',
      'van Dalfsen JH',
    ])
  })

  it('leaves authorsFull empty when researchmap only holds short forms', async () => {
    const stub = stubFetch(() => givenFirstPapers)
    restore = stub.restore

    const pubs = await fetchResearchmapWorks('yk_frkw', { anchors: [YK_FRKW] })

    // "Türkmen C" is not a full name. Storing it as one told openalex.ts and
    // crossref.ts that the full names were already known, so nothing fetched
    // them and format.ts bolded on a family name plus one initial.
    expect(pubs[1].authorsFull).toEqual([])
    expect(pubs[1].authors).toHaveLength(13)
    expect(pubs[1].authorsSource).toBe('researchmap')

    // A list where every name really is full still populates it.
    expect(pubs[0].authorsFull).toHaveLength(8)
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

describe('fetchResearchmapProfile', () => {
  it('returns the given/family split, not just the display name', async () => {
    const stub = stubFetch(() => familyFirstProfile)
    restore = stub.restore

    // The split is the point: it is the only name-order anchor a researchmap
    // seed with no ORCID alongside it can get.
    await expect(fetchResearchmapProfile('7000024045')).resolves.toEqual({
      name: 'Kenichi Osaka',
      anchor: { given: 'Kenichi', family: 'Osaka' },
    })
  })

  it('anchors on the Japanese name when the profile has no English one', async () => {
    const stub = stubFetch(() => ({
      family_name: { ja: '金子' },
      given_name: { ja: '宜之' },
    }))
    restore = stub.restore

    await expect(fetchResearchmapProfile('ykanekopsy')).resolves.toEqual({
      name: '金子 宜之',
      anchor: { given: '宜之', family: '金子' },
    })
  })

  it('has no anchor when only one half of the name is public', async () => {
    const stub = stubFetch(() => ({ family_name: { en: 'Osaka' } }))
    restore = stub.restore

    await expect(fetchResearchmapProfile('7000024045')).resolves.toEqual({
      name: 'Osaka',
    })
  })
})
