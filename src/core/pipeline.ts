/**
 * `ListConfig` → `ListModel`: the whole fetch/merge/enrich/filter flow.
 *
 * Framework-free, like everything under `src/core`. It runs unchanged in the
 * React wizard and inside the embed bundle on someone else's page.
 *
 * Every upstream call goes through the `…WithWarnings` twin of the source
 * function. The plain forms swallow failures and return `[]`, which is exactly
 * how this tool would end up quietly showing a researcher a shorter list than
 * they have — a lie that looks like a working page.
 *
 * Stage order (the numbers are also the `onProgress` checkpoints):
 *
 *   1. seeds → members     resolve display names, merge same-person rows
 *   2. fetch               ORCID + researchmap + one PubMed search per query
 *   3. include / exclude   force-confirm and back-fill pinned, THEN drop
 *                          excluded — an exclude outranks a pin, *reported*
 *   4. dedupe              one record per work
 *   5. enrich              OpenAlex (doi → pmid → title), then Crossref
 *  5c. seed windows        per-member tenure, applied per SEED, *reported*
 *   6. categorize          erratum/paratext split out and *reported*
 *  6b. preprints          held back unless `preprints: 'include'`, *reported*
 *   7. filter              date range, then limit
 *   8. sort                year desc, month desc, first author asc
 *   9. split               confirmed → publications, candidate → candidates
 */

import type {
  DroppedCounts,
  ListConfig,
  ListModel,
  Member,
  Publication,
  Trust,
} from './types'
import type { IdRef } from './ids'
import {
  matchesIdRef,
  normalizeDoi,
  parseIdRef,
  pubKey,
  sameIdRef,
  stripDoiVersion,
} from './ids'
import { dedupePublications } from './dedupe'
import { categorizeAll, isOpenReviewJournal } from './categorize'
import { matchesBoldName } from './format'
import { fetchOrcidPerson, fetchOrcidWorksWithWarnings } from './sources/orcid'
import {
  fetchResearchmapProfile,
  fetchResearchmapWorksWithWarnings,
} from './sources/researchmap'
import type { ResearchmapProfile } from './sources/researchmap'
import {
  fetchPubmedSummariesWithWarnings,
  isAuidQuery,
  searchPubmedWithWarnings,
} from './sources/pubmed'
import {
  enrichByDoiWithWarnings,
  enrichByPmidWithWarnings,
  enrichByTitleWithWarnings,
} from './sources/openalex'
import {
  enrichAuthorNamesWithWarnings,
  enrichPeerReviewWithWarnings,
} from './sources/crossref'
import {
  INCLUDE_SEED_ID,
  applySeedWindows,
  publicationYearMonth,
  seedIdList,
  yearMonthBound,
} from './seeds'
import { chunk, errorMessage, getJson } from './sources/http'
import { formatAuthorShort } from './sources/names'
import type { PersonNameAnchor } from './sources/names'

export interface BuildListOptions {
  /** Caller-owned cancellation, propagated to every request. */
  signal?: AbortSignal
  /** 0–100 plus a short human-readable stage description. */
  onProgress?: (pct: number, message: string) => void
}

/** `esearch` default `retmax`; a query that hits it is too broad to trust. */
const PUBMED_RESULT_CAP = 200

const OPENALEX_WORKS = 'https://api.openalex.org/works'
const OPENALEX_CHUNK_SIZE = 50
const OPENALEX_SELECT =
  'id,doi,ids,type,title,publication_year,publication_date,primary_location,authorships'

// ─────────────────────────────────────────────────────────────── members ──

/**
 * Port of `normalize_name` (`publication-list-generator/app.R:119-125`):
 * lowercase, strip diacritics, keep letters and spaces, collapse whitespace.
 *
 * A purely Japanese name normalizes to `''`; the caller treats that as "no
 * key" rather than merging every such member into one row (dplyr's `group_by`
 * would have grouped all the `NA`s together — that is a bug, not a feature).
 */
export function normalizeMemberName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Merge members that resolve to the same normalized name, keeping the order of
 * first appearance (`app.R:126-139`). One person seeded by both an ORCID id and
 * a researchmap permalink becomes a single member carrying both.
 */
export function mergeMembers(members: Member[]): Member[] {
  const groups = new Map<string, Member[]>()
  const order: string[] = []

  members.forEach((member, index) => {
    const normalized = member.name ? normalizeMemberName(member.name) : ''
    // `#index` keeps unnamed / non-Latin-named members distinct.
    const key = normalized === '' ? `#${index}` : normalized
    const group = groups.get(key)
    if (group) {
      group.push(member)
    } else {
      groups.set(key, [member])
      order.push(key)
    }
  })

  return order.map((key) => {
    const group = groups.get(key) ?? []
    const merged: Member = { id: group[0].id }
    const name = group.find((m) => (m.name ?? '').trim() !== '')?.name
    if (name) merged.name = name
    const orcid = group.find((m) => m.orcid)?.orcid
    if (orcid) merged.orcid = orcid
    const researchmap = group.find((m) => m.researchmap)?.researchmap
    if (researchmap) merged.researchmap = researchmap
    return merged
  })
}

interface SeedResolution {
  /** Merged member rows. Resolves once any researchmap profile lookup lands. */
  members: Promise<Member[]>
  /**
   * Everyone whose given/family split is known, so `researchmap.ts` can measure
   * whether an author list is written given-first or family-first instead of
   * assuming. Same timing as `members`; handed straight to the papers fetch so
   * the two requests overlap.
   */
  anchors: Promise<PersonNameAnchor[]>
}

/**
 * Resolve seed identifiers to people.
 *
 * Awaits only the ORCID `/person` calls — cheap (~200 ms, a few hundred bytes)
 * and the only endpoint here that returns a name pre-split. Everything that
 * depends on a researchmap profile comes back as a promise so the caller can
 * fire the papers request against it rather than after it.
 *
 * A researchmap profile costs ~2 s and ~60–200 KB to yield the same two fields,
 * so it is skipped outright once an ORCID seed has supplied both a display name
 * (or `config.boldNames` has) *and* an anchor. `boldNames` alone is not enough:
 * it covers the display-name half of what the profile is for and nothing of the
 * name-order half, and dropping the anchor is what corrupts author names.
 *
 * When the profile is skipped and exactly one ORCID name was resolved, that
 * name is attributed to the researchmap seed too. It is the same assumption the
 * skip itself rests on — one person, seeded twice — and without it
 * `mergeMembers` would split them into two rows purely because we declined to
 * pay for the lookup.
 */
async function resolveSeeds(
  config: ListConfig,
  signal?: AbortSignal,
): Promise<SeedResolution> {
  // Ids only: a seed's time window is applied at stage 5c, over the built
  // records, not here. Whether a seed is a bare string or a windowed object
  // makes no difference to whose profile has to be fetched.
  const orcids = seedIdList(config.seeds.orcid)
  const researchmaps = seedIdList(config.seeds.researchmap)
  if (orcids.length === 0 && researchmaps.length === 0) {
    return { members: Promise.resolve([]), anchors: Promise.resolve([]) }
  }

  const people = await Promise.all(orcids.map((id) => fetchOrcidPerson(id, signal)))
  const orcidAnchors = people
    .map((p) => p.anchor)
    .filter((a): a is PersonNameAnchor => a !== undefined)

  const namedByOrcid = [...new Set(people.map((p) => p.name).filter((n): n is string => !!n))]
  const skipProfile =
    orcidAnchors.length > 0 && (namedByOrcid.length > 0 || !!config.boldNames?.length)

  // Deliberately not awaited: the caller passes `anchors` into the papers
  // fetch, so a profile lookup that does happen runs alongside it.
  const profiles: Promise<ResearchmapProfile[]> = skipProfile
    ? Promise.resolve(researchmaps.map(() => ({})))
    : Promise.all(researchmaps.map((id) => fetchResearchmapProfile(id, signal)))

  const inheritedName = skipProfile && namedByOrcid.length === 1 ? namedByOrcid[0] : undefined

  const anchors = profiles.then((resolved) => [
    ...orcidAnchors,
    ...resolved
      .map((p) => p.anchor)
      .filter((a): a is PersonNameAnchor => a !== undefined),
  ])

  const members = profiles.then((resolved) => {
    const raw: Member[] = []
    orcids.forEach((id, i) => {
      const member: Member = { id, orcid: id }
      if (people[i].name) member.name = people[i].name
      raw.push(member)
    })
    researchmaps.forEach((id, i) => {
      const member: Member = { id, researchmap: id }
      const name = resolved[i].name ?? inheritedName
      if (name) member.name = name
      raw.push(member)
    })
    return mergeMembers(raw)
  })

  return { members, anchors }
}

// ────────────────────────────────────────────────────────── bold names ──

/** Particles that belong to the surname, mirroring `format.ts`. */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'di', 'la', 'le', 'el', 'al',
  'den', 'der', 'das', 'dos',
])

/**
 * Is this name written in short form (`Furukawa Y`, or a bare surname)?
 *
 * Short forms carry no information that separates `Furukawa Yuki` from
 * `Furukawa Yuri`, so a bold name in short form can never be resolved by
 * fetching more data — only by the user spelling it out.
 */
export function isShortFormName(name: string): boolean {
  const parts = normalizeMemberName(name).split(' ').filter((p) => p !== '')
  const words = parts.filter((p) => p.length >= 2 && !PARTICLES.has(p))
  return words.length < 2
}

/**
 * Resolve `config.boldNames` to FULL names taken from the seed profiles.
 *
 * `format.ts` matches bold names against `Publication.authorsFull`; feeding it
 * a short form makes that matching useless. So a configured bold name that
 * resolves to a member (ORCID credit-name, researchmap name) is replaced by
 * that member's full name, and a config with no bold names at all defaults to
 * every member's full name.
 */
export function resolveBoldNames(
  configured: readonly string[] | undefined,
  members: readonly Member[],
): string[] {
  const memberNames = members
    .map((m) => (m.name ?? '').trim())
    .filter((n) => n !== '')

  const source =
    configured && configured.length > 0
      ? configured.map((n) => n.trim()).filter((n) => n !== '')
      : memberNames

  const out: string[] = []
  for (const name of source) {
    // A member's own full name is strictly more informative than whatever the
    // user typed, provided the two refer to the same person.
    const full = memberNames.find(
      (candidate) =>
        !isShortFormName(candidate) && matchesBoldName(candidate, [name]),
    )
    const resolved = full ?? name
    if (!out.includes(resolved)) out.push(resolved)
  }
  return out
}

interface BoldMatch {
  /** keys of records where a matching author has no usable full name */
  missing: Set<string>
  /** distinct normalized full names the bold name landed on */
  distinct: Set<string>
}

/**
 * Where does one bold name land across the fetched set?
 *
 * The per-author full name is only usable when `authorsFull` lines up with
 * `authors` — that is precisely the condition `format.ts` uses before it trusts
 * the full list, so anything else counts as "no full name".
 */
function locateBoldName(pubs: readonly Publication[], boldName: string): BoldMatch {
  const missing = new Set<string>()
  const distinct = new Set<string>()

  for (const pub of pubs) {
    const authors = pub.authors ?? []
    const full = pub.authorsFull ?? []
    const aligned = full.length === authors.length && full.length > 0

    authors.forEach((short, i) => {
      // Family + initial matching: `matchesBoldName` takes exactly this route
      // when the author name it is given is a short form.
      if (!matchesBoldName(short, [boldName])) return
      const fullName = aligned ? (full[i] ?? '').trim() : ''
      if (fullName === '' || isShortFormName(fullName)) missing.add(pub.key)
      else distinct.add(normalizeMemberName(fullName))
    })
  }

  return { missing, distinct }
}

// ─────────────────────────────────────────────────── pinned DOI lookup ──

interface OpenAlexWorkLite {
  doi?: string | null
  ids?: { doi?: string | null; pmid?: string | null } | null
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

interface OpenAlexListLite {
  results?: OpenAlexWorkLite[] | null
}

/**
 * Build records for DOIs that no seed produced.
 *
 * `openalex.ts` only *enriches* existing records — it never creates one, and it
 * deliberately does not copy a title onto a record that has one. A user who
 * pins a DOI has no seed record to enrich, so the pinned work is materialized
 * here (title included) and the normal enrichment stage fills in the rest.
 */
async function fetchPinnedDois(
  dois: string[],
  signal?: AbortSignal,
): Promise<{ publications: Publication[]; warnings: string[] }> {
  const publications: Publication[] = []
  const warnings: string[] = []
  if (dois.length === 0) return { publications, warnings }

  for (const batch of chunk(dois, OPENALEX_CHUNK_SIZE)) {
    const joined = batch.map((d) => encodeURIComponent(d)).join('|')
    const url =
      `${OPENALEX_WORKS}?filter=doi:${joined}` +
      `&per-page=${OPENALEX_CHUNK_SIZE}&select=${OPENALEX_SELECT}`
    try {
      const data = await getJson<OpenAlexListLite>(url, { signal })
      for (const work of data.results ?? []) {
        const raw = work.doi ?? work.ids?.doi
        if (!raw) continue
        const doi = normalizeDoi(raw)
        const title = (work.title ?? '').trim()
        const pmidUrl = work.ids?.pmid ?? ''
        const pmidMatch = /(\d+)\s*$/.exec(pmidUrl)
        const fullNames = (work.authorships ?? [])
          .map((a) => (a.author?.display_name ?? a.raw_author_name ?? '').trim())
          .filter((n) => n !== '')
        const month = Number.parseInt(
          (work.publication_date ?? '').slice(5, 7),
          10,
        )

        const pub: Publication = {
          key: pubKey({ title, doi }),
          title,
          authors: fullNames.map((n) => formatAuthorShort(n)),
          authorsFull: fullNames,
          authorsSource: 'openalex',
          journal: (work.primary_location?.source?.display_name ?? '').trim(),
          year:
            typeof work.publication_year === 'number' ? work.publication_year : 0,
          doi,
          sources: ['manual'],
          seedIds: [INCLUDE_SEED_ID],
          trust: 'confirmed',
        }
        const version = stripDoiVersion(doi).version
        if (version !== undefined) pub.doiVersion = version
        if (pmidMatch) pub.pmid = pmidMatch[1]
        if (Number.isFinite(month) && month >= 1 && month <= 12) pub.month = month
        const type = (work.type ?? '').trim()
        if (type !== '') pub.openAlexType = type

        publications.push(pub)
      }
    } catch (err) {
      if (signal?.aborted) throw err
      warnings.push(
        `OpenAlex pinned DOI batch (${batch.length} from ${batch[0]}): ${errorMessage(err)}`,
      )
    }
  }

  return { publications, warnings }
}

// ───────────────────────────────────────────────────────────── helpers ──

function refKey(ref: IdRef): string {
  return `${ref.kind}:${ref.value}`
}

function comparePublications(a: Publication, b: Publication): number {
  const ay = typeof a.year === 'number' ? a.year : 0
  const by = typeof b.year === 'number' ? b.year : 0
  if (ay !== by) return by - ay
  const am = a.month ?? 0
  const bm = b.month ?? 0
  if (am !== bm) return bm - am
  const aa = (a.authors?.[0] ?? '').toLowerCase()
  const ba = (b.authors?.[0] ?? '').toLowerCase()
  if (aa !== ba) return aa < ba ? -1 : 1
  return 0
}

/** `Family I` signature used by the candidate triage. */
function authorSignature(name: string): string {
  const normalized = normalizeMemberName(name)
  if (normalized === '') return ''
  const parts = normalized.split(' ')
  const words = parts.filter((p) => p.length >= 2)
  const initials = parts.filter((p) => p.length === 1)
  if (words.length === 0) return ''
  const family = words[0]
  const initial = initials[0] ?? words[1]?.charAt(0) ?? ''
  return `${family} ${initial}`.trim()
}

function affiliationTokens(pub: Publication): string[] {
  const out: string[] = []
  for (const affiliation of pub.affiliations ?? []) {
    for (const token of normalizeMemberName(affiliation).split(' ')) {
      // Single letters and generic words carry no signal.
      if (token.length >= 4) out.push(token)
    }
  }
  return out
}

/**
 * Pre-select the candidates that are probably the same person's work.
 *
 * A candidate qualifies when it shares a **co-author** family name + initial
 * with the confirmed set, or an affiliation token with it. The researcher's own
 * name is excluded from both sides — every hit of a `Furukawa Y[au]` query
 * shares "furukawa y" with the confirmed set, so counting it would pre-select
 * the entire review queue and defeat the point.
 */
export function triageCandidates(
  confirmed: readonly Publication[],
  candidates: readonly Publication[],
  boldNames: readonly string[],
): string[] {
  const isSelf = (name: string) =>
    boldNames.length > 0 && matchesBoldName(name, boldNames)

  const coauthors = new Set<string>()
  const affiliations = new Set<string>()
  for (const pub of confirmed) {
    for (const name of pub.authors ?? []) {
      if (isSelf(name)) continue
      const signature = authorSignature(name)
      if (signature !== '') coauthors.add(signature)
    }
    for (const token of affiliationTokens(pub)) affiliations.add(token)
  }

  const suggested: string[] = []
  for (const pub of candidates) {
    const sharesCoauthor = (pub.authors ?? []).some(
      (name) => !isSelf(name) && coauthors.has(authorSignature(name)),
    )
    const sharesAffiliation = affiliationTokens(pub).some((t) =>
      affiliations.has(t),
    )
    if (sharesCoauthor || sharesAffiliation) suggested.push(pub.key)
  }
  return suggested
}

// ──────────────────────────────────────────────────────────── buildList ──

/**
 * Run the whole pipeline.
 *
 * Never rejects for an upstream failure — a dead ORCID, a rate-limited PubMed
 * or a 500 from OpenAlex lands in `ListModel.warnings` and the rest of the list
 * still comes back. It *does* reject when `opts.signal` aborts.
 */
export async function buildList(
  config: ListConfig,
  opts: BuildListOptions = {},
): Promise<ListModel> {
  const signal = opts.signal
  const report = (pct: number, message: string) => opts.onProgress?.(pct, message)
  const warnings: string[] = []
  /**
   * Filled in as each filtering stage runs. Every increment below sits next to
   * the `warnings.push` that already describes the same drop in prose — the
   * counts exist so the wizard can say *which* filter emptied a list, which the
   * prose cannot do once there are several of them.
   */
  const dropped: DroppedCounts = {
    excluded: 0,
    window: 0,
    erratum: 0,
    preprint: 0,
    dateRange: 0,
    limit: 0,
  }

  // ── 1. seeds → members ────────────────────────────────────────────────
  // Only the ORCID `/person` calls are awaited here. Anything that needs a
  // researchmap profile comes back as a promise and is resolved during stage 2,
  // so the slowest profile lookup overlaps the works fetches instead of
  // preceding them.
  report(2, 'Resolving seed profiles')
  const seeds = await resolveSeeds(config, signal)

  // ── 2. fetch ──────────────────────────────────────────────────────────
  report(10, 'Fetching publications')
  const fetched: Publication[] = []

  const orcidSeeds = seedIdList(config.seeds.orcid)
  const researchmapSeeds = seedIdList(config.seeds.researchmap)

  const [orcidResults, researchmapResults] = await Promise.all([
    Promise.all(orcidSeeds.map((id) => fetchOrcidWorksWithWarnings(id, signal))),
    Promise.all(
      researchmapSeeds.map((id) =>
        fetchResearchmapWorksWithWarnings(id, { signal, anchors: seeds.anchors }),
      ),
    ),
  ])
  for (const result of [...orcidResults, ...researchmapResults]) {
    fetched.push(...result.publications)
    warnings.push(...result.warnings)
  }

  const members = await seeds.members
  const boldNames = resolveBoldNames(config.boldNames, members)

  // PubMed runs serially: `sources/pubmed.ts` already funnels every request
  // through one rate limiter, so parallelism here would only queue.
  for (const seed of config.seeds.pubmed ?? []) {
    // `[auid]` is an ORCID identifier search — essentially free of same-name
    // contamination. Every other query is a name search and stays a candidate.
    const trust: Trust = isAuidQuery(seed.query) ? 'confirmed' : 'candidate'
    const search = await searchPubmedWithWarnings(seed.query, {}, signal)
    warnings.push(...search.warnings)
    if (search.pmids.length === 0) continue
    if (search.pmids.length >= PUBMED_RESULT_CAP) {
      warnings.push(
        `PubMed query "${seed.query}" returned the maximum of ${PUBMED_RESULT_CAP} results; ` +
          `it is probably too broad. Narrow it with an affiliation or a year range.`,
      )
    }
    const summaries = await fetchPubmedSummariesWithWarnings(
      search.pmids,
      { trust, seedIds: [seed.label ?? seed.query] },
      signal,
    )
    fetched.push(...summaries.publications)
    warnings.push(...summaries.warnings)
  }

  // ── 3. include / exclude ──────────────────────────────────────────────
  //
  // **An exclude outranks a pin.** Excludes are applied after includes and are
  // allowed to remove a pinned record.
  //
  // Excluding is the corrective, more specific act: it is how a wrong pin gets
  // undone. That mattered little when pins were only ever typed one at a time,
  // but `planFreeze` now writes a departing member's entire publication list
  // into `include` in one click, and one of those twenty-odd records being
  // wrong — a paper from their new institution that happened to be showing at
  // freeze time, or a misattribution — is ordinary. Under the old precedence
  // the only way out was to find and hand-edit the `include` list, and the
  // review queue's reject button appeared to do nothing at all.
  //
  // So "get this off my page" always works. What it must not do is work
  // silently: a pin the owner wrote is evidence of intent, and a config where
  // the two lists disagree should say so rather than quietly picking a side.
  report(40, 'Applying pinned and excluded records')

  const excludeRefs: IdRef[] = []
  for (const raw of config.exclude ?? []) {
    const ref = parseIdRef(raw)
    if (ref) excludeRefs.push(ref)
    else warnings.push(`Ignored unrecognized exclude reference "${raw}".`)
  }

  const includeRefs: IdRef[] = []
  const seenIncludes = new Set<string>()
  for (const raw of config.include ?? []) {
    const ref = parseIdRef(raw)
    if (!ref) {
      warnings.push(`Ignored unrecognized include reference "${raw}".`)
      continue
    }
    if (seenIncludes.has(refKey(ref))) continue
    seenIncludes.add(refKey(ref))
    includeRefs.push(ref)
  }

  /** `refKey`s of include entries an exclude cancelled. */
  const cancelledIncludes = new Set<string>()

  // A reference in both lists is dropped, and the pin is not even looked up:
  // materializing a record we are about to remove costs a round trip and would
  // report a pinned identifier as unretrievable when nothing is waiting for it.
  const activeIncludes = includeRefs.filter((ref) => {
    if (!excludeRefs.some((ex) => sameIdRef(ex, ref))) return true
    cancelledIncludes.add(refKey(ref))
    return false
  })

  // Deliberately the un-excluded set: an active pin that lands on a record an
  // exclude also names is marked here and removed below, which is what lets the
  // record-level check see the disagreement and report it. Filtering first
  // would instead make the pin look like a reference nothing could satisfy.
  let working = fetched

  const missingPmids: string[] = []
  const missingDois: string[] = []
  for (const ref of activeIncludes) {
    const hits = working.filter((pub) => matchesIdRef(pub, ref))
    if (hits.length > 0) {
      // A pinned record is confirmed by definition, whatever found it.
      working = working.map((pub) =>
        hits.includes(pub)
          ? {
              ...pub,
              trust: 'confirmed' as Trust,
              // This marker is what exempts the record from every seed time
              // window later on: an explicit pin outranks any date rule.
              seedIds: pub.seedIds.includes(INCLUDE_SEED_ID)
                ? pub.seedIds
                : [...pub.seedIds, INCLUDE_SEED_ID],
            }
          : pub,
      )
      continue
    }
    if (ref.kind === 'pmid') missingPmids.push(ref.value)
    else missingDois.push(ref.value)
  }

  if (missingPmids.length > 0) {
    const pinned = await fetchPubmedSummariesWithWarnings(
      missingPmids,
      { trust: 'confirmed', seedIds: [INCLUDE_SEED_ID] },
      signal,
    )
    working = [...working, ...pinned.publications]
    warnings.push(...pinned.warnings)
    const found = new Set(pinned.publications.map((p) => (p.pmid ?? '').trim()))
    for (const pmid of missingPmids) {
      if (!found.has(pmid)) warnings.push(`Pinned PMID ${pmid} could not be retrieved.`)
    }
  }

  // DOIs already materialized straight out of an OpenAlex work. Stage 5 skips
  // them: `fetchPinnedDois` copies exactly the fields `mergeOpenAlexWork` would,
  // so re-requesting them buys nothing but a round trip.
  const enrichedDois = new Set<string>()

  if (missingDois.length > 0) {
    const pinned = await fetchPinnedDois(missingDois, signal)
    working = [...working, ...pinned.publications]
    warnings.push(...pinned.warnings)
    const found = new Set(
      pinned.publications.map((p) => stripDoiVersion(p.doi ?? '').doi),
    )
    for (const pub of pinned.publications) {
      if (pub.doi) enrichedDois.add(pub.doi)
    }
    for (const doi of missingDois) {
      if (!found.has(stripDoiVersion(doi).doi)) {
        warnings.push(`Pinned DOI ${doi} could not be retrieved.`)
      }
    }
  }

  // Excludes last, over the pinned records too. The record-level pass catches
  // what the reference-level one above cannot: a work pinned by DOI and
  // excluded by PMID, or the other way round, is the same disagreement written
  // in two different identifiers.
  if (excludeRefs.length > 0) {
    const kept: Publication[] = []
    for (const pub of working) {
      if (!excludeRefs.some((ref) => matchesIdRef(pub, ref))) {
        kept.push(pub)
        continue
      }
      if (pub.seedIds.includes(INCLUDE_SEED_ID)) {
        for (const ref of activeIncludes) {
          if (matchesIdRef(pub, ref)) cancelledIncludes.add(refKey(ref))
        }
      }
    }
    dropped.excluded += working.length - kept.length
    working = kept
  }

  if (cancelledIncludes.size > 0) {
    // One warning for the lot, in `include` order, so a config someone
    // inherited reads as a single disagreement rather than a wall of them.
    const ids = includeRefs.map(refKey).filter((key) => cancelledIncludes.has(key))
    warnings.push(
      `Left ${ids.length} pinned record(s) off the list because they are also in ` +
        `exclude: ${ids.join(', ')}. An exclude outranks a pin, so a record you have ` +
        `taken off the list stays off — remove the reference from exclude to bring it back.`,
    )
  }

  // ── 4. dedupe ─────────────────────────────────────────────────────────
  report(52, 'Removing duplicates')
  const deduped = dedupePublications(working)
  // `dedupe.ts` promotes a merged record to `confirmed` if any of its parts was
  // confirmed — an ORCID record absorbing a PubMed candidate stays on the page.
  warnings.push(...deduped.warnings)
  let pubs = deduped.publications

  // ── 5. enrich ─────────────────────────────────────────────────────────
  // Must finish before ANY rendering: `format.ts` decides bold authors from
  // `authorsFull`, and OpenAlex is what populates it.
  report(58, 'Enriching metadata (OpenAlex)')
  const byDoi = await enrichByDoiWithWarnings(pubs, signal, { skipDois: enrichedDois })
  pubs = byDoi.publications
  warnings.push(...byDoi.warnings)

  report(66, 'Enriching metadata (OpenAlex, PMID)')
  const byPmid = await enrichByPmidWithWarnings(pubs, signal)
  pubs = byPmid.publications
  warnings.push(...byPmid.warnings)

  report(72, 'Enriching metadata (OpenAlex, title)')
  const byTitle = await enrichByTitleWithWarnings(pubs, signal)
  pubs = byTitle.publications
  warnings.push(...byTitle.warnings)

  report(78, 'Checking peer-review status (Crossref)')
  const reviewed = await enrichPeerReviewWithWarnings(pubs, signal)
  pubs = reviewed.publications
  warnings.push(...reviewed.warnings)

  // ── 5b. bold-name disambiguation ──────────────────────────────────────
  if (boldNames.length > 0) {
    report(82, 'Resolving author names')
    const needsNames = new Set<string>()
    for (const boldName of boldNames) {
      const { missing, distinct } = locateBoldName(pubs, boldName)
      if (distinct.size >= 2 || missing.size > 0) {
        for (const key of missing) needsNames.add(key)
      }
    }

    if (needsNames.size > 0) {
      // One serialized Crossref request per DOI — only for these records.
      const targets = pubs.filter((p) => needsNames.has(p.key))
      const enriched = await enrichAuthorNamesWithWarnings(targets, signal)
      warnings.push(...enriched.warnings)
      const replacements = new Map(enriched.publications.map((p, i) => [targets[i].key, p]))
      pubs = pubs.map((p) => replacements.get(p.key) ?? p)
    }

    for (const boldName of boldNames) {
      const { missing, distinct } = locateBoldName(pubs, boldName)
      // Only worth a warning when two *different* people answer to the same
      // family name + initial and something still has to guess between them.
      if (distinct.size < 2) continue
      if (!isShortFormName(boldName) && missing.size === 0) continue
      warnings.push(
        `Bold name "${boldName}" matches ${distinct.size} different authors ` +
          `(${[...distinct].join(', ')})` +
          (missing.size > 0 ? ` and ${missing.size} record(s) have no full author names` : '') +
          `. Spell the name out in full (for example "Yuki Furukawa") to disambiguate.`,
      )
    }
  }

  // ── 5c. seed windows ──────────────────────────────────────────────────
  // After enrichment, because OpenAlex is what supplies the publication month
  // on an ORCID record, and a window decided on a wrong date would remove real
  // work. Before categorization, so the erratum and preprint reports below
  // only name records that are actually in scope for this group.
  //
  // The filtering is per SEED (see `seeds.ts`): a paper co-authored by a
  // departed student and a current member survives on the current member's
  // seed. Pinned records are exempt outright.
  const windowed = applySeedWindows(pubs, config)
  dropped.window += pubs.length - windowed.publications.length
  pubs = windowed.publications
  warnings.push(...windowed.warnings)

  // ── 6. categorize ─────────────────────────────────────────────────────
  report(88, 'Categorizing')
  const categorized = categorizeAll(pubs)
  pubs = categorized.publications
  dropped.erratum += categorized.excluded.length
  if (categorized.excluded.length > 0) {
    warnings.push(
      `Excluded ${categorized.excluded.length} record(s) categorized as erratum or ` +
        `paratext: ${categorized.excluded
          .map((p) => p.title || p.doi || p.pmid || p.key)
          .join('; ')}`,
    )
  }

  // ── 6b. preprints ─────────────────────────────────────────────────────
  // Here rather than in `render.ts` so that `ListModel.publications` is the
  // list that is actually displayed — a count in the wizard that disagreed
  // with the page would be worse than either number on its own.
  //
  // Always reported, like the erratum drop above. A researcher whose medRxiv
  // preprints disappeared from their own page with no explanation has no way
  // to tell a setting from a bug.
  if ((config.preprints ?? 'exclude') === 'exclude') {
    const held = pubs.filter((p) => p.category === 'preprint')
    if (held.length > 0) {
      pubs = pubs.filter((p) => p.category !== 'preprint')
      dropped.preprint += held.length
      // Only mention the open-review rule when it actually applies, so nobody
      // reads it as "one of your journal articles was dropped".
      const openReview = held.filter((p) => isOpenReviewJournal(p.journal))
      warnings.push(
        `Held back ${held.length} preprint(s), which are not shown by default: ` +
          `${held.map((p) => p.title || p.doi || p.pmid || p.key).join('; ')}. ` +
          `Set preprints: 'include' (data-preprints="include") to show them.` +
          (openReview.length > 0
            ? ` ${openReview.length} of them ${openReview.length === 1 ? 'is an article' : 'are articles'} ` +
              `in an open-review journal that Crossref does not yet report as approved by referees; ` +
              `once the referees approve, it is filed as an original article instead.`
            : ''),
      )
    }
  }

  // ── 7. filter ─────────────────────────────────────────────────────────
  report(92, 'Filtering')
  const from = config.from ? yearMonthBound(config.from, 1) : null
  const to = config.to ? yearMonthBound(config.to, 12) : null
  if (from != null || to != null) {
    const before = pubs.length
    pubs = pubs.filter((pub) => {
      const value = publicationYearMonth(pub)
      if (from != null && value < from) return false
      if (to != null && value > to) return false
      return true
    })
    dropped.dateRange += before - pubs.length
  }

  // ── 8. sort ───────────────────────────────────────────────────────────
  // Sorting precedes the limit on purpose: slicing an unsorted list would keep
  // whichever records the network happened to return first.
  pubs = [...pubs].sort(comparePublications)
  if (typeof config.limit === 'number' && config.limit > 0) {
    dropped.limit += Math.max(0, pubs.length - config.limit)
    pubs = pubs.slice(0, config.limit)
  }

  // ── 9. split ──────────────────────────────────────────────────────────
  const confirmed = pubs.filter((p) => p.trust === 'confirmed')
  const candidates = pubs.filter((p) => p.trust === 'candidate')
  // 'auto' publishes unreviewed hits immediately; they stay in `candidates`
  // too, so the wizard can show what it accepted on the user's behalf.
  const publications = config.reviewPolicy === 'auto' ? pubs : confirmed

  const model: ListModel = {
    config: boldNames.length > 0 ? { ...config, boldNames } : config,
    members,
    publications,
    candidates,
    warnings,
    dropped,
    generatedAt: new Date().toISOString(),
  }
  const suggested = triageCandidates(confirmed, candidates, boldNames)
  if (suggested.length > 0) model.suggested = suggested

  report(100, 'Done')
  return model
}
