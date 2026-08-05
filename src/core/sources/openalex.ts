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
 * **Author names are the one exception**, because "populated" turned out not to
 * mean "usable". researchmap fills `authorsFull` with short forms such as
 * `Türkmen C` and in an order that varies by account, and a populated-but-short
 * `authorsFull` is worse than an empty one: it looks like the full names are
 * already known, so nothing downstream goes and gets them. Names may therefore
 * be upgraded — see `shouldReplaceAuthorNames` for exactly when.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import { normalizeDoi, pubKey, titleSlug } from '../ids'
import type { AuthorNameSource, Publication } from '../types'
import { chunk, errorMessage, getJson } from './http'
import { formatAuthorShort, isFullPersonName } from './names'

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

// ─────────────────────────────────────────────────────── author names ──

/**
 * How much to trust the author names already on a record.
 *
 * Only researchmap sits below the rest, and for two measured reasons: the order
 * of its `authors.en` varies by account (so the names may not be abbreviatable
 * at all), and it stores short forms in that field (so `authorsFull` can be
 * empty even where the seed "has" author names). Everything else — ORCID,
 * PubMed, Crossref, a pinned OpenAlex record, or `undefined` for a caller that
 * never said — is treated as authoritative and left alone.
 */
function authorNameRank(source: AuthorNameSource | undefined): number {
  return source === 'researchmap' ? 0 : 1
}

const OPENALEX_NAME_RANK = 1

/**
 * Should OpenAlex's author list replace the one already on the record?
 *
 * Three ways yes:
 *
 * 1. **Gap** — the record has no author names at all (ORCID work summaries
 *    never carry any).
 * 2. **Provenance** — the existing names are researchmap-derived, which
 *    OpenAlex outranks.
 * 3. **Upgrade** — the existing "full" names are not actually full (`Türkmen C`
 *    stored as a full name) while the incoming ones are, or the two arrays do
 *    not line up, which makes `format.ts` fall back to short-form matching.
 *
 * Otherwise no: a curated seed record outranks OpenAlex, which is the rule this
 * module was built on and still the right default.
 */
export function shouldReplaceAuthorNames(
  pub: Publication,
  incoming: readonly string[],
  incomingRank = OPENALEX_NAME_RANK,
): boolean {
  if (incoming.length === 0) return false

  const authors = pub.authors ?? []
  const full = pub.authorsFull ?? []

  if (authors.length === 0 && full.length === 0) return true
  if (authorNameRank(pub.authorsSource) < incomingRank) return true
  if (full.length === 0 || full.length !== authors.length) return true
  if (!full.every((n) => isFullPersonName(n)) && incoming.some((n) => isFullPersonName(n))) {
    return true
  }
  return false
}

/**
 * Copy OpenAlex fields onto a publication.
 *
 * Everything except the author names is gap-fill only. Author names may also be
 * *upgraded* — see `shouldReplaceAuthorNames` — and when they are, `authors` and
 * `authorsFull` are replaced together so the two arrays stay index-aligned;
 * `format.ts` silently stops bolding anyone the moment they diverge.
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
  if (shouldReplaceAuthorNames(merged, fullNames)) {
    merged.authorsFull = fullNames
    // OpenAlex writes display names given-first, whatever the author's culture.
    merged.authors = fullNames.map((n) => formatAuthorShort(n))
    merged.authorsSource = 'openalex'
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

export interface EnrichByDoiOptions {
  /**
   * Normalized DOIs whose record was already built from an OpenAlex work.
   *
   * `pipeline.ts` materializes pinned DOIs straight out of `works?filter=doi:`,
   * copying exactly the fields `mergeOpenAlexWork` would copy. Re-requesting
   * them here would spend a second round trip to compute the same values.
   */
  skipDois?: ReadonlySet<string>
}

/** Enrich every publication that has a DOI, 50 DOIs per request. */
export async function enrichByDoiWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
  opts: EnrichByDoiOptions = {},
): Promise<EnrichResult> {
  const skip = opts.skipDois
  return enrichByField(
    pubs,
    'doi',
    (pub) => {
      if (isBlank(pub.doi)) return undefined
      const doi = normalizeDoi(pub.doi as string)
      return skip?.has(doi) ? undefined : doi
    },
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
  opts: EnrichByDoiOptions = {},
): Promise<Publication[]> {
  const { publications } = await enrichByDoiWithWarnings(pubs, signal, opts)
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
