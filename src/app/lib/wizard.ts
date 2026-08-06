/**
 * Wizard state: the editable draft, its projection onto `ListConfig`, the
 * review-queue transitions and `localStorage` persistence.
 *
 * Deliberately free of React so the interesting logic is testable as plain
 * functions. `App.tsx` holds a `WizardDraft` in state and calls into here.
 */

import {
  DEFAULT_GROUP_BY,
  DEFAULT_HEADING_LEVEL,
  DEFAULT_JAPANESE,
  DEFAULT_REVIEW_POLICY,
  DEFAULT_STYLE,
  headingLevelFor,
  normalizeConfig,
} from '@/core/config'
import { formatIdRef, parseIdRef, formatIdRefValue } from '@/core/ids'
import { INCLUDE_SEED_ID, seedId, seedWindowOf } from '@/core/seeds'
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
  formatMemberWindow,
  parseIdList,
  parseMemberLines,
  parseNameList,
  parsePubmedQueries,
  parseYearMonth,
} from './parse'
import type { ParsedMember } from './parse'

export type WizardMode = 'article' | 'person' | 'lab'

/** What one entry in the removed list carries. See `WizardDraft.removed`. */
export interface RemovedRecord {
  /** the record's title as it read when it was removed */
  label?: string
  /**
   * The removal took this reference out of `include`, so undoing it has to put
   * the pin back. Without this an undo after a freeze would drop the exclude
   * and the pin together, and the record — whose seed the freeze removed —
   * would not return: an "undo" that undid nothing visible.
   */
  pinned?: boolean
}

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
  /**
   * The queries in `pubmed` whose hits the user has asserted are all theirs.
   *
   * Held as the query strings themselves rather than as line numbers, so
   * editing an unrelated line cannot move the assertion onto a different
   * search. `parsePubmedQueries` de-duplicates, so a query string identifies
   * one seed. A query that is edited loses its tick, which is the right way
   * round: the assertion was about the search as it was written.
   *
   * Projects onto `PubmedSeed.trust`. Default empty — nothing is trusted
   * unless it is ticked.
   */
  pubmedTrusted: string[]
  /** mode 3: pasted member list */
  members: string

  style: CitationStyle
  from: string
  to: string
  groupBy: NonNullable<ListConfig['groupBy']>
  /**
   * What level the group headings render at, or `'auto'` to match the page the
   * list is pasted into.
   *
   * Stored exactly as chosen, `'auto'` included. It is **not** collapsed to a
   * number when the snapshot box is ticked: that collapse is a property of the
   * snippet being built, `headingLevelFor` applies it there, and doing it here
   * as well would mean un-ticking the box left the user on a level they never
   * picked. The select displays the resolved value so the two never look
   * different — see `SharedOptions`.
   */
  headingLevel: NonNullable<ListConfig['headingLevel']>
  /** "Include preprints" — false projects onto `preprints: 'exclude'`. */
  preprints: boolean
  japanese: NonNullable<ListConfig['japanese']>
  reviewPolicy: NonNullable<ListConfig['reviewPolicy']>
  boldNames: string
  limit: string

  /** decisions taken in the review queue — canonical `"pmid:…"` / `"doi:…"` */
  include: string[]
  exclude: string[]
  /**
   * What each ref in `exclude` needs remembered about it, keyed by ref.
   *
   * Two things, both of which exist because the effect of an exclude is that
   * the record is no longer in the built model to be looked up in: the name to
   * show in the "N removed" list, and whether the removal took a pin out of
   * `include` — which is the difference between an undo that puts the record
   * back and one that quietly leaves it gone.
   *
   * Never reaches `ListConfig` — `draftToConfig` does not read it — so it
   * changes no `configHash` and no snippet. It is kept in step
   * with `exclude` by `syncRemoved`, which also prunes it, so undoing a removal
   * drops its entry with it and the map cannot grow without bound.
   */
  removed: Record<string, RemovedRecord>

  /** snippet options */
  credit: boolean
  /**
   * "Include the list itself in the snippet" — the pre-rendered snapshot.
   *
   * Off by default, and recommended on: see `EmbedSnippetOptions.snapshot`.
   * Like `credit`, it describes the snippet rather than the list, so it never
   * reaches `draftToConfig` and never touches `configHash`.
   */
  snapshot: boolean
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

/**
 * Every value the heading-level select offers, in the order it offers them.
 *
 * The same list the type allows — `'auto'` plus 2–5 — written out once so the
 * control, the persistence guard and the tests all agree on what a usable
 * value is.
 */
export const HEADING_LEVEL_CHOICES: readonly NonNullable<
  ListConfig['headingLevel']
>[] = ['auto', 2, 3, 4, 5]

export function emptyDraft(mode: WizardMode = 'article'): WizardDraft {
  return {
    mode,
    pins: '',
    orcid: '',
    researchmap: '',
    pubmed: '',
    pubmedTrusted: [],
    members: '',
    style: 'vancouver',
    from: '',
    to: '',
    groupBy: GROUP_BY_DEFAULT[mode],
    headingLevel: DEFAULT_HEADING_LEVEL,
    preprints: false,
    japanese: 'separate',
    reviewPolicy: 'strict',
    boldNames: '',
    limit: '',
    include: [],
    exclude: [],
    removed: {},
    credit: true,
    snapshot: false,
    disclaimer: true,
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
 * before windows existed, byte for byte, so nothing about the snippet or the
 * cache key changes for a lab that does not use them.
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
    // The tick box projects onto `PubmedSeed.trust`. Only `'confirmed'` is
    // ever written: a seed with no `trust` already means "review its hits",
    // and saying so twice would only make two spellings of one default.
    const trusted = new Set(draft.pubmedTrusted)
    const pubmed = parsePubmedQueries(draft.pubmed).map((seed) =>
      trusted.has(seed.query)
        ? { ...seed, trust: 'confirmed' as const }
        : seed,
    )
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
  partial.headingLevel = draft.headingLevel
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
 * `pipeline.ts`, an `[auid]` query is an identifier search, and a seed the
 * user has ticked as trusted is confirmed by assertion. A query that cannot
 * produce a candidate must not put an empty review panel on screen.
 */
export function hasNameQuery(config: ListConfig): boolean {
  return (config.seeds.pubmed ?? []).some(
    (seed) =>
      seed.trust !== 'confirmed' && !/\[\s*auid\s*\]/i.test(seed.query),
  )
}

// ───────────────────────────────────────────────────── ListConfig → draft ──

/**
 * Is there anything in this draft worth asking before overwriting?
 *
 * Only the fields a person types. Formatting choices are not counted: nobody
 * means "I have unsaved work" by having picked APA, and asking about it would
 * make the confirmation appear on a form that is visibly empty.
 */
export function draftHasContent(draft: WizardDraft): boolean {
  return (
    draft.pins.trim() !== '' ||
    draft.orcid.trim() !== '' ||
    draft.researchmap.trim() !== '' ||
    draft.pubmed.trim() !== '' ||
    draft.members.trim() !== '' ||
    draft.include.length > 0 ||
    draft.exclude.length > 0
  )
}

/**
 * Which mode's form can hold this configuration?
 *
 * Mode never travels in a `ListConfig` — it is a projection rule, not a
 * setting (see `draftToConfig`) — so coming back the other way it has to be
 * inferred. The rule is deliberately the simplest one that cannot lose data:
 *
 *   no seeds at all                     → `article`, the pins-only form
 *   ≤1 ORCID and ≤1 researchmap seed,
 *   neither carrying a time window      → `person`
 *   anything else                       → `lab`
 *
 * The "no time window" clause is what stops a window being silently dropped:
 * person mode's ORCID field is a single line with nowhere to write
 * `2019-04..2023-03`, whereas the members box in lab mode has a spelling for
 * it. A one-person list with a window therefore opens in lab mode — the same
 * seeds, on a form that can show all of them.
 */
export function pickMode(config: ListConfig): WizardMode {
  const orcid = config.seeds.orcid ?? []
  const researchmap = config.seeds.researchmap ?? []
  const pubmed = config.seeds.pubmed ?? []

  if (orcid.length === 0 && researchmap.length === 0 && pubmed.length === 0) {
    return 'article'
  }
  const windowed = [...orcid, ...researchmap].some(
    (seed) => seedWindowOf(seed) != null,
  )
  if (orcid.length <= 1 && researchmap.length <= 1 && !windowed) return 'person'
  return 'lab'
}

/** One seed as a line of the members box, window and all. */
function memberLine(seed: Seed): string {
  const id = seedId(seed)
  const window = seedWindowOf(seed)
  const token = formatMemberWindow(window ?? null)
  return token === '' ? id : `${id}\t${token}`
}

export interface ConfigToDraftOptions {
  /**
   * Whether the credit line was switched on. Not part of a `ListConfig` — it
   * is read from the pasted snapshot or from `?credit=` — so the caller
   * supplies it, and `true` (the wizard's own default) stands in when nothing
   * knows.
   */
  credit?: boolean
  /**
   * Same, for the source disclaimer. This one *is* a config field, so the
   * fallback reads it; the option exists because a pasted snapshot is better
   * evidence than the attribute — the site owner may have deleted the line.
   */
  disclaimer?: boolean
  /**
   * Whether the pasted snippet carried a pre-rendered snapshot. Not a config
   * field either — it is the presence of the rendered list in the markup — so
   * the caller reads it off the paste and the wizard's own default (off)
   * stands in when there was nothing to read.
   */
  snapshot?: boolean
}

/**
 * Inverse of `draftToConfig`: fill the wizard's form from a `ListConfig`.
 *
 * Everything the config records lands in the box that projects back onto it,
 * so `draftToConfig(configToDraft(c))` is `c` again — with the one exception
 * of `disclaimer`, which `draftToConfig` deliberately does not write (see the
 * comment on `WizardDraft.disclaimer`) and which is carried here as the
 * checkbox instead.
 *
 * `include` all goes into the free-text **pinned papers** box and
 * `draft.include` is left empty. The config cannot tell a typed pin from a
 * review-queue confirmation — both are just references in one array — and
 * `draftToConfig` re-emits the same array from either box, so the choice
 * changes nothing downstream. The pinned box is the one the user can read and
 * edit, which makes it the honest place to put a reference whose provenance is
 * unknown.
 */
export function configToDraft(
  config: ListConfig,
  opts: ConfigToDraftOptions = {},
): WizardDraft {
  const mode = pickMode(config)
  const draft = emptyDraft(mode)

  const orcidSeeds = config.seeds.orcid ?? []
  const researchmapSeeds = config.seeds.researchmap ?? []
  const pubmedSeeds = config.seeds.pubmed ?? []

  if (mode === 'person') {
    if (orcidSeeds[0]) draft.orcid = seedId(orcidSeeds[0])
    if (researchmapSeeds[0]) draft.researchmap = seedId(researchmapSeeds[0])
  } else if (mode === 'lab') {
    // ORCID seeds first, then researchmap ones — the order `draftToConfig`'s
    // two filters read them back in, so the seed arrays come out identical.
    draft.members = [...orcidSeeds, ...researchmapSeeds]
      .map(memberLine)
      .join('\n')
  }

  if (mode !== 'article') {
    draft.pubmed = pubmedSeeds.map((seed) => seed.query).join('\n')
    draft.pubmedTrusted = pubmedSeeds
      .filter((seed) => seed.trust === 'confirmed')
      .map((seed) => seed.query)
  }

  draft.pins = (config.include ?? []).join('\n')
  draft.exclude = [...(config.exclude ?? [])]

  draft.style = config.style ?? DEFAULT_STYLE
  draft.groupBy = config.groupBy ?? DEFAULT_GROUP_BY
  // `headingLevelFor` with no snapshot flag: reading a config back is not
  // building a snippet, so an absent value is the plain `'auto'` default and an
  // explicit level — which is what a snapshot-bearing snippet carries — comes
  // back as itself.
  draft.headingLevel = headingLevelFor(config)
  draft.preprints = config.preprints === 'include'
  draft.japanese = config.japanese ?? DEFAULT_JAPANESE
  draft.reviewPolicy = config.reviewPolicy ?? DEFAULT_REVIEW_POLICY
  draft.boldNames = (config.boldNames ?? []).join(', ')
  draft.from = config.from ?? ''
  draft.to = config.to ?? ''
  draft.limit = config.limit != null ? String(config.limit) : ''

  draft.credit = opts.credit ?? true
  draft.snapshot = opts.snapshot ?? false
  draft.disclaimer = opts.disclaimer ?? config.disclaimer !== 'hide'

  // Rebuilds `removed` from `exclude`, so the "N removed" list is populated
  // (by identifier — the titles are not in the config) rather than empty while
  // records are being kept off the page.
  return syncRemoved(draft)
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
 * dropped, so neither is ever asked about again.
 *
 * Dropping from `include` and adding to `exclude` are belt and braces, and the
 * braces are what matter: `draftToConfig` also folds the free-text **Pinned
 * papers** box into `include`, and `planFreeze` writes a departing member's
 * whole list there, so a rejected record may well still be pinned by a route
 * this function cannot reach. Since an exclude outranks a pin (`pipeline.ts`
 * stage 3), the added `exclude` entry is what actually takes it off the page.
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

// ────────────────────────────────────────────── removing a publication ──

/**
 * What to call a record in the removed list. The title, or the dedupe key when
 * a source gave us a record with no title at all.
 */
function removalLabel(pub: Publication): string {
  const title = (pub.title ?? '').trim()
  return title === '' ? pub.key : title
}

/**
 * Bring `removed` back in step with `exclude`.
 *
 * Two jobs, both of them pruning-shaped:
 *   - learn a name for any excluded ref that appears in `pubs` (the records
 *     that were on screen when the decision was taken);
 *   - drop the entry for anything no longer excluded, so undoing a removal
 *     leaves nothing behind and the map cannot outgrow the list it describes.
 *
 * Call it after every edit to `exclude`. It is idempotent.
 */
export function syncRemoved(
  draft: WizardDraft,
  pubs: readonly Publication[] = [],
): WizardDraft {
  const found = new Map<string, string>()
  for (const pub of pubs) {
    const ref = formatIdRef(pub)
    if (ref != null && !found.has(ref)) found.set(ref, removalLabel(pub))
  }

  const next: Record<string, RemovedRecord> = {}
  for (const ref of draft.exclude) {
    const previous = draft.removed[ref]
    const label = previous?.label ?? found.get(ref)
    const entry: RemovedRecord = {}
    if (label != null) entry.label = label
    if (previous?.pinned) entry.pinned = true
    next[ref] = entry
  }
  return { ...draft, removed: next }
}

/**
 * Take one publication off the built list.
 *
 * `exclude` is what does the work — it outranks `include` at pipeline stage 3,
 * which is the only reason this can remove a record that a freeze pinned or
 * that the user typed into the **Pinned papers** box. Dropping the ref from
 * `include` as well keeps the saved configuration honest (no list that pins and
 * excludes the same paper), but it is not what makes the removal stick, and it
 * deliberately does not touch the free-text pins box: that is the user's own
 * typing, and rewriting it under them to enact a removal the `exclude` entry
 * already enacts would be a surprise for no gain.
 *
 * A record with neither a DOI nor a PMID has no reference to exclude by, so
 * there is nothing to write; the draft comes back untouched and the caller's
 * control is disabled. See `PreviewList.tsx`.
 */
export function removePublication(
  draft: WizardDraft,
  pub: Publication,
): WizardDraft {
  const ref = formatIdRef(pub)
  if (ref == null) return draft

  const pinned = draft.include.includes(ref)
  const exclude = draft.exclude.includes(ref)
    ? [...draft.exclude]
    : [...draft.exclude, ref]

  const next = syncRemoved(
    {
      ...draft,
      include: draft.include.filter((r) => r !== ref),
      exclude,
    },
    [pub],
  )
  // Remembered *after* the sync, which rebuilds the map from `exclude`.
  return pinned
    ? { ...next, removed: { ...next.removed, [ref]: { ...next.removed[ref], pinned: true } } }
    : next
}

/**
 * Undo one removal.
 *
 * `forgetRef` is the existing transition and does the substance of it: the ref
 * leaves both decision lists, so the record returns by whatever route was
 * carrying it. The one thing it cannot know is that this removal *took* the ref
 * out of `include` — after a freeze that pin is the only thing holding the
 * record on the list, and forgetting it too would leave the paper gone with
 * nothing on screen to say so. So a pinned removal is re-pinned here.
 *
 * It goes back on the end of `include` rather than at its old index. The list
 * is a set as far as the pipeline is concerned; only the cache key notices.
 */
export function restoreRef(draft: WizardDraft, ref: string): WizardDraft {
  const wasPinned = draft.removed[ref]?.pinned === true
  const forgotten = forgetRef(draft, ref)
  const include =
    wasPinned && !forgotten.include.includes(ref)
      ? [...forgotten.include, ref]
      : forgotten.include
  return syncRemoved({ ...forgotten, include })
}

/** One row of the "N removed" list. */
export interface RemovedEntry {
  /** canonical `"pmid:…"` / `"doi:…"` */
  ref: string
  /** the remembered title, or the ref itself when nothing remembered one */
  label: string
}

/**
 * Everything currently being kept off the list, in the order it was excluded.
 *
 * Reads `exclude` rather than a separate "removed" list on purpose: `exclude`
 * *is* the set of records that will not appear, however they got there — the
 * Remove control, a rejection in the review queue, or a hand-edited config. A
 * removal the user cannot see is a paper quietly missing from a CV, so all of
 * them are shown and all of them are undoable.
 */
export function removedEntries(draft: WizardDraft): RemovedEntry[] {
  return draft.exclude.map((ref) => ({
    ref,
    label: draft.removed[ref]?.label ?? ref,
  }))
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
 * Freezing pins whatever is on the list at that moment, so some of what it pins
 * may not belong to the group at all. That is recoverable and does not have to
 * be got right first: an exclude outranks a pin, so rejecting one of these
 * records in the review queue, or adding its identifier to `exclude`, takes it
 * off the list afterwards without anyone editing the `include` list by hand.
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
 *
 * A reference the user has already excluded is not written back as a pin. It
 * would be inert — an exclude outranks a pin — and a saved configuration whose
 * two lists contradict each other is a puzzle for whoever inherits it. In
 * practice the plan never contains one, because an excluded record is not in
 * `model.publications` for `planFreeze` to see; keeping the check makes that a
 * guarantee rather than a coincidence of ordering.
 */
export function applyFreeze(
  draft: WizardDraft,
  plan: FreezePlan,
  lineIndex: number,
  today: Date = new Date(),
): WizardDraft {
  const include = [...draft.include]
  let pinned = 0
  for (const ref of plan.refs) {
    if (draft.exclude.includes(ref)) continue
    pinned++
    if (!include.includes(ref)) include.push(ref)
  }
  return {
    ...draft,
    include,
    members: commentOutLine(
      draft.members,
      lineIndex,
      `frozen ${today.toISOString().slice(0, 10)} — ${pinned} paper(s) pinned`,
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
      // A draft stored before this field existed has no ticks, which is the
      // same as every query being reviewed — the behaviour it was saved with.
      pubmedTrusted: Array.isArray(draft.pubmedTrusted) ? draft.pubmedTrusted : [],
      // Same shape of guard: a draft stored before this field existed, or one
      // with a non-boolean in it, gets the lightweight snippet the wizard
      // offers by default rather than an unchecked box that behaves as ticked.
      snapshot: typeof draft.snapshot === 'boolean' ? draft.snapshot : false,
      // A draft stored before this field existed, or one carrying a value the
      // select cannot show, falls back to the default rather than putting the
      // form into a state with no option selected.
      headingLevel: HEADING_LEVEL_CHOICES.includes(draft.headingLevel)
        ? draft.headingLevel
        : DEFAULT_HEADING_LEVEL,
      removed:
        draft.removed != null &&
        typeof draft.removed === 'object' &&
        !Array.isArray(draft.removed)
          ? draft.removed
          : {},
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
