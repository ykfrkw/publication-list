/**
 * researchmap non-paper achievements (`misc`, `books_etc`, `presentations`,
 * `awards`) for the opt-in 業績集 mode.
 *
 * Response shapes (measured 2026-09-04/05, live accounts `yk_frkw`,
 * `ykanekopsy`, `hikida`, `7000024045`):
 *
 * - every item carries `rm:id` ("51665682") *and* an `@id` URL ending
 *   `/{endpoint}/51665682`; `rm:id` is primary, the `@id` tail the fallback;
 * - `misc` items are `published_papers` items plus an optional `misc_type`,
 *   so they go through `parseResearchmapPaperLike` unchanged;
 * - `books_etc.authors` and `presentations.presenters` have the bilingual
 *   authors shape, handled by `parseResearchmapAuthors`;
 * - responses paginate via `_links.next.href` (which the API sends *without*
 *   `format=json` — the `Accept: application/json` header still gets JSON,
 *   but the parameter is re-appended anyway to be explicit);
 * - `presentations` has no `is_international_presentation` field, whatever
 *   the researchmap UI suggests; venue scope must be inferred downstream.
 */

import { normalizeResearchmapId, titleSlug } from '../ids'
import type { Publication } from '../types'
import { errorMessage, getJson } from './http'
import type { PersonNameAnchor } from './names'
import {
  clean,
  firstIdentifier,
  LANGUAGE_MAP,
  parseResearchmapAuthors,
  parseResearchmapDate,
  parseResearchmapPaperLike,
  RESEARCHMAP_API_BASE,
} from './researchmap'
import type {
  Bilingual,
  BilingualAuthors,
  ResearchmapFetchOptions,
  ResearchmapPaper,
} from './researchmap'

/** Same page size as `published_papers`; one page covers a personal record. */
const GYOSEKI_LIMIT = 1000
/**
 * Hard stop on `_links.next` chains. 10 pages × 1000 items is far beyond any
 * personal record; the cap exists so a linking bug upstream (a `next` that
 * points at itself) costs ten requests, not an unbounded loop.
 */
const MAX_PAGES_PER_ENDPOINT = 10

const GYOSEKI_ENDPOINTS = ['misc', 'books_etc', 'presentations', 'awards'] as const
type GyosekiEndpoint = (typeof GYOSEKI_ENDPOINTS)[number]

interface ResearchmapMiscItem extends ResearchmapPaper {
  misc_type?: string | null
}

interface ResearchmapBookItem {
  book_title?: Bilingual | null
  book_owner_role?: string | null
  book_owner_range?: Bilingual | null
  publisher?: Bilingual | null
  authors?: BilingualAuthors | null
  publication_date?: string | null
  languages?: string[] | null
  identifiers?: Record<string, string[] | undefined> | null
}

interface ResearchmapPresentationItem {
  presentation_title?: Bilingual | null
  presenters?: BilingualAuthors | null
  event?: Bilingual | null
  publication_date?: string | null
  languages?: string[] | null
  presentation_type?: string | null
  invited?: boolean | null
}

interface ResearchmapAwardItem {
  award_name?: Bilingual | null
  association?: Bilingual | null
  award_date?: string | null
}

/** The `rm:id` / `@id` pair every achievement item carries. */
interface RmIdentified {
  'rm:id'?: string | null
  '@id'?: string | null
}

interface GyosekiListResponse {
  total_items?: number
  items?: unknown[] | null
  _links?: { next?: { href?: string | null } | null } | null
}

export interface ResearchmapGyosekiResult {
  publications: Publication[]
  warnings: string[]
}

/** `rm:id` first, the trailing `@id` path segment as the fallback. */
export function extractRmId(item: RmIdentified): string | undefined {
  const rmId = clean(item['rm:id'])
  if (rmId !== '') return rmId
  const atId = clean(item['@id'])
  const match = /\/(\d+)\/?(?:[?#].*)?$/.exec(atId)
  return match ? match[1] : undefined
}

/** `rm:<id>` when the item is identified, `title:<slug>` otherwise. */
function gyosekiKey(rmId: string | undefined, title: string): string {
  return rmId !== undefined ? `rm:${rmId}` : `title:${titleSlug(title)}`
}

/** `languages[0]` through the shared ISO-639-2/B table. */
function declaredLanguage(languages: string[] | null | undefined): string | undefined {
  return LANGUAGE_MAP[clean(languages?.[0]).toLowerCase()]
}

/**
 * The paper language rule (`researchmap.ts`): a record with no English title
 * is Japanese whatever `languages` claims; otherwise `languages[0]` decides,
 * and an English title alone reads as English.
 */
function paperStyleLanguage(
  titleEn: string,
  titleJa: string,
  languages: string[] | null | undefined,
): string | undefined {
  if (titleEn === '' && titleJa !== '') return 'ja'
  return declaredLanguage(languages) ?? (titleEn !== '' ? 'en' : undefined)
}

/** `misc` items are papers plus `misc_type`; the shared parser does the rest. */
export function parseResearchmapMisc(
  item: ResearchmapMiscItem & RmIdentified,
  permalink: string,
  anchors: readonly PersonNameAnchor[] = [],
): Publication | undefined {
  const pub = parseResearchmapPaperLike(item, permalink, anchors)
  if (!pub) return undefined
  pub.fromMisc = true
  const rmId = extractRmId(item)
  if (rmId !== undefined) pub.rmId = rmId
  const miscType = clean(item.misc_type)
  if (miscType !== '') pub.miscType = miscType
  return pub
}

export function parseResearchmapBook(
  item: ResearchmapBookItem & RmIdentified,
  permalink: string,
  anchors: readonly PersonNameAnchor[] = [],
): Publication | undefined {
  const titleEn = clean(item.book_title?.en)
  const titleJa = clean(item.book_title?.ja)
  const title = titleEn !== '' ? titleEn : titleJa
  if (title === '') return undefined

  const rmId = extractRmId(item)
  const { year, month } = parseResearchmapDate(item.publication_date)
  const { authors, authorsFull } = parseResearchmapAuthors(item.authors, anchors)

  const publisher = clean(item.publisher?.ja) || clean(item.publisher?.en)
  const bookRole = clean(item.book_owner_role)
  const bookRange = clean(item.book_owner_range?.ja) || clean(item.book_owner_range?.en)
  const isbn = firstIdentifier(item.identifiers, 'isbn')

  return {
    key: gyosekiKey(rmId, title),
    kind: 'book',
    title,
    authors,
    authorsFull,
    ...(authors.length > 0 ? { authorsSource: 'researchmap' as const } : {}),
    journal: '',
    year,
    month,
    language: paperStyleLanguage(titleEn, titleJa, item.languages),
    ...(publisher !== '' ? { publisher } : {}),
    ...(bookRole !== '' ? { bookRole } : {}),
    ...(bookRange !== '' ? { bookRange } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
    ...(rmId !== undefined ? { rmId } : {}),
    sources: ['researchmap'],
    seedIds: [permalink],
    trust: 'confirmed',
  }
}

export function parseResearchmapPresentation(
  item: ResearchmapPresentationItem & RmIdentified,
  permalink: string,
  anchors: readonly PersonNameAnchor[] = [],
): Publication | undefined {
  const titleEn = clean(item.presentation_title?.en)
  const titleJa = clean(item.presentation_title?.ja)
  const title = titleEn !== '' ? titleEn : titleJa
  if (title === '') return undefined

  const rmId = extractRmId(item)
  const { year, month } = parseResearchmapDate(item.publication_date)
  const { authors, authorsFull } = parseResearchmapAuthors(item.presenters, anchors)

  // Unlike papers, `languages[0]` outranks the ja-only-title heuristic here:
  // a Japanese-titled talk delivered in English does happen.
  const language =
    declaredLanguage(item.languages) ??
    (titleEn === '' && titleJa !== '' ? 'ja' : titleEn !== '' ? 'en' : undefined)

  const event = clean(item.event?.en)
  const eventJa = clean(item.event?.ja)
  const presentationType = clean(item.presentation_type)

  return {
    key: gyosekiKey(rmId, title),
    kind: 'presentation',
    title,
    authors,
    authorsFull,
    ...(authors.length > 0 ? { authorsSource: 'researchmap' as const } : {}),
    journal: '',
    year,
    month,
    language,
    ...(event !== '' ? { event } : {}),
    ...(eventJa !== '' ? { eventJa } : {}),
    ...(presentationType !== '' ? { presentationType } : {}),
    ...(typeof item.invited === 'boolean' ? { invited: item.invited } : {}),
    ...(rmId !== undefined ? { rmId } : {}),
    sources: ['researchmap'],
    seedIds: [permalink],
    trust: 'confirmed',
  }
}

export function parseResearchmapAward(
  item: ResearchmapAwardItem & RmIdentified,
  permalink: string,
): Publication | undefined {
  // Japanese first: a 業績集 lists 受賞歴 under the Japanese name when the
  // society has one, the reverse of every other title on the page.
  const titleJa = clean(item.award_name?.ja)
  const titleEn = clean(item.award_name?.en)
  const title = titleJa !== '' ? titleJa : titleEn
  if (title === '') return undefined

  const rmId = extractRmId(item)
  const { year, month } = parseResearchmapDate(item.award_date)
  const awardAssociation = clean(item.association?.ja) || clean(item.association?.en)

  return {
    key: gyosekiKey(rmId, title),
    kind: 'award',
    title,
    authors: [],
    authorsFull: [],
    journal: '',
    year,
    month,
    ...(awardAssociation !== '' ? { awardAssociation } : {}),
    ...(rmId !== undefined ? { rmId } : {}),
    sources: ['researchmap'],
    seedIds: [permalink],
    trust: 'confirmed',
  }
}

/**
 * All pages of one endpoint, following `_links.next.href` up to the cap.
 * Throws on HTTP failure — the caller turns that into a warning.
 */
async function fetchEndpointItems(
  id: string,
  endpoint: GyosekiEndpoint,
  signal: AbortSignal | undefined,
): Promise<{ items: unknown[]; warnings: string[] }> {
  const items: unknown[] = []
  let url = `${RESEARCHMAP_API_BASE}/${encodeURIComponent(id)}/${endpoint}?format=json&limit=${GYOSEKI_LIMIT}`
  let totalItems: number | undefined

  for (let page = 0; page < MAX_PAGES_PER_ENDPOINT; page++) {
    const data = await getJson<GyosekiListResponse>(url, { signal })
    items.push(...(data.items ?? []))
    totalItems = data.total_items
    const next = clean(data._links?.next?.href)
    if (next === '') return { items, warnings: [] }
    // The API's own next href drops `format=json`; put it back.
    url = next.includes('format=json') ? next : `${next}${next.includes('?') ? '&' : '?'}format=json`
  }

  return {
    items,
    warnings: [
      `researchmap ${id} ${endpoint}: stopped after ${MAX_PAGES_PER_ENDPOINT} pages` +
        ` (${totalItems ?? 'unknown'} items total)`,
    ],
  }
}

/**
 * Fetch a researchmap user's `misc`, `books_etc`, `presentations` and
 * `awards`, in parallel, with per-endpoint failure isolation: one endpoint
 * failing costs its own records and a warning, never the other three.
 * Rejects only when the caller's `signal` aborts.
 */
export async function fetchResearchmapGyosekiWithWarnings(
  permalink: string,
  opts: ResearchmapFetchOptions = {},
): Promise<ResearchmapGyosekiResult> {
  const { signal } = opts
  const id = normalizeResearchmapId(permalink)
  if (id === '') return { publications: [], warnings: ['researchmap: empty permalink'] }

  const fetched = await Promise.all(
    GYOSEKI_ENDPOINTS.map(async (endpoint) => {
      try {
        return { endpoint, ...(await fetchEndpointItems(id, endpoint, signal)) }
      } catch (err) {
        if (signal?.aborted) throw err
        return {
          endpoint,
          items: [] as unknown[],
          warnings: [`researchmap ${id} ${endpoint}: ${errorMessage(err)}`],
        }
      }
    }),
  )

  const anchors = (await opts.anchors) ?? []
  const publications: Publication[] = []
  const warnings: string[] = []

  for (const { endpoint, items, warnings: endpointWarnings } of fetched) {
    warnings.push(...endpointWarnings)
    for (const raw of items) {
      const item = raw as RmIdentified
      let pub: Publication | undefined
      if (endpoint === 'misc') {
        pub = parseResearchmapMisc(item as ResearchmapMiscItem & RmIdentified, id, anchors)
      } else if (endpoint === 'books_etc') {
        pub = parseResearchmapBook(item as ResearchmapBookItem & RmIdentified, id, anchors)
      } else if (endpoint === 'presentations') {
        pub = parseResearchmapPresentation(
          item as ResearchmapPresentationItem & RmIdentified,
          id,
          anchors,
        )
      } else {
        pub = parseResearchmapAward(item as ResearchmapAwardItem & RmIdentified, id)
      }
      if (pub) publications.push(pub)
    }
  }

  return { publications, warnings }
}
