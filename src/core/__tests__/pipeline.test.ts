/**
 * `buildList` end-to-end, with `globalThis.fetch` stubbed and the same
 * fixtures the source-level tests use.
 *
 * The upstream requests are serialized behind rate limiters (350 ms for
 * PubMed, 400 ms for Crossref), so each test gets a generous timeout.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { normalizeConfig } from '../config'
import {
  buildList,
  isShortFormName,
  mergeMembers,
  resolveBoldNames,
  triageCandidates,
} from '../pipeline'
import type { Member, Publication } from '../types'
import type { FetchStub } from '../sources/__tests__/helpers'
import { loadFixture, stubFetch } from '../sources/__tests__/helpers'

const TIMEOUT = 20_000

const ORCID = '0000-0003-1317-0220'
const RESEARCHMAP = 'ykanekopsy'

interface RouteOverrides {
  orcidPerson?: unknown
  orcidWorks?: unknown
  researchmapProfile?: unknown
  researchmapPapers?: unknown
  esearch?: unknown
  esummary?: unknown
  openalex?: unknown
  crossref?: unknown
}

/**
 * Route a request URL to a fixture.
 *
 * OpenAlex and Crossref default to empty answers so that enrichment is a no-op
 * unless a test opts into it — otherwise every assertion would depend on what
 * a captured OpenAlex page happens to contain.
 */
function makeRouter(o: RouteOverrides = {}) {
  return (url: string): unknown => {
    if (url.includes('pub.orcid.org')) {
      return url.includes('/person')
        ? (o.orcidPerson ?? loadFixture('orcid-person.json'))
        : (o.orcidWorks ?? loadFixture('orcid-works.json'))
    }
    if (url.includes('api.researchmap.jp')) {
      return url.includes('published_papers')
        ? (o.researchmapPapers ?? loadFixture('researchmap-papers.json'))
        : (o.researchmapProfile ?? loadFixture('researchmap-profile.json'))
    }
    if (url.includes('esearch.fcgi')) {
      return o.esearch ?? loadFixture('pubmed-esearch.json')
    }
    if (url.includes('esummary.fcgi')) {
      return o.esummary ?? loadFixture('pubmed-esummary.json')
    }
    if (url.includes('api.openalex.org')) return o.openalex ?? { results: [] }
    if (url.includes('api.crossref.org')) return o.crossref ?? { message: {} }
    throw new Error(`unrouted request: ${url}`)
  }
}

interface ESummaryFixture {
  result: Record<string, unknown> & { uids: string[] }
}

/** The captured esummary trimmed down to a single record. */
function singleSummary(uid: string): ESummaryFixture {
  const fixture = loadFixture<ESummaryFixture>('pubmed-esummary.json')
  for (const other of fixture.result.uids) {
    if (other !== uid) delete fixture.result[other]
  }
  fixture.result.uids = [uid]
  return fixture
}

let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

function useRoutes(overrides: RouteOverrides = {}) {
  stub = stubFetch(makeRouter(overrides))
  return stub
}

describe('buildList — trust assignment', () => {
  it(
    'treats every ORCID works record as confirmed',
    async () => {
      useRoutes()
      // `preprints: 'include'` because this test is about *trust*, and two of
      // the four fixture records are preprints that the default policy would
      // hold back. Their exclusion has its own tests below.
      const model = await buildList(
        normalizeConfig({ seeds: { orcid: [ORCID] }, preprints: 'include' }),
      )

      expect(model.publications.length).toBe(4)
      expect(model.publications.every((p) => p.trust === 'confirmed')).toBe(true)
      expect(model.candidates).toEqual([])
      expect(model.members).toEqual([
        { id: ORCID, name: 'Yuki Furukawa', orcid: ORCID },
      ])
    },
    TIMEOUT,
  )

  it(
    'treats every researchmap record as confirmed',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({ seeds: { researchmap: [RESEARCHMAP] } }),
      )

      expect(model.publications.length).toBeGreaterThan(0)
      expect(model.publications.every((p) => p.trust === 'confirmed')).toBe(true)
      expect(model.candidates).toEqual([])
      expect(model.members[0].name).toBe('Yoshiyuki Kaneko')
    },
    TIMEOUT,
  )

  it(
    'leaves a PubMed author-name query as a candidate',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({ seeds: { pubmed: [{ query: 'Furukawa Y[au]' }] } }),
      )

      expect(model.candidates.length).toBe(3)
      expect(model.candidates.every((p) => p.trust === 'candidate')).toBe(true)
      // reviewPolicy defaults to 'strict': unreviewed hits stay off the page.
      expect(model.publications).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'promotes an [auid] PubMed query to confirmed',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({
          seeds: { pubmed: [{ query: `${ORCID}[auid]` }] },
        }),
      )

      expect(model.publications.length).toBe(3)
      expect(model.publications.every((p) => p.trust === 'confirmed')).toBe(true)
      expect(model.candidates).toEqual([])
    },
    TIMEOUT,
  )
})

describe('buildList — seed profiles and author-name order', () => {
  it(
    'uses the ORCID name split to read a researchmap author list',
    async () => {
      // yk_frkw writes authors.en given-first; the family-first formatter used
      // to turn "Yuki Furukawa" into "Yuki F" on 25 of its 34 records.
      useRoutes({
        // orcid-person.json IS 0000-0003-1317-0220, captured from /person.
        orcidWorks: { group: [] },
        researchmapPapers: loadFixture('researchmap-papers-given-first.json'),
      })

      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID], researchmap: ['yk_frkw'] },
        }),
      )

      const mdma = model.publications.find((p) =>
        p.doi === '10.1016/j.euroneuro.2026.112802',
      )
      expect(mdma?.authors.slice(0, 2)).toEqual(['Fares-Otero NE', 'Furukawa Y'])
    },
    TIMEOUT,
  )

  it(
    'skips the researchmap profile once ORCID has supplied the name and the split',
    async () => {
      useRoutes({
        // orcid-person.json IS 0000-0003-1317-0220, captured from /person.
        orcidWorks: { group: [] },
        researchmapPapers: loadFixture('researchmap-papers-given-first.json'),
      })

      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID], researchmap: ['yk_frkw'] },
        }),
      )

      // ~2 s and ~60 KB for two fields ORCID already gave us.
      const profileCalls = stub!.calls.filter(
        (url) => url.includes('api.researchmap.jp') && !url.includes('published_papers'),
      )
      expect(profileCalls).toEqual([])
      // The saving must not cost the member merge: still one person, not two.
      expect(model.members).toEqual([
        {
          id: ORCID,
          name: 'Yuki Furukawa',
          orcid: ORCID,
          researchmap: 'yk_frkw',
        },
      ])
    },
    TIMEOUT,
  )

  it(
    'still fetches the researchmap profile when it is the only anchor available',
    async () => {
      useRoutes()

      const model = await buildList(
        normalizeConfig({ seeds: { researchmap: [RESEARCHMAP] } }),
      )

      const profileCalls = stub!.calls.filter(
        (url) => url.includes('api.researchmap.jp') && !url.includes('published_papers'),
      )
      expect(profileCalls).toHaveLength(1)
      // And the anchor it carries is what makes the names readable.
      expect(model.publications.some((p) => p.authors.includes('Otsuki R'))).toBe(true)
    },
    TIMEOUT,
  )

  it(
    'does not skip the profile for boldNames alone — that leaves no anchor',
    async () => {
      useRoutes()

      await buildList(
        normalizeConfig({
          seeds: { researchmap: [RESEARCHMAP] },
          boldNames: ['Yoshiyuki Kaneko'],
        }),
      )

      const profileCalls = stub!.calls.filter(
        (url) => url.includes('api.researchmap.jp') && !url.includes('published_papers'),
      )
      expect(profileCalls).toHaveLength(1)
    },
    TIMEOUT,
  )

  it(
    'lets OpenAlex supply the full names researchmap only had short forms for',
    async () => {
      useRoutes({
        // orcid-person.json IS 0000-0003-1317-0220, captured from /person.
        orcidWorks: { group: [] },
        researchmapPapers: loadFixture('researchmap-papers-given-first.json'),
        openalex: loadFixture('openalex-works-short-form.json'),
      })

      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID], researchmap: ['yk_frkw'] },
          boldNames: ['Yuki Furukawa'],
        }),
      )

      const cbti = model.publications.find((p) =>
        p.doi === '10.1093/sleepadvances/zpaf070',
      )
      // researchmap only had "Furukawa Y" here, which cannot tell Yuki from
      // Yuri — so the bold decision had nothing to work with.
      expect(cbti?.authorsFull[2]).toBe('Yuki Furukawa')
      expect(cbti?.authors[3]).toBe('van Dalfsen JH')
    },
    TIMEOUT,
  )
})

describe('buildList — include / exclude', () => {
  it(
    'builds a list from pinned references alone, with no seeds at all',
    async () => {
      useRoutes({ esummary: singleSummary('41062142') })
      const model = await buildList(
        normalizeConfig({ seeds: {}, include: ['pmid:41062142'] }),
      )

      expect(model.publications.length).toBe(1)
      expect(model.publications[0].pmid).toBe('41062142')
      expect(model.publications[0].trust).toBe('confirmed')
      expect(model.members).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'materializes a pinned DOI that no seed produced',
    async () => {
      useRoutes({
        openalex: {
          results: [
            {
              doi: 'https://doi.org/10.1136/bmj.n71',
              ids: {
                doi: 'https://doi.org/10.1136/bmj.n71',
                pmid: 'https://pubmed.ncbi.nlm.nih.gov/33782057',
              },
              type: 'review',
              title: 'The PRISMA 2020 statement',
              publication_year: 2021,
              publication_date: '2021-03-29',
              primary_location: { source: { display_name: 'BMJ' } },
              authorships: [{ author: { display_name: 'Matthew J. Page' } }],
            },
          ],
        },
      })

      const model = await buildList(
        normalizeConfig({ seeds: {}, include: ['doi:10.1136/bmj.n71'] }),
      )

      expect(model.publications.length).toBe(1)
      expect(model.publications[0].title).toBe('The PRISMA 2020 statement')
      expect(model.publications[0].journal).toBe('BMJ')
      expect(model.publications[0].trust).toBe('confirmed')

      // …and does not then ask OpenAlex for the same DOI a second time. The pin
      // lookup already copied every field the enrichment stage would copy.
      const doiRequests = stub!.calls.filter((url) =>
        url.includes('api.openalex.org') && url.includes('filter=doi:'),
      )
      expect(doiRequests).toHaveLength(1)
    },
    TIMEOUT,
  )

  it(
    'force-promotes a pinned record that a seed already found as a candidate',
    async () => {
      useRoutes({ esummary: singleSummary('39199005') })
      const model = await buildList(
        normalizeConfig({
          seeds: { pubmed: [{ query: 'Furukawa Y[au]' }] },
          include: ['pmid:39199005'],
        }),
      )

      expect(model.publications.length).toBe(1)
      expect(model.publications[0].pmid).toBe('39199005')
      expect(model.publications[0].trust).toBe('confirmed')
    },
    TIMEOUT,
  )

  it(
    'drops an excluded record outright',
    async () => {
      useRoutes()
      const excluded = '10.1016/j.euroneuro.2026.112802'
      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID] },
          exclude: [`doi:${excluded}`],
          preprints: 'include',
        }),
      )

      expect(model.publications.length).toBe(3)
      expect(model.publications.some((p) => p.doi === excluded)).toBe(false)
      expect(model.candidates.some((p) => p.doi === excluded)).toBe(false)
    },
    TIMEOUT,
  )
})

describe('buildList — review policy', () => {
  it(
    'keeps candidates out of publications under the strict default',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID], pubmed: [{ query: 'Furukawa Y[au]' }] },
          preprints: 'include',
        }),
      )

      expect(model.candidates.length).toBe(3)
      expect(model.publications.length).toBe(4)
      expect(model.publications.every((p) => p.trust === 'confirmed')).toBe(true)
    },
    TIMEOUT,
  )

  it(
    'promotes candidates into publications under auto, and still lists them',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID], pubmed: [{ query: 'Furukawa Y[au]' }] },
          reviewPolicy: 'auto',
          preprints: 'include',
        }),
      )

      expect(model.publications.length).toBe(7)
      // Still visible in the queue, so the wizard can show what it accepted.
      expect(model.candidates.length).toBe(3)
      for (const candidate of model.candidates) {
        expect(model.publications).toContain(candidate)
      }
    },
    TIMEOUT,
  )
})

describe('buildList — preprints', () => {
  it(
    'holds preprints back by default and says how many, by name',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({ seeds: { orcid: [ORCID] } }),
      )

      // The ORCID fixture carries four works, two of which categorize as
      // preprints: one typed `preprint`, and one F1000Research article that
      // Crossref does not report as referee-approved.
      expect(model.publications.length).toBe(2)
      expect(model.publications.some((p) => p.category === 'preprint')).toBe(false)

      const warning = model.warnings.find((w) => w.includes('preprint'))
      expect(warning).toBeDefined()
      expect(warning).toContain('Held back 2 preprint(s)')
      expect(warning).toContain("preprints: 'include'")
      // Named, not just counted: a vanished record the author cannot identify
      // is indistinguishable from a bug.
      expect(warning).toContain('Initial treatment choices for long term remission')
      // The open-review clause only appears because one of the two held-back
      // records really is an F1000-family article awaiting referees.
      expect(warning).toContain('open-review journal')
    },
    TIMEOUT,
  )

  it(
    'says nothing about preprints when there are none to hold back',
    async () => {
      useRoutes({ esummary: singleSummary('41062142') })
      const model = await buildList(
        normalizeConfig({ seeds: {}, include: ['pmid:41062142'] }),
      )

      expect(model.publications.length).toBeGreaterThan(0)
      expect(model.warnings.some((w) => w.includes('Held back'))).toBe(false)
    },
    TIMEOUT,
  )

  it(
    "restores them under preprints: 'include', in their own category",
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({ seeds: { orcid: [ORCID] }, preprints: 'include' }),
      )

      expect(model.publications.length).toBe(4)
      expect(model.publications.filter((p) => p.category === 'preprint').length).toBe(2)
      expect(model.warnings.some((w) => w.includes('Held back'))).toBe(false)
    },
    TIMEOUT,
  )

  it(
    'excludes them before the limit is applied, so a limit still fills up',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({ seeds: { orcid: [ORCID] }, limit: 2 }),
      )

      expect(model.publications.length).toBe(2)
      expect(model.publications.some((p) => p.category === 'preprint')).toBe(false)
    },
    TIMEOUT,
  )
})

describe('buildList — filtering', () => {
  it(
    'filters by the YYYY-MM date range, treating a missing month as January',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID] },
          from: '2025-01',
          to: '2025-12',
          preprints: 'include',
        }),
      )

      expect(model.publications.map((p) => p.year)).toEqual([2025, 2025])
      expect(model.publications.map((p) => p.month)).toEqual([10, 9])
    },
    TIMEOUT,
  )

  it(
    'applies limit after sorting, newest first',
    async () => {
      useRoutes()
      const model = await buildList(
        normalizeConfig({
          seeds: { orcid: [ORCID] },
          limit: 2,
          preprints: 'include',
        }),
      )

      expect(model.publications.length).toBe(2)
      expect(model.publications[0].year).toBe(2026)
      expect(model.publications[1].year).toBe(2025)
    },
    TIMEOUT,
  )
})

describe('buildList — categorization', () => {
  it(
    'reports errata instead of dropping them silently',
    async () => {
      useRoutes({
        openalex: {
          results: [
            {
              doi: 'https://doi.org/10.1000/erratum-x',
              ids: { doi: 'https://doi.org/10.1000/erratum-x' },
              type: 'erratum',
              title: 'Erratum: something was wrong',
              publication_year: 2024,
              primary_location: { source: { display_name: 'Journal of Tests' } },
              authorships: [],
            },
          ],
        },
      })

      const model = await buildList(
        normalizeConfig({ seeds: {}, include: ['doi:10.1000/erratum-x'] }),
      )

      expect(model.publications).toEqual([])
      expect(
        model.warnings.some((w) => /erratum or paratext/.test(w)),
      ).toBe(true)
      expect(model.warnings.some((w) => w.includes('Excluded 1 record'))).toBe(
        true,
      )
    },
    TIMEOUT,
  )
})

describe('buildList — progress and warnings', () => {
  it(
    'reports progress and finishes at 100',
    async () => {
      useRoutes()
      const seen: [number, string][] = []
      await buildList(normalizeConfig({ seeds: { orcid: [ORCID] } }), {
        onProgress: (pct, message) => seen.push([pct, message]),
      })

      expect(seen.length).toBeGreaterThan(3)
      expect(seen[0][0]).toBe(2)
      expect(seen[seen.length - 1][0]).toBe(100)
      // Monotonically non-decreasing, so a progress bar never runs backwards.
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0])
      }
    },
    TIMEOUT,
  )

  it(
    'surfaces an upstream failure as a warning instead of an empty page',
    async () => {
      stub = stubFetch((url) => {
        if (url.includes('pub.orcid.org') && url.includes('/works')) {
          return new Response('nope', { status: 404 })
        }
        return makeRouter()(url)
      })

      const model = await buildList(
        normalizeConfig({ seeds: { orcid: [ORCID] } }),
      )

      expect(model.publications).toEqual([])
      expect(model.warnings.some((w) => w.includes('404'))).toBe(true)
    },
    TIMEOUT,
  )
})

describe('buildList — bold-name disambiguation', () => {
  const DOI = ['10.1000/one', '10.1000/two', '10.1000/three']

  function doc(uid: string, doi: string, coauthor: string) {
    return {
      uid,
      pubdate: '2024 Jan',
      source: 'BMJ',
      title: `Paper ${uid}`,
      authors: [
        { name: 'Furukawa Y', authtype: 'Author' },
        { name: coauthor, authtype: 'Author' },
      ],
      lang: ['eng'],
      pubtype: ['Journal Article'],
      articleids: [
        { idtype: 'pubmed', value: uid },
        { idtype: 'doi', value: doi },
      ],
    }
  }

  const esearch = {
    esearchresult: { count: '3', idlist: ['1', '2', '3'] },
  }
  const esummary = {
    result: {
      uids: ['1', '2', '3'],
      '1': doc('1', DOI[0], 'Cipriani A'),
      '2': doc('2', DOI[1], 'Salanti G'),
      '3': doc('3', DOI[2], 'Efthimiou O'),
    },
  }

  /** OpenAlex knows the full names of #1 and #3, but has never seen #2. */
  function openAlexWork(doi: string, first: string, second: string) {
    return {
      doi: `https://doi.org/${doi}`,
      ids: { doi: `https://doi.org/${doi}` },
      type: 'article',
      title: `Paper ${doi}`,
      publication_year: 2024,
      primary_location: { source: { display_name: 'BMJ' } },
      authorships: [
        { author: { display_name: first } },
        { author: { display_name: second } },
      ],
    }
  }

  const openalex = {
    results: [
      openAlexWork(DOI[0], 'Yuki Furukawa', 'Andrea Cipriani'),
      openAlexWork(DOI[2], 'Yuri Furukawa', 'Orestis Efthimiou'),
    ],
  }

  it(
    'fires a targeted Crossref lookup only for the record with no full names',
    async () => {
      const active = useRoutes({
        esearch,
        esummary,
        openalex,
        crossref: {
          message: {
            author: [
              { given: 'Yuki', family: 'Furukawa' },
              { given: 'Georgia', family: 'Salanti' },
            ],
          },
        },
      })

      const model = await buildList(
        normalizeConfig({
          seeds: { pubmed: [{ query: `${ORCID}[auid]` }] },
          boldNames: ['Yuki Furukawa'],
        }),
      )

      const crossrefCalls = active.calls.filter((u) =>
        u.includes('api.crossref.org'),
      )
      // One serialized request per DOI: only the ambiguous record may pay it.
      expect(crossrefCalls.length).toBe(1)
      expect(crossrefCalls[0]).toContain(encodeURIComponent(DOI[1]))

      const enriched = model.publications.find((p) => p.doi === DOI[1])
      expect(enriched?.authorsFull).toEqual(['Yuki Furukawa', 'Georgia Salanti'])
      // Resolved, so no "spell it out" warning.
      expect(model.warnings.some((w) => w.includes('Bold name'))).toBe(false)
    },
    TIMEOUT,
  )

  it(
    'warns when the ambiguity survives the Crossref lookup',
    async () => {
      useRoutes({
        esearch,
        esummary,
        openalex,
        // Crossref knows nothing about #2 either.
        crossref: { message: { author: [] } },
      })

      const model = await buildList(
        normalizeConfig({
          seeds: { pubmed: [{ query: `${ORCID}[auid]` }] },
          boldNames: ['Yuki Furukawa'],
        }),
      )

      const warning = model.warnings.find((w) => w.includes('Bold name'))
      expect(warning).toBeDefined()
      expect(warning).toContain('Yuki Furukawa')
      expect(warning).toContain('Spell the name out in full')
    },
    TIMEOUT,
  )
})

// ─────────────────────────────────────────────────────── pure helpers ──

describe('mergeMembers', () => {
  it('merges rows that resolve to the same normalized name', () => {
    const merged = mergeMembers([
      { id: ORCID, orcid: ORCID, name: 'Yuki Furukawa' },
      { id: RESEARCHMAP, researchmap: RESEARCHMAP, name: 'YUKI  FURUKAWA' },
    ])

    expect(merged).toEqual([
      {
        id: ORCID,
        name: 'Yuki Furukawa',
        orcid: ORCID,
        researchmap: RESEARCHMAP,
      },
    ])
  })

  it('keeps members without a Latin name distinct', () => {
    const members: Member[] = [
      { id: 'a', researchmap: 'a', name: '古川由己' },
      { id: 'b', researchmap: 'b', name: '金子宜之' },
      { id: 'c', researchmap: 'c' },
    ]
    expect(mergeMembers(members).length).toBe(3)
  })
})

describe('resolveBoldNames', () => {
  const members: Member[] = [{ id: ORCID, orcid: ORCID, name: 'Yuki Furukawa' }]

  it('defaults to the full names of the resolved members', () => {
    expect(resolveBoldNames(undefined, members)).toEqual(['Yuki Furukawa'])
  })

  it('upgrades a configured short form to the member full name', () => {
    expect(resolveBoldNames(['Furukawa Y'], members)).toEqual(['Yuki Furukawa'])
  })

  it('keeps a name that matches no member', () => {
    expect(resolveBoldNames(['Jane Roe'], members)).toEqual(['Jane Roe'])
  })
})

describe('isShortFormName', () => {
  it('recognizes short forms and bare surnames', () => {
    expect(isShortFormName('Furukawa Y')).toBe(true)
    expect(isShortFormName('Furukawa')).toBe(true)
    expect(isShortFormName('Yuki Furukawa')).toBe(false)
    expect(isShortFormName('Annemieke van Straten')).toBe(false)
  })
})

describe('triageCandidates', () => {
  function pub(over: Partial<Publication>): Publication {
    return {
      key: over.key ?? 'k',
      title: 'T',
      authors: [],
      authorsFull: [],
      journal: 'J',
      year: 2024,
      sources: ['pubmed'],
      seedIds: [],
      trust: 'candidate',
      ...over,
    }
  }

  it('pre-selects a candidate sharing a co-author with the confirmed set', () => {
    const confirmed = [
      pub({ key: 'c1', authors: ['Furukawa Y', 'Cipriani A'], trust: 'confirmed' }),
    ]
    const candidates = [
      pub({ key: 'x', authors: ['Furukawa Y', 'Cipriani A'] }),
      pub({ key: 'y', authors: ['Furukawa Y', 'Nobody Z'] }),
    ]

    expect(triageCandidates(confirmed, candidates, ['Yuki Furukawa'])).toEqual([
      'x',
    ])
  })

  it('ignores the researcher’s own name, which every hit shares', () => {
    const confirmed = [pub({ key: 'c1', authors: ['Furukawa Y'], trust: 'confirmed' })]
    const candidates = [pub({ key: 'x', authors: ['Furukawa Y'] })]

    expect(triageCandidates(confirmed, candidates, ['Yuki Furukawa'])).toEqual([])
  })

  it('pre-selects on a shared affiliation token', () => {
    const confirmed = [
      pub({
        key: 'c1',
        authors: ['Someone A'],
        affiliations: ['The University of Tokyo'],
        trust: 'confirmed',
      }),
    ]
    const candidates = [
      pub({ key: 'x', authors: ['Other B'], affiliations: ['University of Tokyo Hospital'] }),
    ]

    expect(triageCandidates(confirmed, candidates, [])).toEqual(['x'])
  })
})
