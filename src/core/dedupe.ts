/**
 * Deduplication and record merging.
 *
 * Port of `publication-list-generator/R/deduplicate.R`, restructured around the
 * stable `Publication.key` from `ids.ts`.
 *
 * The guiding rule is **merge, never discard**: when two records describe the
 * same work, the survivor has to carry the union of everything both knew
 * (`sources`, `seedIds`, the richer author list, the higher trust level).
 * Dropping a record silently is how a publication loses the seed that found it
 * and then disappears from the list on the next run.
 *
 * Framework-free.
 */

import type { Publication, SourceName, Trust } from './types'
import { pubKey, titleSlug } from './ids'

export interface DedupeResult {
  /** one record per distinct work */
  publications: Publication[]
  /** human-readable notes about merges that were not key-identical */
  warnings: string[]
}

/** The key a record is grouped under; recomputed if it was never assigned. */
function keyOf(pub: Publication): string {
  const k = pub.key?.trim()
  return k != null && k !== '' ? k : pubKey(pub)
}

/**
 * Key precedence: a DOI-keyed record is a better merge base than a PMID-keyed
 * one, which is better than a title-slug one. Only matters in the title pass,
 * where the merged group has mixed keys.
 */
function keyRank(key: string): number {
  if (key.startsWith('doi:')) return 0
  if (key.startsWith('pmid:')) return 1
  return 2
}

function versionOf(pub: Publication): number {
  return typeof pub.doiVersion === 'number' && Number.isFinite(pub.doiVersion)
    ? pub.doiVersion
    : 0
}

/**
 * Order the records of a group so the merge base comes first.
 *
 * `keyRank` asc, then `doiVersion` **desc** — this is `slice_max(doi_version)`
 * from `R/deduplicate.R:33`. Ties fall back to the original input order, which
 * keeps the whole function deterministic.
 */
function orderForMerge(records: Publication[]): Publication[] {
  return records
    .map((pub, index) => ({ pub, index }))
    .sort((a, b) => {
      const rank = keyRank(keyOf(a.pub)) - keyRank(keyOf(b.pub))
      if (rank !== 0) return rank
      const version = versionOf(b.pub) - versionOf(a.pub)
      if (version !== 0) return version
      return a.index - b.index
    })
    .map((entry) => entry.pub)
}

function firstString(
  records: Publication[],
  pick: (pub: Publication) => string | undefined,
): string | undefined {
  for (const pub of records) {
    const v = pick(pub)
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

function firstNumber(
  records: Publication[],
  pick: (pub: Publication) => number | undefined,
): number | undefined {
  for (const pub of records) {
    const v = pick(pub)
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return undefined
}

function firstDefined<T>(
  records: Publication[],
  pick: (pub: Publication) => T | undefined,
): T | undefined {
  for (const pub of records) {
    const v = pick(pub)
    if (v !== undefined) return v
  }
  return undefined
}

/** Longest wins; ties keep the earlier (higher-version) record's array. */
function longestArray(
  records: Publication[],
  pick: (pub: Publication) => string[] | undefined,
): string[] {
  let best: string[] = []
  for (const pub of records) {
    const v = pick(pub)
    if (Array.isArray(v) && v.length > best.length) best = v
  }
  return [...best]
}

function unionStrings(values: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of values) {
    if (!Array.isArray(list)) continue
    for (const v of list) {
      if (v == null || v === '' || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/**
 * Merge one group of records describing the same work.
 *
 * - scalars: first non-empty value, walking the group highest-version-first
 * - `authors` / `authorsFull`: the longest array (a truncated ORCID author list
 *   must not overwrite a complete PubMed one)
 * - `sources` / `seedIds`: union, first-seen order
 * - `trust`: `confirmed` if **any** record in the group is confirmed — a record
 *   confirmed by one seed does not go back into the review queue because
 *   another seed found it as a candidate
 */
function mergeGroup(group: Publication[]): Publication {
  const ordered = orderForMerge(group)
  const base = ordered[0]

  const trust: Trust = ordered.some((p) => p.trust === 'confirmed')
    ? 'confirmed'
    : 'candidate'

  const merged: Publication = {
    key: keyOf(base),
    title: firstString(ordered, (p) => p.title) ?? '',
    authors: longestArray(ordered, (p) => p.authors),
    authorsFull: longestArray(ordered, (p) => p.authorsFull),
    journal: firstString(ordered, (p) => p.journal) ?? '',
    year: firstNumber(ordered, (p) => p.year) ?? base.year,
    sources: unionStrings(ordered.map((p) => p.sources)) as SourceName[],
    seedIds: unionStrings(ordered.map((p) => p.seedIds)),
    trust,
  }

  const month = firstNumber(ordered, (p) => p.month)
  if (month !== undefined) merged.month = month
  const doi = firstString(ordered, (p) => p.doi)
  if (doi !== undefined) merged.doi = doi
  const doiVersion = firstNumber(ordered, (p) => p.doiVersion)
  if (doiVersion !== undefined) merged.doiVersion = doiVersion
  const pmid = firstString(ordered, (p) => p.pmid)
  if (pmid !== undefined) merged.pmid = pmid
  const language = firstString(ordered, (p) => p.language)
  if (language !== undefined) merged.language = language
  const orcidType = firstString(ordered, (p) => p.orcidType)
  if (orcidType !== undefined) merged.orcidType = orcidType
  const openAlexType = firstString(ordered, (p) => p.openAlexType)
  if (openAlexType !== undefined) merged.openAlexType = openAlexType
  const peerReviewApproved = firstDefined(ordered, (p) => p.peerReviewApproved)
  if (peerReviewApproved !== undefined) {
    merged.peerReviewApproved = peerReviewApproved
  }
  const category = firstDefined(ordered, (p) => p.category)
  if (category !== undefined) merged.category = category

  return merged
}

/** Title+year signature for the near-duplicate pass; `null` when unusable. */
function titleYearSignature(pub: Publication): string | null {
  const slug = titleSlug(pub.title ?? '')
  if (slug === '') return null
  if (!Number.isFinite(pub.year) || pub.year <= 0) return null
  return `${slug}|${pub.year}`
}

/**
 * Collapse duplicate records into one per work.
 *
 * **Pass 1 — key.** Records are grouped by `Publication.key`. Because
 * `pubKey()` version-strips F1000-style DOIs, the v1/v2/v3 records of one paper
 * already share a key, so the version collapse falls out of the grouping. What
 * does *not* fall out is which record wins: the group is merged
 * highest-`doiVersion`-first, so the surviving metadata is v3's, not whichever
 * source happened to be fetched first (`slice_max(doi_version)`,
 * `R/deduplicate.R:33`).
 *
 * **Pass 2 — title + year.** Records that kept different keys (a DOI-only
 * record from ORCID and a PMID-only record from researchmap, say) but share a
 * normalized title *and* a year are merged too, using the same title
 * normalization as `pubKey`'s slug. Every such merge emits a warning naming the
 * title: a title match is a heuristic, and a silent heuristic merge is exactly
 * how a wrong record gets hidden.
 *
 * Output order is deterministic: groups appear in the order their key was first
 * seen in the input, and a title merge keeps the position of its earliest group.
 */
export function dedupePublications(pubs: Publication[]): DedupeResult {
  const warnings: string[] = []
  if (pubs.length === 0) return { publications: [], warnings }

  // Pass 1: exact key.
  const byKey = new Map<string, Publication[]>()
  for (const pub of pubs) {
    const key = keyOf(pub)
    const group = byKey.get(key)
    if (group) group.push(pub)
    else byKey.set(key, [pub])
  }

  const merged = Array.from(byKey.values(), mergeGroup)

  // Pass 2: same normalized title + same year, different keys.
  const bySignature = new Map<string, Publication[]>()
  const order: (string | number)[] = []
  merged.forEach((pub, index) => {
    const signature = titleYearSignature(pub)
    if (signature == null) {
      order.push(index)
      return
    }
    const group = bySignature.get(signature)
    if (group) {
      group.push(pub)
    } else {
      bySignature.set(signature, [pub])
      order.push(signature)
    }
  })

  const publications = order.map((entry) => {
    if (typeof entry === 'number') return merged[entry]
    const group = bySignature.get(entry) ?? []
    if (group.length === 1) return group[0]
    const result = mergeGroup(group)
    const keys = group.map(keyOf).join(', ')
    warnings.push(
      `Merged ${group.length} records with the same title and year as one publication: ` +
        `"${result.title}" (${result.year}) — keys: ${keys}. ` +
        `Check that these are really the same work.`,
    )
    return result
  })

  return { publications, warnings }
}
