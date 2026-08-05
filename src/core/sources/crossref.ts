/**
 * Crossref — peer-review status for open-review journals.
 *
 * Port of `publication-list-generator/R/enrich_crossref.R`.
 *
 * F1000Research and its siblings publish an article the moment it is
 * submitted, then attach referee reports afterwards. Listing an unreviewed
 * F1000 article as a peer-reviewed original paper overstates it; listing an
 * approved one as a preprint understates it. Crossref carries the answer in
 * `message.assertion[]`:
 *
 * - `{ name: "referee-status", value: "Indexed" }` — at least one approval
 * - `{ name: "referee-status", value: "Awaiting Peer Review" }` — none yet
 * - `{ name: "referee-response-383", value: "… Approved: 30 November 2012 …" }`
 *
 * Only publications in an open-review journal are looked up, so in practice
 * this is a handful of requests; they run one at a time with a ≥400 ms gap.
 *
 * No `mailto` parameter, for the same reason as `openalex.ts`: this runs from
 * each visitor's own IP, and a public address in a client bundle invites spam.
 *
 * `Access-Control-Allow-Origin: *` (verified 2026-08-05).
 */

import type { Publication } from '../types'
import { createRateLimiter, errorMessage, getJson } from './http'
import { formatAuthorShort } from './names'

const CROSSREF_WORKS = 'https://api.crossref.org/works'
const MIN_REQUEST_GAP_MS = 400

// `@__PURE__` so a bundle that only pulls `OPEN_REVIEW_JOURNALS` /
// `isOpenReviewJournal` out of this module (categorize.ts re-exports both) can
// tree-shake the limiter — and with it `./http` — instead of retaining them
// for a top-level call it must otherwise assume has side effects.
const limiter = /* @__PURE__ */ createRateLimiter(MIN_REQUEST_GAP_MS)

/**
 * Journals that publish before review and record the outcome in Crossref
 * assertions.
 *
 * Lives here rather than in `categorize.ts` so that the module doing the
 * Crossref lookup owns the list it filters on; `categorize.ts` re-exports it.
 * Values match `R/categorize.R:10-13`.
 */
export const OPEN_REVIEW_JOURNALS: readonly string[] = [
  'f1000research',
  'f1000 research',
  'wellcome open research',
  'gates open research',
  'hrb open research',
]

/** Substring match, case-insensitive — journal strings vary between sources. */
export function isOpenReviewJournal(journal: string | undefined): boolean {
  const j = (journal ?? '').toLowerCase()
  if (j === '') return false
  return OPEN_REVIEW_JOURNALS.some((name) => j.includes(name))
}

interface CrossrefAssertion {
  name?: string | null
  value?: string | null
  label?: string | null
}

interface CrossrefAuthor {
  given?: string | null
  family?: string | null
  /** group/consortium authors carry a single `name` instead of given+family */
  name?: string | null
}

interface CrossrefWorkResponse {
  message?: {
    assertion?: CrossrefAssertion[] | null
    author?: CrossrefAuthor[] | null
  } | null
}

export interface PeerReviewResult {
  publications: Publication[]
  warnings: string[]
}

/** Does this assertion set say at least one referee approved the article? */
export function assertionsShowApproval(assertions: CrossrefAssertion[]): boolean {
  for (const assertion of assertions) {
    const name = (assertion.name ?? '').toLowerCase()
    const value = (assertion.value ?? '').toLowerCase()
    if (name === 'referee-status' && (value === 'indexed' || value.includes('approved'))) {
      return true
    }
    if (name.startsWith('referee-response') && value.includes('approved')) {
      return true
    }
  }
  return false
}

/**
 * `true` when Crossref shows referee approval, `false` when it shows none,
 * `undefined` when the lookup failed (so the caller can leave
 * `peerReviewApproved` unset rather than assert "not approved").
 */
export async function checkPeerReviewApproval(
  doi: string,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  const value = doi.trim()
  if (value === '') return undefined

  const data = await limiter(
    () =>
      getJson<CrossrefWorkResponse>(`${CROSSREF_WORKS}/${encodeURIComponent(value)}`, { signal }),
    signal,
  )
  return assertionsShowApproval(data.message?.assertion ?? [])
}

/**
 * Set `peerReviewApproved` on every open-review-journal publication that has a
 * DOI. Other records are returned untouched.
 */
export async function enrichPeerReviewWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<PeerReviewResult> {
  const warnings: string[] = []
  const targets: number[] = []

  pubs.forEach((pub, index) => {
    if (!pub.doi || pub.doi.trim() === '') return
    if (!isOpenReviewJournal(pub.journal)) return
    targets.push(index)
  })

  if (targets.length === 0) return { publications: pubs, warnings }

  const publications = [...pubs]

  for (const index of targets) {
    const pub = publications[index]
    try {
      const approved = await checkPeerReviewApproval(pub.doi as string, signal)
      if (approved !== undefined) {
        publications[index] = { ...pub, peerReviewApproved: approved }
      }
    } catch (err) {
      if (signal?.aborted) throw err
      warnings.push(`Crossref ${pub.doi}: ${errorMessage(err)}`)
    }
  }

  return { publications, warnings }
}

/** `enrichPeerReviewWithWarnings` without the warnings. */
export async function enrichPeerReview(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await enrichPeerReviewWithWarnings(pubs, signal)
  return publications
}

// ──────────────────────────────────────────────────── full author names ──

/*
 * Crossref is the last resort for FULL author names, and it exists here for
 * exactly one reason: `format.ts` decides which authors to bold by matching
 * against `Publication.authorsFull`. A short form such as "Furukawa Y" cannot
 * separate "Furukawa Yuki" from "Furukawa Yuri", so a record whose full names
 * OpenAlex failed to supply will happily bold the wrong person.
 *
 * This is ONE SERIALIZED REQUEST PER DOI. It must never be run across a whole
 * list — `pipeline.ts` calls it only for the handful of records where a bold
 * name was actually detected as ambiguous.
 */

export interface AuthorNamesResult {
  publications: Publication[]
  warnings: string[]
}

/** `message.author[]` → display names, in Crossref's own order. */
export function crossrefAuthorNames(authors: CrossrefAuthor[]): string[] {
  const out: string[] = []
  for (const author of authors) {
    const given = (author.given ?? '').trim()
    const family = (author.family ?? '').trim()
    const name = (author.name ?? '').trim()
    const full =
      family !== '' ? [given, family].filter((p) => p !== '').join(' ') : name
    if (full !== '') out.push(full)
  }
  return out
}

/** Full author names for one DOI. Throws on failure; callers warn instead. */
export async function fetchCrossrefAuthorNames(
  doi: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const value = doi.trim()
  if (value === '') return []

  const data = await limiter(
    () =>
      getJson<CrossrefWorkResponse>(`${CROSSREF_WORKS}/${encodeURIComponent(value)}`, { signal }),
    signal,
  )
  return crossrefAuthorNames(data.message?.author ?? [])
}

/**
 * Fill `authorsFull` from Crossref for the given records.
 *
 * Only records that have a DOI *and* an unusable `authorsFull` (empty, or a
 * different length from `authors`, which is what makes `format.ts` fall back to
 * short-form matching) are looked up. Everything else is returned untouched.
 *
 * Crossref's author order is the published order, so when a record had no
 * author list at all the short forms are derived from the same array and the
 * two stay aligned.
 */
export async function enrichAuthorNamesWithWarnings(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<AuthorNamesResult> {
  const warnings: string[] = []
  const targets: number[] = []

  pubs.forEach((pub, index) => {
    if (!pub.doi || pub.doi.trim() === '') return
    const full = pub.authorsFull ?? []
    const short = pub.authors ?? []
    if (full.length > 0 && full.length === short.length) return
    targets.push(index)
  })

  if (targets.length === 0) return { publications: pubs, warnings }

  const publications = [...pubs]

  for (const index of targets) {
    const pub = publications[index]
    try {
      const names = await fetchCrossrefAuthorNames(pub.doi as string, signal)
      if (names.length === 0) continue
      const merged: Publication = { ...pub, authorsFull: names }
      if ((pub.authors ?? []).length !== names.length) {
        merged.authors = names.map((n) => formatAuthorShort(n))
      }
      publications[index] = merged
    } catch (err) {
      if (signal?.aborted) throw err
      warnings.push(`Crossref authors ${pub.doi}: ${errorMessage(err)}`)
    }
  }

  return { publications, warnings }
}

/** `enrichAuthorNamesWithWarnings` without the warnings. */
export async function enrichAuthorNames(
  pubs: Publication[],
  signal?: AbortSignal,
): Promise<Publication[]> {
  const { publications } = await enrichAuthorNamesWithWarnings(pubs, signal)
  return publications
}
