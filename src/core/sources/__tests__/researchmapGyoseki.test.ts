import { afterEach, describe, expect, it } from 'vitest'

import { parseResearchmapPaper } from '../researchmap'
import { fetchResearchmapGyosekiWithWarnings } from '../researchmapGyoseki'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

/**
 * Fixture provenance (see the `_fixture_note` inside each file):
 * - `researchmap-misc.json` — `api.researchmap.jp/yk_frkw/misc` (2026-09-05)
 *   plus one `hikida` item carrying `misc_type`;
 * - `researchmap-books.json` — `yk_frkw`, `ykanekopsy` and `7000024045`
 *   books_etc items, covering every `book_owner_role` observed live
 *   (single_work, contributor, others, joint_translation, joint_work, absent);
 * - `researchmap-presentations.json` — `yk_frkw` (public_discourse) and
 *   `ykanekopsy` (oral/poster) items;
 * - `researchmap-awards.json` — `yk_frkw` (bilingual) and `ykanekopsy`
 *   (ja-only, one year-only date) awards;
 * - `researchmap-misc-page1/2.json` — a real `limit=2` pagination pair from
 *   `ykanekopsy/misc` (the page-2 `next` link removed so the pair ends).
 */
const misc = loadFixture<Record<string, unknown>>('researchmap-misc.json')
const books = loadFixture<Record<string, unknown>>('researchmap-books.json')
const presentations = loadFixture<Record<string, unknown>>(
  'researchmap-presentations.json',
)
const awards = loadFixture<Record<string, unknown>>('researchmap-awards.json')
const miscPage1 = loadFixture<Record<string, unknown>>('researchmap-misc-page1.json')
const miscPage2 = loadFixture<Record<string, unknown>>('researchmap-misc-page2.json')

/** ORCID 0000-0003-1317-0220 — the yk_frkw seed member's name halves. */
const YK_FRKW = { given: 'Yuki', family: 'Furukawa' }

const EMPTY_PAGE = { total_items: 0, items: [] }

type Items = { items: Array<Record<string, unknown>> }

/** Route by endpoint; anything unrouted gets an empty page. */
function routes(byEndpoint: Partial<Record<string, unknown>>) {
  return (url: string): unknown => {
    for (const [endpoint, body] of Object.entries(byEndpoint)) {
      if (url.includes(`/${endpoint}?`)) return body
    }
    return EMPTY_PAGE
  }
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('fetchResearchmapGyosekiWithWarnings', () => {
  it('requests the four endpoints with format and limit', async () => {
    const stub = stubFetch(routes({}))
    restore = stub.restore

    await fetchResearchmapGyosekiWithWarnings('https://researchmap.jp/yk_frkw/')

    expect(stub.calls.sort()).toEqual(
      ['misc', 'books_etc', 'presentations', 'awards']
        .map((ep) => `https://api.researchmap.jp/yk_frkw/${ep}?format=json&limit=1000`)
        .sort(),
    )
  })

  it('warns on an empty permalink without fetching', async () => {
    const stub = stubFetch(routes({}))
    restore = stub.restore

    const result = await fetchResearchmapGyosekiWithWarnings('   ')
    expect(result.publications).toEqual([])
    expect(result.warnings).toEqual(['researchmap: empty permalink'])
    expect(stub.calls).toEqual([])
  })

  it('maps each endpoint onto its kind', async () => {
    const stub = stubFetch(
      routes({ misc, books_etc: books, presentations, awards }),
    )
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')
    const kinds = new Map<string | undefined, number>()
    for (const pub of publications) {
      kinds.set(pub.kind, (kinds.get(pub.kind) ?? 0) + 1)
    }

    // misc stays kind-less: absent means 'paper', and cached records rely on it.
    expect(kinds.get(undefined)).toBe(4)
    expect(kinds.get('book')).toBe(6)
    expect(kinds.get('presentation')).toBe(5)
    expect(kinds.get('award')).toBe(3)
  })
})

describe('misc', () => {
  it('goes through the shared paper parser and is flagged fromMisc', async () => {
    const stub = stubFetch(routes({ misc }))
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw', {
      anchors: [YK_FRKW],
    })
    const vortioxetine = publications[0]

    expect(vortioxetine.fromMisc).toBe(true)
    expect(vortioxetine.rmId).toBe('52219039')
    expect(vortioxetine.kind).toBeUndefined()
    // Keyed like any paper: DOI outranks the rm id.
    expect(vortioxetine.key).toBe('doi:10.1111/pcn.13732')
    expect(vortioxetine.language).toBe('en')
    expect(vortioxetine.journal).toBe('Psychiatry and Clinical Neurosciences')
    // The anchor reads this account as given-first, exactly as it does for
    // published_papers.
    expect(vortioxetine.authors).toEqual(['Furukawa Y'])
    expect(vortioxetine.authorsFull).toEqual(['Yuki Furukawa'])
    expect(vortioxetine.authorsSource).toBe('researchmap')
    expect(vortioxetine.trust).toBe('confirmed')
    expect(vortioxetine.sources).toEqual(['researchmap'])
    expect(vortioxetine.seedIds).toEqual(['yk_frkw'])
  })

  it('matches parseResearchmapPaper field for field on the same input', async () => {
    const stub = stubFetch(routes({ misc }))
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw', {
      anchors: [YK_FRKW],
    })
    const items = (misc as unknown as Items).items
    const viaPaperParser = parseResearchmapPaper(items[2], 'yk_frkw', [YK_FRKW])

    const { fromMisc, rmId, ...rest } = publications[2]
    expect(fromMisc).toBe(true)
    expect(rmId).toBe('52217920')
    expect(rest).toEqual(viaPaperParser)
  })

  it('keeps misc_type verbatim and omits it when absent', async () => {
    const stub = stubFetch(routes({ misc }))
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')

    expect(publications[3].miscType).toBe('summary_international_conference')
    expect(publications[0].miscType).toBeUndefined()
  })
})

describe('books_etc', () => {
  async function fetchBooks() {
    const stub = stubFetch(routes({ books_etc: books }))
    restore = stub.restore
    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')
    return publications
  }

  it('maps title, publisher, role, range, isbn and rm-key', async () => {
    const [kokoro] = await fetchBooks()

    expect(kokoro.kind).toBe('book')
    expect(kokoro.key).toBe('rm:54195029')
    expect(kokoro.rmId).toBe('54195029')
    expect(kokoro.title).toBe('こころの科学')
    expect(kokoro.publisher).toBe('日本評論社')
    expect(kokoro.bookRole).toBe('contributor')
    expect(kokoro.bookRange).toBe(
      '「眠れない」に向き合う ——不眠症治療の第一選択・不眠の認知行動療法を手に',
    )
    // identifiers.isbn is an array; the first entry wins.
    expect(kokoro.isbn).toBe('9784535141483')
    expect(kokoro.year).toBe(2026)
    expect(kokoro.month).toBe(7)
    // A ja-only title is a Japanese-language book.
    expect(kokoro.language).toBe('ja')
    expect(kokoro.trust).toBe('confirmed')
    expect(kokoro.sources).toEqual(['researchmap'])
  })

  it('leaves authors empty when the item has none, without an authorsSource', async () => {
    const [kokoro] = await fetchBooks()

    expect(kokoro.authors).toEqual([])
    expect(kokoro.authorsFull).toEqual([])
    expect(kokoro.authorsSource).toBeUndefined()
  })

  it('keeps Japanese author names verbatim via the shared author parsing', async () => {
    const publications = await fetchBooks()
    const nekoronde = publications[2]

    expect(nekoronde.bookRole).toBe('single_work')
    expect(nekoronde.authors).toEqual(['古川 由己'])
    expect(nekoronde.authorsFull).toEqual(['古川 由己'])
    expect(nekoronde.authorsSource).toBe('researchmap')
  })

  it('prefers the English title but the Japanese publisher, en range as fallback', async () => {
    const publications = await fetchBooks()
    const cecil = publications[4]

    expect(cecil.title).toBe('Goldman-Cecil Medicine')
    expect(cecil.language).toBe('en')
    expect(cecil.publisher).toBe('エルゼビア・ジャパン')
    expect(cecil.bookRole).toBe('joint_translation')
    // book_owner_range has only an en half on this record.
    expect(cecil.bookRange).toBe('Psychiatric Disorders in Medical Practice.')
  })

  it('tolerates an absent book_owner_role and an absent isbn', async () => {
    const publications = await fetchBooks()
    const guideline = publications[3]

    expect(guideline.bookRole).toBeUndefined()
    expect(guideline.isbn).toBeUndefined()
    expect(guideline.authors).toEqual(['気分障害の治療ガイドライン検討委員会', '双極性障害委員会'])
  })
})

describe('presentations', () => {
  async function fetchPresentations(fixture: unknown = presentations) {
    const stub = stubFetch(routes({ presentations: fixture }))
    restore = stub.restore
    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')
    return publications
  }

  it('maps title, event, type and invited', async () => {
    const publications = await fetchPresentations()
    const [seminar, oxford] = [publications[0], publications[1]]

    expect(seminar.kind).toBe('presentation')
    expect(seminar.key).toBe('rm:51665682')
    expect(seminar.title).toBe('システマティック・レビューとネットワーク・メタ分析')
    expect(seminar.eventJa).toBe('第25回 日本認知療法・認知行動療法学会')
    expect(seminar.event).toBeUndefined()
    expect(seminar.presentationType).toBe('public_discourse')
    expect(seminar.invited).toBe(true)
    expect(seminar.language).toBe('ja')
    expect(seminar.authors).toEqual(['古川由己'])

    expect(oxford.title).toBe('CBT for Insomnia: Ingredients, Indications, and Implementation')
    expect(oxford.event).toBe('Oxford Psychiatry Seminar Series')
    expect(oxford.eventJa).toBeUndefined()
    expect(oxford.language).toBe('en')
  })

  it('falls back to the title heuristic when languages is absent', async () => {
    const publications = await fetchPresentations()
    const chubu = publications[2]

    expect(chubu.language).toBe('ja')
    expect(chubu.invited).toBe(true)
  })

  it('lets languages[0] override the ja-only-title heuristic', async () => {
    const altered = structuredClone(presentations) as unknown as Items
    // A Japanese-titled talk delivered in English: 51665682 with eng declared.
    altered.items[0].languages = ['eng']

    const publications = await fetchPresentations(altered)
    expect(publications[0].language).toBe('en')
  })

  it('passes invited: false through, and leaves it unset when absent', async () => {
    const altered = structuredClone(presentations) as unknown as Items
    delete altered.items[3].invited

    const publications = await fetchPresentations(altered)
    const [oral, poster] = [publications[3], publications[4]]

    expect(oral.presentationType).toBe('oral_presentation')
    expect(oral.invited).toBeUndefined()
    expect(poster.presentationType).toBe('poster_presentation')
    // The live records carry invited: false explicitly; false is not "unset".
    expect(poster.invited).toBe(false)
  })
})

describe('awards', () => {
  async function fetchAwards() {
    const stub = stubFetch(routes({ awards }))
    restore = stub.restore
    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')
    return publications
  }

  it('prefers the Japanese award name and association', async () => {
    const [insomnia] = await fetchAwards()

    expect(insomnia.kind).toBe('award')
    expect(insomnia.key).toBe('rm:53667839')
    // ja first — the reverse of every other title preference.
    expect(insomnia.title).toBe('若手研究者賞')
    expect(insomnia.awardAssociation).toBe('欧州不眠症学会')
    expect(insomnia.year).toBe(2026)
    expect(insomnia.month).toBe(5)
    expect(insomnia.authors).toEqual([])
    expect(insomnia.authorsFull).toEqual([])
    expect(insomnia.authorsSource).toBeUndefined()
  })

  it('accepts a year-only award_date', async () => {
    const publications = await fetchAwards()
    const scholarship = publications[2]

    expect(scholarship.year).toBe(2022)
    expect(scholarship.month).toBeUndefined()
    expect(scholarship.awardAssociation).toBe('日本大学医学部')
  })
})

describe('rmId and key fallbacks', () => {
  it('reads rmId from the @id tail when rm:id is missing', async () => {
    const altered = structuredClone(awards) as unknown as Items
    delete altered.items[0]['rm:id']
    const stub = stubFetch(routes({ awards: altered }))
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')

    expect(publications[0].rmId).toBe('53667839')
    expect(publications[0].key).toBe('rm:53667839')
  })

  it('falls back to a title key when neither id exists', async () => {
    const altered = structuredClone(awards) as unknown as Items
    delete altered.items[0]['rm:id']
    delete altered.items[0]['@id']
    const stub = stubFetch(routes({ awards: altered }))
    restore = stub.restore

    const { publications } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')

    expect(publications[0].rmId).toBeUndefined()
    // titleSlug is Unicode-aware, so the Japanese title survives.
    expect(publications[0].key).toBe('title:若手研究者賞')
  })
})

describe('pagination', () => {
  it('follows _links.next.href, re-appending format=json', async () => {
    const stub = stubFetch((url) => {
      if (url === 'https://api.researchmap.jp/ykanekopsy/misc?format=json&limit=1000') {
        return miscPage1
      }
      if (url === 'https://api.researchmap.jp/ykanekopsy/misc?start=3&limit=2&format=json') {
        return miscPage2
      }
      return EMPTY_PAGE
    })
    restore = stub.restore

    const { publications, warnings } =
      await fetchResearchmapGyosekiWithWarnings('ykanekopsy')

    // Two real pages of two items each; the API's own next href had no
    // format=json parameter (captured verbatim in the page-1 fixture).
    expect(publications.filter((p) => p.fromMisc)).toHaveLength(4)
    expect(publications.map((p) => p.rmId)).toContain('54755005')
    expect(warnings).toEqual([])
  })

  it('stops after ten pages and says which endpoint was capped', async () => {
    const loopingPage = {
      total_items: 12000,
      items: [(misc as unknown as Items).items[0]],
      _links: {
        next: { href: 'https://api.researchmap.jp/yk_frkw/misc?start=1&limit=1000' },
      },
    }
    const stub = stubFetch(routes({ misc: loopingPage }))
    restore = stub.restore

    const { publications, warnings } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')

    expect(stub.calls.filter((u) => u.includes('/misc?'))).toHaveLength(10)
    expect(publications.filter((p) => p.fromMisc)).toHaveLength(10)
    expect(warnings).toEqual([
      'researchmap yk_frkw misc: stopped after 10 pages (12000 items total)',
    ])
  })
})

describe('per-endpoint failure isolation', () => {
  it('keeps the other three endpoints when one fails', async () => {
    const stub = stubFetch((url) => {
      // 404 rather than 500: getJson does not retry a 4xx, so the test is fast.
      if (url.includes('/books_etc?')) return httpStatusResponse(404, { error: 'not_found' })
      if (url.includes('/misc?')) return misc
      if (url.includes('/presentations?')) return presentations
      if (url.includes('/awards?')) return awards
      return EMPTY_PAGE
    })
    restore = stub.restore

    const { publications, warnings } = await fetchResearchmapGyosekiWithWarnings('yk_frkw')

    expect(publications.some((p) => p.kind === 'book')).toBe(false)
    expect(publications.filter((p) => p.fromMisc)).toHaveLength(4)
    expect(publications.filter((p) => p.kind === 'presentation')).toHaveLength(5)
    expect(publications.filter((p) => p.kind === 'award')).toHaveLength(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('researchmap yk_frkw books_etc:')
  })
})
