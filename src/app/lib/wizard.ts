/**
 * Wizard state: the editable draft, its projection onto `ListConfig`, the
 * review-queue transitions and `localStorage` persistence.
 *
 * Deliberately free of React so the interesting logic is testable as plain
 * functions. `App.tsx` holds a `WizardDraft` in state and calls into here.
 */

import { DEFAULT_GROUP_BY, normalizeConfig } from '@/core/config'
import { formatIdRef, parseIdRef, formatIdRefValue } from '@/core/ids'
import { INCLUDE_SEED_ID } from '@/core/seeds'
import { CACHE_PREFIX } from '@/core/cache'
import type {
  CitationStyle,
  ListConfig,
  ListModel,
  Publication,
  Seed,
} from '@/core/types'
import {
  commentOutLine,
  parseIdList,
  parseMemberLines,
  parseNameList,
  parsePubmedQueries,
  parseYearMonth,
} from './parse'
import type { ParsedMember } from './parse'

export type WizardMode = 'article' | 'person' | 'lab'

export const MODES: { value: WizardMode; label: string; blurb: string }[] = [
  {
    value: 'article',
    label: 'Reference list',
    blurb:
      'Paste the PMIDs and DOIs cited in an article and get a formatted reference list.',
  },
  {
    value: 'person',
    label: 'My publications',
    blurb:
      'Build an auto-updating list of one person’s work from ORCID, researchmap and PubMed.',
  },
  {
    value: 'lab',
    label: 'Lab or group',
    blurb:
      'Combine several members, pin individual papers, and review anything uncertain before it is published.',
  },
]

export interface WizardDraft {
  mode: WizardMode
  /** free text: PMIDs / DOIs (mode 1 input, mode 3 pins) */
  pins: string
  /** mode 2 */
  orcid: string
  /** mode 2 */
  researchmap: string
  /** modes 2 and 3: one PubMed query per line */
  pubmed: string
  /** mode 3: pasted member list */
  members: string

  style: CitationStyle
  from: string
  to: string
  groupBy: NonNullable<ListConfig['groupBy']>
  /** "Include preprints" — false projects onto `preprints: 'exclude'`. */
  preprints: boolean
  japanese: NonNullable<ListConfig['japanese']>
  reviewPolicy: NonNullable<ListConfig['reviewPolicy']>
  boldNames: string
  limit: string

  /** decisions taken in the review queue — canonical `"pmid:…"` / `"doi:…"` */
  include: string[]
  exclude: string[]

  /** snippet options */
  credit: boolean
  /**
   * "Say where the list came from" — the source disclaimer.
   *
   * Deliberately kept out of `draftToConfig`, even though `disclaimer` is a
   * real `ListConfig` field: it changes nothing about what gets fetched, and
   * putting it into the config would put it into `configHash`, evicting the
   * cached build every time someone ticks a box. `App.tsx` applies it to the
   * built model instead, which is also what makes the checkbox take effect
   * without a rebuild — the same responsiveness `credit` has.
   */
  disclaimer: boolean
  /** optional URL of a hosted pubs.json, for the `data-config` snippet */
  configUrl: string
}

/**
 * The grouping each mode starts on. The user can still override it in the
 * shared options — this only picks where the select lands.
 *
 * `article` is the exception and keeps `none`: that mode produces the numbered
 * reference list for a single article, where the numbers are the point — they
 * are what the prose cites — so the list has to be one unbroken sequence.
 * Headings of any kind would break it into several sequences each starting at
 * 1, and no reference list works that way.
 *
 * The other two modes are publication pages, and take `DEFAULT_GROUP_BY` — the
 * same category-then-year grouping an embed gets when nothing says otherwise,
 * so what the wizard previews is what the page renders.
 */
export const GROUP_BY_DEFAULT: Record<
  WizardMode,
  NonNullable<ListConfig['groupBy']>
> = {
  article: 'none',
  person: DEFAULT_GROUP_BY,
  lab: DEFAULT_GROUP_BY,
}

export function emptyDraft(mode: WizardMode = 'article'): WizardDraft {
  return {
    mode,
    pins: '',
    orcid: '',
    researchmap: '',
    pubmed: '',
    members: '',
    style: 'vancouver',
    from: '',
    to: '',
    groupBy: GROUP_BY_DEFAULT[mode],
    preprints: false,
    japanese: 'separate',
    reviewPolicy: 'strict',
    boldNames: '',
    limit: '',
    include: [],
    exclude: [],
    credit: true,
    disclaimer: true,
    configUrl: '',
  }
}

/** The owner's own ORCID iD, used by the "try it" button. */
export const EXAMPLE_ORCID = '0000-0003-1317-0220'

export function exampleDraft(): WizardDraft {
  return { ...emptyDraft('person'), orcid: EXAMPLE_ORCID, boldNames: 'Yuki Furukawa' }
}

// ───────────────────────────────────────────────────── draft → ListConfig ──

/**
 * One member's identifier as a seed.
 *
 * A member line with no dates yields the **bare string** the seed arrays have
 * always held — not an object with three `undefined` fields. That keeps a
 * pasted member list projecting onto exactly the config it projected onto
 * before windows existed, byte for byte, so nothing about the snippet, the
 * `pubs.json` or the cache key changes for a lab that does not use them.
 */
function memberSeed(id: string, member: ParsedMember): Seed {
  if (member.from == null && member.to == null && member.grace == null) return id
  const seed = { id } as Extract<Seed, { id: string }>
  if (member.from != null) seed.from = member.from
  if (member.to != null) seed.to = member.to
  if (member.grace != null) seed.grace = member.grace
  return seed
}

/**
 * Project a draft onto a `ListConfig`.
 *
 * Mode is purely a projection rule — it never survives into the config, so a
 * list built in one mode can be re-opened in another without translation:
 *
 *   article — no seeds at all; the pasted identifiers become `include`, and
 *             `pipeline.ts` materializes each pinned record from PubMed or
 *             OpenAlex.
 *   person  — one ORCID / researchmap / PubMed seed set for one person.
 *   lab     — the member list fans out into the same seed arrays, plus pins.
 *
 * `include` always carries the typed pins *and* the review-queue confirmations,
 * in that order.
 */
export function draftToConfig(draft: WizardDraft): ListConfig {
  const partial: Partial<ListConfig> = { v: 1, seeds: {} }

  if (draft.mode === 'person') {
    const orcid = draft.orcid.trim()
    const researchmap = draft.researchmap.trim()
    if (orcid !== '') partial.seeds!.orcid = [orcid]
    if (researchmap !== '') partial.seeds!.researchmap = [researchmap]
  } else if (draft.mode === 'lab') {
    const { members } = parseMemberLines(draft.members)
    const orcids = members
      .filter((m) => m.orcid)
      .map((m) => memberSeed(m.orcid as string, m))
    const rms = members
      .filter((m) => m.researchmap)
      .map((m) => memberSeed(m.researchmap as string, m))
    if (orcids.length > 0) partial.seeds!.orcid = orcids
    if (rms.length > 0) partial.seeds!.researchmap = rms
  }

  if (draft.mode !== 'article') {
    const pubmed = parsePubmedQueries(draft.pubmed)
    if (pubmed.length > 0) partial.seeds!.pubmed = pubmed
  }

  const pinned = parseIdList(draft.pins).refs
  const include = [...pinned]
  for (const ref of draft.include) if (!include.includes(ref)) include.push(ref)
  if (include.length > 0) partial.include = include
  if (draft.exclude.length > 0) partial.exclude = [...draft.exclude]

  const bold = parseNameList(draft.boldNames)
  if (bold.length > 0) partial.boldNames = bold

  partial.style = draft.style
  partial.groupBy = draft.groupBy
  partial.preprints = draft.preprints ? 'include' : 'exclude'
  partial.japanese = draft.japanese
  partial.reviewPolicy = draft.reviewPolicy

  const from = parseYearMonth(draft.from)
  if (from) partial.from = from
  const to = parseYearMonth(draft.to)
  if (to) partial.to = to

  const limit = Number.parseInt(draft.limit, 10)
  if (Number.isFinite(limit) && limit > 0) partial.limit = limit

  return normalizeConfig(partial)
}

/** Is there anything to build? Guards the Generate button. */
export function isRunnable(draft: WizardDraft): boolean {
  const config = draftToConfig(draft)
  return (
    (config.include?.length ?? 0) > 0 ||
    (config.seeds.orcid?.length ?? 0) > 0 ||
    (config.seeds.researchmap?.length ?? 0) > 0 ||
    (config.seeds.pubmed?.length ?? 0) > 0
  )
}

/**
 * Does this configuration produce a review queue at all?
 *
 * Only a PubMed *name* query can: every other seed is trusted outright by
 * `pipeline.ts`, and an `[auid]` query is an identifier search.
 */
export function hasNameQuery(config: ListConfig): boolean {
  return (config.seeds.pubmed ?? []).some(
    (seed) => !/\[\s*auid\s*\]/i.test(seed.query),
  )
}

// ──────────────────────────────────────────────────────── review queue ──

/** The canonical include/exclude reference for a candidate, or `null`. */
export function candidateRef(pub: Publication): string | null {
  return formatIdRef(pub)
}

/**
 * Which candidates should start out checked?
 *
 * `suggested` is the pipeline's triage (shared co-author or affiliation with
 * the confirmed set); anything the user has already confirmed stays checked
 * across rebuilds, and anything already excluded stays unchecked even if the
 * triage would have suggested it — an explicit rejection outranks a heuristic.
 */
export function initialChecked(
  candidates: readonly Publication[],
  suggested: readonly string[] | undefined,
  include: readonly string[],
  exclude: readonly string[],
): Set<string> {
  const suggestedKeys = new Set(suggested ?? [])
  const checked = new Set<string>()
  for (const pub of candidates) {
    const ref = candidateRef(pub)
    if (ref != null && exclude.includes(ref)) continue
    if ((ref != null && include.includes(ref)) || suggestedKeys.has(pub.key)) {
      checked.add(pub.key)
    }
  }
  return checked
}

/**
 * Candidates the user has neither confirmed nor rejected.
 *
 * Under the default `strict` policy these are invisible on the published page,
 * which is the whole reason the count is surfaced in the UI.
 */
export function unreviewedCount(
  candidates: readonly Publication[],
  include: readonly string[],
  exclude: readonly string[],
): number {
  let n = 0
  for (const pub of candidates) {
    const ref = candidateRef(pub)
    if (ref == null) continue
    if (!include.includes(ref) && !exclude.includes(ref)) n++
  }
  return n
}

export interface ReviewDecisionsResult {
  include: string[]
  exclude: string[]
  /** candidates with neither a DOI nor a PMID; they cannot be referenced */
  unreferenceable: Publication[]
}

/**
 * Fold the review queue's checkbox state back into include/exclude.
 *
 * Checked → `include` (and removed from `exclude`). Unchecked → `exclude` (and
 * removed from `include`). Every candidate in the queue lands in exactly one
 * of the two lists, which is what makes the decision stick: on the next build
 * a confirmed record is force-confirmed by the pipeline and a rejected one is
 * dropped before anything else runs, so neither is ever asked about again.
 *
 * Records outside `candidates` are left alone — pins the user typed and
 * decisions taken on earlier runs survive untouched.
 */
export function applyReviewDecisions(
  include: readonly string[],
  exclude: readonly string[],
  candidates: readonly Publication[],
  checkedKeys: ReadonlySet<string>,
): ReviewDecisionsResult {
  const nextInclude = [...include]
  const nextExclude = [...exclude]
  const unreferenceable: Publication[] = []

  const add = (list: string[], ref: string) => {
    if (!list.includes(ref)) list.push(ref)
  }
  const drop = (list: string[], ref: string) => {
    const i = list.indexOf(ref)
    if (i >= 0) list.splice(i, 1)
  }

  for (const pub of candidates) {
    const ref = candidateRef(pub)
    if (ref == null) {
      unreferenceable.push(pub)
      continue
    }
    if (checkedKeys.has(pub.key)) {
      drop(nextExclude, ref)
      add(nextInclude, ref)
    } else {
      drop(nextInclude, ref)
      add(nextExclude, ref)
    }
  }

  return { include: nextInclude, exclude: nextExclude, unreferenceable }
}

/** Remove one reference from both decision lists ("undo" in the pinned list). */
export function forgetRef(draft: WizardDraft, ref: string): WizardDraft {
  return {
    ...draft,
    include: draft.include.filter((r) => r !== ref),
    exclude: draft.exclude.filter((r) => r !== ref),
  }
}

/** Turn a typed identifier into its canonical form, or `null` if unusable. */
export function canonicalRef(input: string): string | null {
  const ref = parseIdRef(input)
  return ref ? formatIdRefValue(ref) : null
}

// ──────────────────────────────────────────────────── freezing a member ──

/**
 * What freezing one member would do, computed from the **built** list.
 *
 * Freezing is the primary answer to a member leaving the group: everything of
 * theirs that is on the page right now becomes an explicit pin, and their seed
 * comes out. Past work stays — it was done here — and nothing they publish
 * afterwards can ever enter, because there is no seed left to find it and a pin
 * is an identifier rather than a search.
 *
 * It is deliberately built out of `include`, the mechanism that already exists:
 * no new matching rule means no new way to be wrong, and a pin is exempt from
 * the seed time windows, so a window added later cannot undo a freeze.
 *
 * The one thing it cannot do is pin a record with neither a DOI nor a PMID —
 * `formatIdRef` has nothing to write. Those are counted and named rather than
 * dropped in silence, and split in two, because the consequences differ:
 * `losing` disappears from the list, while the rest are held in place by a
 * co-author's seed and stay.
 */
export interface FreezePlan {
  /**
   * The seeds being removed. Usually one, but a member row can carry both an
   * ORCID iD and a researchmap permalink, and freezing the person has to take
   * out both or the one left behind keeps collecting their new work.
   */
  seedIds: string[]
  /** what to call the member in the UI */
  label: string
  /** canonical `"pmid:…"` / `"doi:…"` refs to add to `include` */
  refs: string[]
  /** records that will be pinned */
  pinned: Publication[]
  /** records this seed contributed that have neither a DOI nor a PMID */
  unpinnable: Publication[]
  /**
   * The subset of `unpinnable` that will actually vanish: no identifier to pin
   * them by *and* no other seed still contributing them.
   */
  losing: Publication[]
}

export function planFreeze(
  model: ListModel,
  seedIds: readonly string[],
  label?: string,
): FreezePlan {
  const frozen = new Set(seedIds)
  const refs: string[] = []
  const pinned: Publication[] = []
  const unpinnable: Publication[] = []
  const losing: Publication[] = []

  for (const pub of model.publications) {
    if (!pub.seedIds.some((id) => frozen.has(id))) continue
    const ref = formatIdRef(pub)
    if (ref == null) {
      unpinnable.push(pub)
      // A record already carrying the pin marker survives on that alone, and
      // one a remaining member also contributed survives on their seed.
      const others = pub.seedIds.filter(
        (id) => !frozen.has(id) && id !== INCLUDE_SEED_ID,
      )
      if (others.length === 0 && !pub.seedIds.includes(INCLUDE_SEED_ID)) {
        losing.push(pub)
      }
      continue
    }
    pinned.push(pub)
    if (!refs.includes(ref)) refs.push(ref)
  }

  return {
    seedIds: [...seedIds],
    label: label ?? seedIds.join(', '),
    refs,
    pinned,
    unpinnable,
    losing,
  }
}

/**
 * Apply a plan: pin the records, then take the member's line out of the seed
 * list by commenting it out (see `commentOutLine` — the line stays readable and
 * the `#` can be deleted to undo).
 */
export function applyFreeze(
  draft: WizardDraft,
  plan: FreezePlan,
  lineIndex: number,
  today: Date = new Date(),
): WizardDraft {
  const include = [...draft.include]
  for (const ref of plan.refs) if (!include.includes(ref)) include.push(ref)
  return {
    ...draft,
    include,
    members: commentOutLine(
      draft.members,
      lineIndex,
      `frozen ${today.toISOString().slice(0, 10)} — ${plan.refs.length} paper(s) pinned`,
    ),
  }
}

// ─────────────────────────────────────────────────────────── persistence ──

/**
 * Where the in-progress draft is kept.
 *
 * One slot, not a cache: it is the user's unfinished work, and losing a
 * half-built lab list to a reload is the failure this prevents. Built lists
 * are a different problem and already have `core/cache.ts`, keyed by
 * `configHash` — this module must not grow a second copy of that.
 */
export const DRAFT_STORAGE_KEY = `${CACHE_PREFIX}wizard-draft`

interface StoredDraft {
  v: 1
  draft: WizardDraft
}

export function saveDraft(draft: WizardDraft): void {
  try {
    const payload: StoredDraft = { v: 1, draft }
    globalThis.localStorage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Private windows, disabled storage, quota: never worth an error dialog.
  }
}

export function loadDraft(): WizardDraft | null {
  let raw: string | null = null
  try {
    raw = globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY) ?? null
  } catch {
    return null
  }
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (parsed?.v !== 1 || typeof parsed.draft !== 'object' || parsed.draft == null) {
      return null
    }
    // Merge over a fresh draft so a field added in a later version is present.
    const draft = { ...emptyDraft(), ...parsed.draft }
    return {
      ...draft,
      include: Array.isArray(draft.include) ? draft.include : [],
      exclude: Array.isArray(draft.exclude) ? draft.exclude : [],
    }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    globalThis.localStorage?.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    /* nothing useful to do */
  }
}
