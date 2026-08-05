/**
 * PubMed E-utilities (`esearch` + `esummary`).
 *
 * Revives and extends `orcid-publication-list/src/api/pubmed.ts`, which only
 * fetched publication types.
 *
 * Two deliberate omissions, both because this code runs in *visitors'*
 * browsers rather than on one server:
 *
 * - **No `email=`.** A public address in a client-side bundle is a spam
 *   magnet, and NCBI only uses it to contact the operator of a heavy caller.
 * - **No `api_key=`.** A key embedded in a public bundle is a leaked key.
 *
 * `tool=` is always sent — it is the part NCBI actually asks for and it costs
 * nothing. Without a key the limit is 3 requests/second, so every request goes
 * through a single serial queue with a ≥350 ms gap.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import { normalizeDoi, pubKey, stripDoiVersion } from '../ids'
import type { Publication, Trust } from '../types'
import { chunk, createRateLimiter, errorMessage, getJson } from './http'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const TOOL = 'publication-list-generator'

/** NCBI allows 3 req/s without a key; 350 ms leaves headroom. */
const MIN_REQUEST_GAP_MS = 350
/** E-utilities accepts up to 200 UIDs per `esummary` request. */
export const ESUMMARY_CHUNK_SIZE = 200
const DEFAULT_RETMAX = 200

// `@__PURE__`: a top-level call is otherwise assumed to have side effects and
// pins this module (and `./http`) into any bundle that touches it.
const limiter = /* @__PURE__ */ createRateLimiter(MIN_REQUEST_GAP_MS)

interface ESearchResponse {
  esearchresult?: {
    count?: string
    idlist?: string[]
    error?: string
    warninglist?: unknown
  }
}

interface ESummaryAuthor {
  name?: string
  authtype?: string
}

interface ESummaryArticleId {
  idtype?: string
  value?: string
}

interface ESummaryDoc {
  uid?: string
  pubdate?: string
  epubdate?: string
  sortpubdate?: string
  source?: string
  fulljournalname?: string
  title?: string
  authors?: ESummaryAuthor[]
  lang?: string[]
  pubtype?: string[]
  articleids?: ESummaryArticleId[]
  error?: string
}

interface ESummaryResponse {
  result?: Record<string, ESummaryDoc | string[] | undefined> & { uids?: string[] }
}

export interface PubmedSearchOptions {
  /** Cap on returned PMIDs. Default 200 — the wizard warns above that. */
  retmax?: number
  signal?: AbortSignal
}

export interface PubmedSummaryOptions {
  /**
   * Trust for the produced records. The *pipeline* decides this: an `[auid]`
   * query is high precision, a bare `[au]` name query is not. Default
   * `'candidate'`, i.e. show it in the review queue rather than on the page.
   */
  trust?: Trust
  /** Seed labels to attribute these records to (e.g. the query string). */
  seedIds?: string[]
  signal?: AbortSignal
}

export interface PubmedSearchResult {
  pmids: string[]
  warnings: string[]
}

export interface PubmedSummaryResult {
  publications: Publication[]
  warnings: string[]
}

/**
 * Does this query end in `[auid]` (ORCID author-identifier search)?
 *
 * Those hits are essentially free of same-name contamination, so the pipeline
 * promotes them to `trust: 'confirmed'`. Anything else stays a candidate.
 */
export function isAuidQuery(query: string): boolean {
  return /\[\s*auid\s*\]\s*$/i.test(query.trim())
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

export interface PubmedDate {
  year: number
  month?: number
}

/**
 * Parse an E-utilities date string.
 *
 * Handles `2026 Jun 10`, `2026 Jun`, `2026`, `2026 Jun-Jul` (takes the first
 * month), `2026 Winter` (season → no month) and `2026/06/10 00:00`.
 */
export function parsePubmedDate(raw: string | undefined): PubmedDate {
  const value = (raw ?? '').trim()
  if (value === '') return { year: 0 }

  const yearMatch = /(\d{4})/.exec(value)
  const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : 0

  const monthName = /\b([A-Za-z]{3})[a-z]*\b/.exec(value)
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase()]
    if (month) return { year, month }
    return { year }
  }

  const numeric = /^\d{4}[/-](\d{1,2})/.exec(value)
  if (numeric) {
    const month = Number.parseInt(numeric[1], 10)
    if (month >= 1 && month <= 12) return { year, month }
  }

  return { year }
}

const LANGUAGE_MAP: Record<string, string> = {
  eng: 'en',
  jpn: 'ja',
  ger: 'de',
  fre: 'fr',
  spa: 'es',
  chi: 'zh',
  kor: 'ko',
  por: 'pt',
  ita: 'it',
  rus: 'ru',
  dut: 'nl',
}

/** `jpn` → `ja`, `eng` → `en`; unknown codes pass through lowercased. */
export function mapPubmedLanguage(code: string | undefined): string | undefined {
  const value = (code ?? '').trim().toLowerCase()
  if (value === '') return undefined
  return LANGUAGE_MAP[value] ?? value
}

/**
 * Collapse PubMed's `pubtype[]` to the single lowercase token that
 * `categorize.ts` understands.
 *
 * `Publication` has no PubMed-specific type field, so the result lands in
 * `orcidType`, which the categorizer already treats as "the type the seed
 * reported". The vocabulary matches ORCID's (`journal-article`, `review`,
 * `letter`, `editorial`, `preprint`, …).
 */
export function pubmedTypeToken(pubTypes: string[] | undefined): string | undefined {
  const types = (pubTypes ?? []).map((t) => t.toLowerCase())
  if (types.length === 0) return undefined
  if (types.includes('preprint')) return 'preprint'
  if (types.includes('letter')) return 'letter'
  if (types.includes('editorial')) return 'editorial'
  if (types.includes('comment')) return 'comment'
  if (
    types.includes('review') ||
    types.includes('systematic review') ||
    types.includes('meta-analysis')
  ) {
    return 'review'
  }
  if (types.includes('journal article')) return 'journal-article'
  return types[0]
}

function articleId(doc: ESummaryDoc, type: string): string | undefined {
  for (const entry of doc.articleids ?? []) {
    if ((entry.idtype ?? '').toLowerCase() === type) {
      const value = (entry.value ?? '').trim()
      if (value !== '') return value
    }
  }
  return undefined
}

/** One `esummary` document → `Publication`. Exported for the unit tests. */
export function parsePubmedDoc(
  doc: ESummaryDoc,
  opts: { trust: Trust; seedIds: string[] },
): Publication | undefined {
  const pmid = (doc.uid ?? articleId(doc, 'pubmed') ?? '').trim()
  const title = (doc.title ?? '').trim()
  if (pmid === '' && title === '') return undefined

  const rawDoi = articleId(doc, 'doi')
  const doi = rawDoi ? normalizeDoi(rawDoi) : undefined
  const doiVersion = doi ? stripDoiVersion(doi).version : undefined

  // `pubdate` is the print date and is the one PubMed sorts on; `epubdate`
  // fills in for online-only records that carry no print date.
  const primary = parsePubmedDate(doc.pubdate)
  const fallback = parsePubmedDate(doc.epubdate)
  const year = primary.year || fallback.year
  const sameYear = primary.year === 0 || fallback.year === 0 || primary.year === fallback.year
  const month = primary.month ?? (sameYear ? fallback.month : undefined)

  const authors = (doc.authors ?? [])
    .filter((a) => (a.authtype ?? 'Author') === 'Author')
    .map((a) => (a.name ?? '').trim())
    .filter((n) => n !== '')

  return {
    key: pubKey({ title, doi, pmid: pmid || undefined }),
    title,
    // esummary gives short forms already ("Furukawa Y"); full names need
    // OpenAlex enrichment.
    authors,
    authorsFull: [],
    journal: (doc.source ?? '').trim(),
    year,
    month,
    doi,
    doiVersion,
    pmid: pmid === '' ? undefined : pmid,
    language: mapPubmedLanguage(doc.lang?.[0]),
    orcidType: pubmedTypeToken(doc.pubtype),
    sources: ['pubmed'],
    seedIds: opts.seedIds,
    trust: opts.trust,
  }
}

function eutilsUrl(endpoint: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ ...params, tool: TOOL })
  return `${EUTILS_BASE}/${endpoint}?${query.toString()}`
}

/** `esearch` with the failure reason attached. */
export async function searchPubmedWithWarnings(
  query: string,
  opts: PubmedSearchOptions = {},
  signal?: AbortSignal,
): Promise<PubmedSearchResult> {
  const term = query.trim()
  if (term === '') return { pmids: [], warnings: [] }

  const sig = signal ?? opts.signal
  const retmax = opts.retmax ?? DEFAULT_RETMAX

  try {
    const data = await limiter(
      () =>
        getJson<ESearchResponse>(
          eutilsUrl('esearch.fcgi', {
            db: 'pubmed',
            retmode: 'json',
            retmax: String(retmax),
            term,
          }),
          { signal: sig },
        ),
      sig,
    )
    const result = data.esearchresult
    if (result?.error) {
      return { pmids: [], warnings: [`PubMed search "${term}": ${result.error}`] }
    }
    return { pmids: (result?.idlist ?? []).filter((id) => id.trim() !== ''), warnings: [] }
  } catch (err) {
    if (sig?.aborted) throw err
    return { pmids: [], warnings: [`PubMed search "${term}": ${errorMessage(err)}`] }
  }
}

/** PMIDs matching `query`. Returns `[]` rather than throwing on failure. */
export async function searchPubmed(
  query: string,
  opts: PubmedSearchOptions = {},
  signal?: AbortSignal,
): Promise<string[]> {
  const { pmids } = await searchPubmedWithWarnings(query, opts, signal)
  return pmids
}

/**
 * `esummary` for a PMID list, in chunks of 200, one request at a time.
 *
 * A failed chunk costs only that chunk: the other 200-PMID slices still come
 * back, and the failure is reported in `warnings`.
 */
export async function fetchPubmedSummariesWithWarnings(
  pmids: string[],
  opts: PubmedSummaryOptions = {},
  signal?: AbortSignal,
): Promise<PubmedSummaryResult> {
  const ids = [...new Set(pmids.map((p) => p.trim()).filter((p) => p !== ''))]
  if (ids.length === 0) return { publications: [], warnings: [] }

  const sig = signal ?? opts.signal
  const trust: Trust = opts.trust ?? 'candidate'
  const seedIds = opts.seedIds ?? []

  const publications: Publication[] = []
  const warnings: string[] = []

  for (const batch of chunk(ids, ESUMMARY_CHUNK_SIZE)) {
    try {
      const data = await limiter(
        () =>
          getJson<ESummaryResponse>(
            eutilsUrl('esummary.fcgi', {
              db: 'pubmed',
              retmode: 'json',
              id: batch.join(','),
            }),
            { signal: sig },
          ),
        sig,
      )

      const uids = data.result?.uids ?? batch
      for (const uid of uids) {
        const doc = data.result?.[uid]
        if (!doc || Array.isArray(doc)) continue
        if (doc.error) {
          warnings.push(`PubMed ${uid}: ${doc.error}`)
          continue
        }
        const pub = parsePubmedDoc({ ...doc, uid: doc.uid ?? uid }, { trust, seedIds })
        if (pub) publications.push(pub)
      }
    } catch (err) {
      if (sig?.aborted) throw err
      warnings.push(
        `PubMed summaries (${batch.length} PMIDs from ${batch[0]}): ${errorMessage(err)}`,
      )
    }
  }

  return { publications, warnings }
}

/** `fetchPubmedSummariesWithWarnings` without the warnings. */
export async function fetchPubmedSummaries(
  pmids: string[],
  opts: PubmedSummaryOptions = {},
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await fetchPubmedSummariesWithWarnings(pmids, opts, signal)
  return publications
}
