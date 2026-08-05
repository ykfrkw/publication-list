/**
 * OpenAlex — **enrichment only, never a seed.**
 *
 * OpenAlex author disambiguation is not accurate enough to decide whose paper
 * a record is, so `filter=author.id:` is deliberately not implemented and
 * `R/fetch_openalex_author.R` is deliberately not ported. Everything here
 * starts from an identifier a trusted seed already produced.
 *
 * The R version fetched one DOI per request with a 0.4 s sleep. OpenAlex
 * accepts an OR filter of up to 50 values (`filter=doi:A|B|C`), so a 200-paper
 * list now enriches in four requests instead of two hundred.
 *
 * **No `mailto` parameter.** OpenAlex's "polite pool" keys off a contact
 * address, but this code runs in each visitor's browser from their own IP, so
 * there is no shared quota for a pool to protect — and an address hard-coded
 * into a public bundle is a spam magnet.
 *
 * Enrichment never overwrites a populated field: the seed (ORCID, researchmap,
 * PubMed) is the researcher's own curated record and outranks OpenAlex.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import { normalizeDoi, pubKey, titleSlug } from '../ids'
import type { Publication } from '../types'
import { chunk, errorMessage, getJson } from './http'
import { formatAuthorShort } from './names'

const OPENALEX_WORKS = 'https://api.openalex.org/works'

/** OpenAlex caps an OR filter at 50 values. */
export const OPENALEX_CHUNK_SIZE = 50

/** Title search is one request per record, so it is capped hard. */
export const TITLE_SEARCH_LIMIT = 20

const SELECT_FIELDS =
  'id,doi,ids,type,title,publication_year,publication_date,primary_location,authorships'

interface OpenAlexWork {
  id?: string
  doi?: string | null
  ids?: { doi?: string | null; pmid?: string | null; openalex?: string | null } | null
  type?: string | null
  title?: string | null
  publication_year?: number | null
  publication_date?: string | null
  primary_location?: { source?: { display_name?: string | null } | null } | null
  authorships?: Array<{
    raw_author_name?: string | null
    author?: { display_name?: string | null } | null
  }> | null
}

interface OpenAlexListResponse {
  meta?: { count?: number }
  results?: OpenAlexWork[] | null
}

export interface EnrichResult {
  publications: Publication[]
  warnings: string[]
}

function extractPmid(pmidUrl: string | null | undefined): string | undefined {
  if (!pmidUrl) return undefined
  const match = /(\d+)\s*$/.exec(pmidUrl)
  return match ? match[1] : undefined
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

/**
 * Copy OpenAlex fields onto a publication, filling gaps only.
 *
 * Returns a new object; the input is never mutated. `key` is recomputed
 * because filling in a PMID can promote a record off its title-slug key.
 */
export function mergeOpenAlexWork(pub: Publication, work: OpenAlexWork): Publication {
  const merged: Publication = { ...pub }

  const type = (work.type ?? '').trim()
  if (isBlank(merged.openAlexType) && type !== '') merged.openAlexType = type

  const journal = (work.primary_location?.source?.display_name ?? '').trim()
  if (merged.journal.trim() === '' && journal !== '') merged.journal = journal

  const pmid = extractPmid(work.ids?.pmid)
  if (isBlank(merged.pmid) && pmid) merged.pmid = pmid

  const fullNames = (work.authorships ?? [])
    .map((a) => (a.author?.display_name ?? a.raw_author_name ?? '').trim())
    .filter((n) => n !== '')
  if (merged.authorsFull.length === 0 && fullNames.length > 0) {
    merged.authorsFull = fullNames
  }
  if (merged.authors.length === 0 && fullNames.length > 0) {
    merged.authors = fullNames.map((n) => formatAuthorShort(n))
  }

  // Dates: only ever fill a missing one.
  if (!merged.year && typeof work.publication_year === 'number') {
    merged.year = work.publication_year
  }
  if (merged.month === undefined && typeof work.publication_date === 'string') {
    const month = Number.parseInt(work.publication_date.slice(5, 7), 10)
    if (Number.isFinite(month) && month >= 1 && month <= 12) merged.month = month
  }

  merged.key = pubKey(merged)
  return merged
}

/** `works?filter=<field>:a|b|c` for one chunk of values. */
function filterUrl(field: string, values: string[]): string {
  const joined = values.map((v) => encodeURIComponent(v)).join('|')
  return `${OPENALEX_WORKS}?filter=${field}:${joined}&per-page=${OPENALEX_CHUNK_SIZE}&select=${SELECT_FIELDS}`
}

async function enrichByField(
  pubs: Publication[],
  field: 'doi' | 'ids.pmid',
  keyOf: (pub: Publication) => string | undefined,
  matchOf: (work: OpenAlexWork) => string | undefined,
  signal?: AbortSignal,
): Promise<EnrichResult> {
  const warnings: string[] = []
  const byValue = new Map<string, number[]>()

  pubs.forEach((pub, index) => {
    const value = keyOf(pub)
    if (!value) return
    const bucket = byValue.get(value)
    if (bucket) bucket.push(index)
    else byValue.set(value, [index])
  })

  if (byValue.size === 0) return { publications: pubs, warnings }

  const publications = [...pubs]
  const values = [...byValue.keys()]

  for (const batch of chunk(values, OPENALEX_CHUNK_SIZE)) {
    try {
      const data = await getJson<OpenAlexListResponse>(filterUrl(field, batch), { signal })
      for (const work of data.results ?? []) {
        const match = matchOf(work)
        if (!match) continue
        for (const index of byValue.get(match) ?? []) {
          publications[index] = mergeOpenAlexWork(publications[index], work)
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err
      warnings.push(
        `OpenAlex ${field} batch (${batch.length} values from ${batch[0]}): ${errorMessage(err)}`,
      )
    }
  }

  return { publications, warnings }
}

/** Enrich every publication that has a DOI, 50 DOIs per request. */
export async function enrichByDoiWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<EnrichResult> {
  return enrichByField(
    pubs,
    'doi',
    (pub) => (isBlank(pub.doi) ? undefined : normalizeDoi(pub.doi as string)),
    (work) => {
      const raw = work.doi ?? work.ids?.doi
      return raw ? normalizeDoi(raw) : undefined
    },
    signal,
  )
}

/** `enrichByDoiWithWarnings` without the warnings. */
export async function enrichByDoi(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await enrichByDoiWithWarnings(pubs, signal)
  return publications
}

/** Enrich every publication that has a PMID but no DOI match, 50 per request. */
export async function enrichByPmidWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<EnrichResult> {
  return enrichByField(
    pubs,
    'ids.pmid',
    (pub) => (isBlank(pub.pmid) ? undefined : (pub.pmid as string).trim()),
    (work) => extractPmid(work.ids?.pmid),
    signal,
  )
}

/** `enrichByPmidWithWarnings` without the warnings. */
export async function enrichByPmid(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await enrichByPmidWithWarnings(pubs, signal)
  return publications
}

/**
 * Last resort for records with neither a DOI nor a PMID: search OpenAlex by
 * title, one request per record, and accept the top hit only when its title
 * matches character-for-character after slugging (port of the verification in
 * `R/enrich_openalex.R:enrich_by_title`).
 *
 * Requests run one at a time, and at most `TITLE_SEARCH_LIMIT` of them: this
 * path cannot be batched, so an unbounded queue would turn one page view into
 * hundreds of requests. Anything beyond the cap is skipped with a warning.
 */
export async function enrichByTitleWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<EnrichResult> {
  const warnings: string[] = []
  const targets: number[] = []

  pubs.forEach((pub, index) => {
    if (!isBlank(pub.doi) || !isBlank(pub.pmid)) return
    if (pub.title.trim() === '') return
    targets.push(index)
  })

  if (targets.length === 0) return { publications: pubs, warnings }

  const capped = targets.slice(0, TITLE_SEARCH_LIMIT)
  if (targets.length > capped.length) {
    warnings.push(
      `OpenAlex title search: ${targets.length} records lack a DOI and a PMID; ` +
        `only the first ${TITLE_SEARCH_LIMIT} were looked up.`,
    )
  }

  const publications = [...pubs]

  for (const index of capped) {
    const pub = publications[index]
    // `,` and `|` are filter separators in OpenAlex's query syntax.
    const searchTerm = pub.title.replace(/[,|]/g, ' ').trim()
    const url =
      `${OPENALEX_WORKS}?filter=title.search:${encodeURIComponent(searchTerm)}` +
      `&per-page=1&select=${SELECT_FIELDS}`
    try {
      const data = await getJson<OpenAlexListResponse>(url, { signal })
      const work = (data.results ?? [])[0]
      if (!work) continue
      if (titleSlug(work.title ?? '') !== titleSlug(pub.title)) continue

      const merged = mergeOpenAlexWork(pub, work)
      const rawDoi = work.doi ?? work.ids?.doi
      if (isBlank(merged.doi) && rawDoi) {
        merged.doi = normalizeDoi(rawDoi)
        merged.key = pubKey(merged)
      }
      publications[index] = merged
    } catch (err) {
      if (signal?.aborted) throw err
      warnings.push(`OpenAlex title search "${pub.title.slice(0, 60)}": ${errorMessage(err)}`)
    }
  }

  return { publications, warnings }
}

/** `enrichByTitleWithWarnings` without the warnings. */
export async function enrichByTitle(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await enrichByTitleWithWarnings(pubs, signal)
  return publications
}
