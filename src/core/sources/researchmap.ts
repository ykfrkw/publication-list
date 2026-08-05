/**
 * researchmap API (`api.researchmap.jp`) — new port of
 * `publication-list-generator/R/fetch_researchmap.R`.
 *
 * researchmap is the only seed that reliably carries Japanese-language
 * journal articles, which is why it exists in this project at all: ORCID and
 * PubMed between them miss most 和文誌 output.
 *
 * Response shape (measured 2026-08-05, the API is thinly documented):
 *
 * ```jsonc
 * { "total_items": 32,
 *   "items": [{
 *     "paper_title":      { "en": "...", "ja": "..." },  // either key may be absent
 *     "authors":          { "en": [{ "name": "Rei Otsuki" }], "ja": [...] },
 *     "publication_name": { "en": "Sleep and biological rhythms" },
 *     "publication_date": "2026-07",                     // YYYY | YYYY-MM | YYYY-MM-DD
 *     "languages":        ["eng"],                       // ISO 639-2/B, may be absent
 *     "published_paper_type": "scientific_journal",
 *     "identifiers":      { "doi": ["10.…"], "pm_id": ["42367617"] }  // arrays!
 *   }] }
 * ```
 *
 * Three shapes bite:
 * - every bilingual field is an object keyed `en` / `ja`, and *either* key can
 *   be missing (not empty — missing);
 * - `identifiers.*` values are arrays, not scalars;
 * - `authors.en` is **not** a normalized field. Its order is per-account
 *   (`yk_frkw` writes `Yuki Furukawa`, `7000024045` writes `Osaka Ken'ichi`),
 *   and it happily holds short forms (`Türkmen C`, `Osaka, K.`) that are not
 *   full names at all. Both are handled below rather than assumed away.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import { normalizeDoi, normalizeResearchmapId, pubKey, stripDoiVersion } from '../ids'
import type { Publication } from '../types'
import { errorMessage, getJson } from './http'
import {
  detectNameOrder,
  formatAuthorFamilyFirst,
  formatAuthorShort,
  isFullPersonName,
} from './names'
import type { PersonNameAnchor } from './names'

const RESEARCHMAP_BASE = 'https://api.researchmap.jp'
/** researchmap paginates; 1000 covers any realistic personal record. */
const PAPER_LIMIT = 1000

interface Bilingual {
  en?: string | null
  ja?: string | null
}

interface BilingualAuthors {
  en?: Array<{ name?: string | null }> | null
  ja?: Array<{ name?: string | null }> | null
}

interface ResearchmapPaper {
  paper_title?: Bilingual | null
  publication_name?: Bilingual | null
  authors?: BilingualAuthors | null
  publication_date?: string | null
  languages?: string[] | null
  published_paper_type?: string | null
  identifiers?: Record<string, string[] | undefined> | null
}

interface ResearchmapPapersResponse {
  total_items?: number
  items?: ResearchmapPaper[] | null
}

interface ResearchmapProfileResponse {
  permalink?: string
  family_name?: Bilingual | null
  given_name?: Bilingual | null
}

export interface ResearchmapWorksResult {
  publications: Publication[]
  warnings: string[]
}

export interface ResearchmapFetchOptions {
  signal?: AbortSignal
  /**
   * People whose given/family split is known independently (ORCID `/person`,
   * a researchmap profile). Used to measure the order of each `authors.en`
   * list. Without one, author names are kept verbatim.
   *
   * A promise is accepted so the caller can start this request *before* the
   * anchors are known — parsing needs them, the HTTP round trip does not, and
   * a researchmap profile lookup is slow enough (~2 s) to be worth overlapping.
   */
  anchors?: readonly PersonNameAnchor[] | Promise<readonly PersonNameAnchor[]>
}

/** Given/family display name pulled off a researchmap profile. */
export interface ResearchmapProfile {
  /** `Given Family` in English, or `姓 名` in Japanese. */
  name?: string
  /** Only set when the profile carries both halves in the same script. */
  anchor?: PersonNameAnchor
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** English first, Japanese as the fallback — matches `R/fetch_researchmap.R`. */
function preferEnglish(field: Bilingual | null | undefined): string {
  const en = clean(field?.en)
  return en !== '' ? en : clean(field?.ja)
}

function firstIdentifier(
  identifiers: Record<string, string[] | undefined> | null | undefined,
  key: string,
): string | undefined {
  const values = identifiers?.[key]
  if (!Array.isArray(values)) return undefined
  for (const value of values) {
    const v = clean(value)
    if (v !== '') return v
  }
  return undefined
}

const LANGUAGE_MAP: Record<string, string> = {
  eng: 'en',
  jpn: 'ja',
  ger: 'de',
  fre: 'fr',
  chi: 'zh',
  kor: 'ko',
}

/** `YYYY`, `YYYY-MM` and `YYYY-MM-DD` all appear in the wild. */
export function parseResearchmapDate(raw: string | null | undefined): {
  year: number
  month?: number
} {
  const value = clean(raw)
  if (value === '') return { year: 0 }
  const year = Number.parseInt(value.slice(0, 4), 10)
  const monthText = value.length >= 7 ? value.slice(5, 7) : ''
  const month = monthText === '' ? Number.NaN : Number.parseInt(monthText, 10)
  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : undefined,
  }
}

/**
 * Short forms (`Türkmen C`) into `authors`, full names (`Yuki Furukawa`) into
 * `authorsFull`, and nothing that is not actually full into the latter.
 *
 * researchmap mixes the two in the same `authors.en` field — 11 of `yk_frkw`'s
 * 34 records hold short forms there. Copying those into `authorsFull` is what
 * stopped OpenAlex from ever supplying the real names.
 */
function splitFullNames(names: string[]): string[] {
  return names.every((n) => isFullPersonName(n)) ? [...names] : []
}

/** One `items[]` entry → `Publication`. Exported for the unit tests. */
export function parseResearchmapPaper(
  item: ResearchmapPaper,
  permalink: string,
  anchors: readonly PersonNameAnchor[] = [],
): Publication | undefined {
  const titleEn = clean(item.paper_title?.en)
  const titleJa = clean(item.paper_title?.ja)
  const title = titleEn !== '' ? titleEn : titleJa
  const rawDoi = firstIdentifier(item.identifiers, 'doi')
  const pmid = firstIdentifier(item.identifiers, 'pm_id')
  if (title === '' && !rawDoi && !pmid) return undefined

  const doi = rawDoi ? normalizeDoi(rawDoi) : undefined
  const doiVersion = doi ? stripDoiVersion(doi).version : undefined
  const { year, month } = parseResearchmapDate(item.publication_date)

  // Authors. Which way round `authors.en` is written varies by account, so the
  // order is measured against the seed member's own name rather than assumed
  // (see `detectNameOrder`). A record with only `authors.ja` keeps its names
  // verbatim — initialising 田口 良子 to "田口 良" would be wrong.
  const authorsEn = (item.authors?.en ?? []).map((a) => clean(a.name)).filter((n) => n !== '')
  const authorsJa = (item.authors?.ja ?? []).map((a) => clean(a.name)).filter((n) => n !== '')

  let authors: string[]
  let authorsFull: string[]
  if (authorsEn.length === 0) {
    authors = [...authorsJa]
    authorsFull = splitFullNames(authorsJa)
  } else {
    const order = detectNameOrder(authorsEn, anchors)
    if (order === 'given-first') {
      authors = authorsEn.map((n) => formatAuthorShort(n))
    } else if (order === 'family-first') {
      authors = authorsEn.map((n) => formatAuthorFamilyFirst(n))
    } else if (authorsEn.every((n) => !isFullPersonName(n))) {
      // Every name is already `Family I`; both formatters agree on those, so
      // this is a tidy-up rather than a guess about the order.
      authors = authorsEn.map((n) => formatAuthorShort(n))
    } else {
      // No anchor, or the list contradicts itself. Abbreviating now would be a
      // coin flip that silently renames every co-author, so keep the raw
      // strings and let OpenAlex enrichment replace them (see `authorsSource`).
      authors = [...authorsEn]
    }
    authorsFull = splitFullNames(authorsEn)
  }

  // Language: an item with no English title at all is a Japanese-language
  // paper, whatever `languages` claims. Otherwise trust `languages[0]`.
  const declared = LANGUAGE_MAP[clean(item.languages?.[0]).toLowerCase()]
  let language: string | undefined
  if (titleEn === '' && titleJa !== '') language = 'ja'
  else language = declared ?? (titleEn !== '' ? 'en' : undefined)

  return {
    key: pubKey({ title, doi, pmid }),
    title,
    authors,
    authorsFull,
    // Marks these names as the weakest kind: the order may be undetermined and
    // the "full" list may be empty. `openalex.ts` uses this to upgrade rather
    // than merely fill.
    authorsSource: 'researchmap',
    journal: preferEnglish(item.publication_name),
    year,
    month,
    doi,
    doiVersion,
    pmid,
    language,
    orcidType: clean(item.published_paper_type) || undefined,
    sources: ['researchmap'],
    seedIds: [permalink],
    trust: 'confirmed',
  }
}

/** Fetch a researchmap `published_papers` record, with the failure reason. */
export async function fetchResearchmapWorksWithWarnings(
  permalink: string,
  opts: ResearchmapFetchOptions = {},
): Promise<ResearchmapWorksResult> {
  const { signal } = opts
  const id = normalizeResearchmapId(permalink)
  if (id === '') return { publications: [], warnings: ['researchmap: empty permalink'] }

  try {
    const data = await getJson<ResearchmapPapersResponse>(
      `${RESEARCHMAP_BASE}/${encodeURIComponent(id)}/published_papers?format=json&limit=${PAPER_LIMIT}`,
      { signal },
    )
    const anchors = (await opts.anchors) ?? []
    const publications: Publication[] = []
    for (const item of data.items ?? []) {
      const pub = parseResearchmapPaper(item, id, anchors)
      if (pub) publications.push(pub)
    }
    return { publications, warnings: [] }
  } catch (err) {
    if (signal?.aborted) throw err
    return { publications: [], warnings: [`researchmap ${id}: ${errorMessage(err)}`] }
  }
}

/** `fetchResearchmapWorksWithWarnings` without the warnings. */
export async function fetchResearchmapWorks(
  permalink: string,
  opts: ResearchmapFetchOptions = {},
): Promise<Publication[]> {
  const { publications } = await fetchResearchmapWorksWithWarnings(permalink, opts)
  return publications
}

/**
 * Display name **and** given/family split from a researchmap profile.
 *
 * Both halves matter: the name is what the wizard shows, and the split is the
 * only name-order anchor available for a researchmap seed that has no ORCID
 * alongside it.
 *
 * This request costs ~2 s and returns ~60–200 KB to extract two fields, so
 * `pipeline.ts` skips it whenever an ORCID seed has already supplied both.
 */
export async function fetchResearchmapProfile(
  permalink: string,
  signal?: AbortSignal,
): Promise<ResearchmapProfile> {
  const id = normalizeResearchmapId(permalink)
  if (id === '') return {}

  try {
    const data = await getJson<ResearchmapProfileResponse>(
      `${RESEARCHMAP_BASE}/${encodeURIComponent(id)}?format=json`,
      { signal },
    )
    const familyEn = clean(data.family_name?.en)
    const givenEn = clean(data.given_name?.en)
    if (familyEn !== '' && givenEn !== '') {
      return {
        name: `${givenEn} ${familyEn}`,
        anchor: { given: givenEn, family: familyEn },
      }
    }

    const familyJa = clean(data.family_name?.ja)
    const givenJa = clean(data.given_name?.ja)
    if (familyJa !== '' && givenJa !== '') {
      return {
        name: `${familyJa} ${givenJa}`,
        anchor: { given: givenJa, family: familyJa },
      }
    }

    const name = familyEn || familyJa || givenEn || givenJa
    return name === '' ? {} : { name }
  } catch (err) {
    if (signal?.aborted) throw err
    return {}
  }
}

/**
 * Display name from a researchmap profile: `Given Family` in English, or the
 * Japanese `姓 名` when the profile has no English name.
 */
export async function fetchResearchmapName(
  permalink: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const { name } = await fetchResearchmapProfile(permalink, signal)
  return name
}
