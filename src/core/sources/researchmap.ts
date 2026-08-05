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
 * Two shapes bite:
 * - every bilingual field is an object keyed `en` / `ja`, and *either* key can
 *   be missing (not empty — missing);
 * - `identifiers.*` values are arrays, not scalars.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import { normalizeDoi, normalizeResearchmapId, pubKey, stripDoiVersion } from '../ids'
import type { Publication } from '../types'
import { errorMessage, getJson } from './http'
import { formatAuthorFamilyFirst } from './names'

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

/** One `items[]` entry → `Publication`. Exported for the unit tests. */
export function parseResearchmapPaper(
  item: ResearchmapPaper,
  permalink: string,
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

  // Authors. `authors.en` holds Japanese names in family-first order, so the
  // family-first formatter is the right one (R commit 9eb5e68). A record with
  // only `authors.ja` keeps its names verbatim — initialising 田口 良子 to
  // "田口 良" would be wrong.
  const authorsEn = (item.authors?.en ?? []).map((a) => clean(a.name)).filter((n) => n !== '')
  const authorsJa = (item.authors?.ja ?? []).map((a) => clean(a.name)).filter((n) => n !== '')
  const authorsFull = authorsEn.length > 0 ? authorsEn : authorsJa
  const authors =
    authorsEn.length > 0 ? authorsEn.map((n) => formatAuthorFamilyFirst(n)) : [...authorsJa]

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
  signal?: AbortSignal,
): Promise<ResearchmapWorksResult> {
  const id = normalizeResearchmapId(permalink)
  if (id === '') return { publications: [], warnings: ['researchmap: empty permalink'] }

  try {
    const data = await getJson<ResearchmapPapersResponse>(
      `${RESEARCHMAP_BASE}/${encodeURIComponent(id)}/published_papers?format=json&limit=${PAPER_LIMIT}`,
      { signal },
    )
    const publications: Publication[] = []
    for (const item of data.items ?? []) {
      const pub = parseResearchmapPaper(item, id)
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
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await fetchResearchmapWorksWithWarnings(permalink, signal)
  return publications
}

/**
 * Display name from a researchmap profile: `Given Family` in English, or the
 * Japanese `姓 名` when the profile has no English name.
 */
export async function fetchResearchmapName(
  permalink: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const id = normalizeResearchmapId(permalink)
  if (id === '') return undefined

  try {
    const data = await getJson<ResearchmapProfileResponse>(
      `${RESEARCHMAP_BASE}/${encodeURIComponent(id)}?format=json`,
      { signal },
    )
    const familyEn = clean(data.family_name?.en)
    const givenEn = clean(data.given_name?.en)
    if (familyEn !== '' && givenEn !== '') return `${givenEn} ${familyEn}`

    const familyJa = clean(data.family_name?.ja)
    const givenJa = clean(data.given_name?.ja)
    if (familyJa !== '' && givenJa !== '') return `${familyJa} ${givenJa}`

    return familyEn || familyJa || givenEn || givenJa || undefined
  } catch (err) {
    if (signal?.aborted) throw err
    return undefined
  }
}
