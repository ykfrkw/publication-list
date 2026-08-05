/**
 * ORCID public API (`pub.orcid.org/v3.0`).
 *
 * Ported from `orcid-publication-list/src/api/orcid.ts` and adapted to the
 * `Publication` contract in `src/core/types.ts`. ORCID's works record is the
 * recall backbone of a seed: the researcher curates it, so everything it
 * contains is trusted (`trust: 'confirmed'`).
 *
 * ORCID work summaries carry no author list — `authors` stays empty here and
 * is filled in later by `openalex.ts`.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05), so this runs in a
 * visitor's browser with no proxy and no key.
 */

import { normalizeDoi, pubKey, stripDoiVersion, normalizeOrcid } from '../ids'
import type { Publication } from '../types'
import { errorMessage, getJson } from './http'
import { tidyPersonName } from './names'
import type { PersonNameAnchor } from './names'

const ORCID_BASE = 'https://pub.orcid.org/v3.0'

interface OrcidValue {
  value?: string | null
}

interface OrcidWorkSummary {
  'put-code'?: number
  title?: { title?: OrcidValue | null } | null
  type?: string | null
  'publication-date'?: {
    year?: OrcidValue | null
    month?: OrcidValue | null
    day?: OrcidValue | null
  } | null
  'journal-title'?: OrcidValue | null
  'external-ids'?: {
    'external-id'?: Array<{
      'external-id-type'?: string | null
      'external-id-value'?: string | null
    }> | null
  } | null
}

interface OrcidWorksResponse {
  group?: Array<{ 'work-summary'?: OrcidWorkSummary[] | null }> | null
}

interface OrcidPersonResponse {
  name?: {
    'given-names'?: OrcidValue | null
    'family-name'?: OrcidValue | null
    'credit-name'?: OrcidValue | null
  } | null
}

export interface OrcidWorksResult {
  publications: Publication[]
  warnings: string[]
}

function text(v: OrcidValue | null | undefined): string {
  return (v?.value ?? '').trim()
}

function externalId(summary: OrcidWorkSummary, type: string): string | undefined {
  const ids = summary['external-ids']?.['external-id'] ?? []
  for (const entry of ids) {
    if ((entry['external-id-type'] ?? '').toLowerCase() === type) {
      const value = (entry['external-id-value'] ?? '').trim()
      if (value !== '') return value
    }
  }
  return undefined
}

/** `group[].work-summary[0]` → `Publication`. Exported for the unit tests. */
export function parseOrcidWorks(data: OrcidWorksResponse, orcidId: string): Publication[] {
  const publications: Publication[] = []

  for (const group of data.group ?? []) {
    const summary = group['work-summary']?.[0]
    if (!summary) continue

    const title = text(summary.title?.title)
    const rawDoi = externalId(summary, 'doi')
    const pmid = externalId(summary, 'pmid')
    // A record with neither a title nor an identifier cannot be keyed, cited
    // or deduplicated — drop it rather than emit a `title:` key of "".
    if (title === '' && !rawDoi && !pmid) continue

    const doi = rawDoi ? normalizeDoi(rawDoi) : undefined
    const doiVersion = doi ? stripDoiVersion(doi).version : undefined

    const pubDate = summary['publication-date']
    const yearText = text(pubDate?.year)
    const monthText = text(pubDate?.month)
    const year = yearText === '' ? 0 : Number.parseInt(yearText, 10)
    const month = monthText === '' ? undefined : Number.parseInt(monthText, 10)

    publications.push({
      key: pubKey({ title, doi, pmid }),
      title,
      authors: [],
      authorsFull: [],
      journal: text(summary['journal-title']),
      year: Number.isFinite(year) ? year : 0,
      month: month !== undefined && Number.isFinite(month) ? month : undefined,
      doi,
      doiVersion,
      pmid,
      orcidType: (summary.type ?? '').trim() || undefined,
      sources: ['orcid'],
      seedIds: [orcidId],
      trust: 'confirmed',
    })
  }

  return publications
}

/**
 * Fetch an ORCID works record, with the reason for any failure.
 *
 * Never throws for upstream problems: a dead ORCID id must not take down the
 * whole list. Caller cancellation (`signal`) does propagate.
 */
export async function fetchOrcidWorksWithWarnings(
  orcidId: string,
  signal?: AbortSignal,
): Promise<OrcidWorksResult> {
  const id = normalizeOrcid(orcidId)
  if (id === '') return { publications: [], warnings: ['ORCID: empty identifier'] }

  try {
    const data = await getJson<OrcidWorksResponse>(
      `${ORCID_BASE}/${encodeURIComponent(id)}/works`,
      { signal },
    )
    return { publications: parseOrcidWorks(data, id), warnings: [] }
  } catch (err) {
    if (signal?.aborted) throw err
    return { publications: [], warnings: [`ORCID ${id}: ${errorMessage(err)}`] }
  }
}

/** `fetchOrcidWorksWithWarnings` without the warnings. Returns `[]` on failure. */
export async function fetchOrcidWorks(
  orcidId: string,
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await fetchOrcidWorksWithWarnings(orcidId, signal)
  return publications
}

export interface OrcidPerson {
  /** credit name if the researcher set one, otherwise `given family` */
  name?: string
  /**
   * `given-names` and `family-name` as ORCID stores them — **separately**.
   *
   * This is the whole reason `/person` is worth a request beyond the display
   * name: it is the only place in this pipeline where a person's name arrives
   * pre-split, which is what lets `researchmap.ts` measure the order of an
   * author list instead of assuming one (see `detectNameOrder`).
   */
  anchor?: PersonNameAnchor
}

/**
 * The researcher's name from `/person`, display form and split form.
 *
 * Returns `{}` when ORCID has no name or the request fails — a missing name is
 * never fatal.
 */
export async function fetchOrcidPerson(
  orcidId: string,
  signal?: AbortSignal,
): Promise<OrcidPerson> {
  const id = normalizeOrcid(orcidId)
  if (id === '') return {}

  try {
    const data = await getJson<OrcidPersonResponse>(
      `${ORCID_BASE}/${encodeURIComponent(id)}/person`,
      { signal },
    )
    // ORCID often stores these shouting ("YUKI FURUKAWA"), hence `tidyPersonName`.
    const given = tidyPersonName(text(data.name?.['given-names']))
    const family = tidyPersonName(text(data.name?.['family-name']))

    const person: OrcidPerson = {}
    if (given !== '' && family !== '') person.anchor = { given, family }

    const credit = tidyPersonName(text(data.name?.['credit-name']))
    const name = credit !== '' ? credit : [given, family].filter((p) => p !== '').join(' ')
    if (name !== '') person.name = name

    return person
  } catch (err) {
    if (signal?.aborted) throw err
    return {}
  }
}

/**
 * The researcher's display name: the credit name if they set one, otherwise
 * `given family`. Returns `undefined` when ORCID has neither or the request
 * fails — a missing name is never fatal.
 */
export async function fetchOrcidName(
  orcidId: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const { name } = await fetchOrcidPerson(orcidId, signal)
  return name
}
