/**
 * Seed identity, per-seed time windows, and the year-month arithmetic the
 * windows share with the pipeline's `from` / `to` filter.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A SEED CAN CARRY A TIME WINDOW
 *
 * A university group replaces its students every year. A seed left in place
 * after someone leaves keeps pulling in the papers they publish at their next
 * institution, onto their old group's page — the page then makes a claim about
 * the group that nobody wrote and nobody can see is wrong.
 *
 * Cutting the seed off on the leaving date is worse. Work done in the group is
 * routinely published a year or two after the person has gone, and that work is
 * the group's output. So a window is `from` … `to` **plus a grace period**, and
 * `DEFAULT_SEED_GRACE_MONTHS` is what "a year or two" is spelled as here.
 *
 * The primary answer to member turnover is not this module at all: it is
 * freezing the member (`planFreeze` in `src/app/lib/wizard.ts`), which converts
 * their current publications into explicit pins and removes the seed, so
 * nothing new from that person can ever enter and no date arithmetic is
 * involved. Windows are the safety net for the labs that forget.
 *
 * TWO RULES THIS MODULE EXISTS TO GET RIGHT
 *
 *   1. **Filtering is per seed, not per publication.** A paper co-authored by a
 *      student who left and a member who is still here belongs on the page. So
 *      an out-of-window seed id is dropped from `Publication.seedIds`, and the
 *      publication is only removed once it has lost *every* seed.
 *
 *   2. **A pin beats a window — and an exclude beats a pin.** A record whose
 *      `seedIds` carry `INCLUDE_SEED_ID` was named explicitly by the site owner
 *      and is never removed by a window. That is also what makes freezing safe:
 *      the pins it writes cannot later be swept away by a window somebody adds.
 *      The one thing that does outrank a pin is `config.exclude`, because that
 *      is how a wrong pin gets undone. `pipeline.ts` stage 3 has already dropped
 *      such records by the time this module runs, and the exemption below
 *      declines to cover them anyway, so the exemption cannot resurrect a record
 *      the owner has excluded no matter who calls `applySeedWindows`.
 *
 * BACKWARD COMPATIBILITY
 *
 * A seed may be a bare string, and a bare string means exactly what it always
 * meant: no window, no filtering, no behaviour change. Every `pubs.json`,
 * `lists/*.json` and published snippet written before windows existed keeps
 * working untouched, and `seedId('0000-…')` is the only thing the rest of the
 * codebase needs to know about the distinction.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { IdRef } from './ids'
import { matchesIdRef, parseIdRef } from './ids'
import type { ListConfig, Publication, Seed, SeedWindow } from './types'

/**
 * Months a paper may appear after a member's `to` date and still count as the
 * group's output.
 *
 * Two years. It is a pragmatic estimate of the lag between finishing work and
 * seeing it published — submission, review, revision, production — and not a
 * rule derived from anything. Set `grace` on the seed to say something else;
 * `grace: 0` means the `to` date is hard.
 */
export const DEFAULT_SEED_GRACE_MONTHS = 24

/**
 * The pseudo-seed `pipeline.ts` stage 3 tags every pinned record with.
 *
 * Not a real seed id — no `config.seeds` entry can produce it — so a window can
 * never be attached to it, which is precisely why it works as the exemption
 * marker.
 */
export const INCLUDE_SEED_ID = 'include'

// ───────────────────────────────────────────────────────── seed identity ──

/** The identifier half of a seed, whichever form it was written in. */
export function seedId(seed: Seed): string {
  return typeof seed === 'string' ? seed : seed.id
}

/**
 * The window half, or `undefined` when the seed carries none.
 *
 * An object seed with no `from`, `to` or `grace` is windowless — it says
 * nothing a bare string does not.
 */
export function seedWindowOf(seed: Seed): SeedWindow | undefined {
  if (typeof seed === 'string') return undefined
  if (seed.from == null && seed.to == null && seed.grace == null) return undefined
  return seed
}

/** Every seed's id, in order. What the fetch stages iterate over. */
export function seedIdList(seeds: readonly Seed[] | undefined): string[] {
  return (seeds ?? []).map(seedId)
}

/**
 * Apply an id normalizer (`normalizeOrcid`, `normalizeResearchmapId`) without
 * losing the window, and drop entries whose id normalizes to nothing.
 */
export function normalizeSeedList(
  seeds: readonly Seed[] | undefined,
  normalizeId: (id: string) => string,
): Seed[] {
  const out: Seed[] = []
  for (const seed of seeds ?? []) {
    const id = normalizeId(seedId(seed)).trim()
    if (id === '') continue
    const window = seedWindowOf(seed)
    if (!window) {
      out.push(id)
      continue
    }
    const next: SeedWindow = { id }
    if (window.from != null) next.from = window.from
    if (window.to != null) next.to = window.to
    if (window.grace != null) next.grace = window.grace
    out.push(next)
  }
  return out
}

// ───────────────────────────────────────────── the `data-*` / URL encoding ──

/**
 * How a window travels in a comma-separated attribute or query parameter.
 *
 * `id@from:to:grace`, every field optional and positional:
 *
 *   `0000-0002-1825-0097`                       — no window (unchanged)
 *   `0000-0002-1825-0097@2019-04:2023-03`       — joined and left, default grace
 *   `0000-0002-1825-0097@2019-04`               — joined, still here
 *   `0000-0002-1825-0097@:2023-03`              — left; joined before the record starts
 *   `0000-0002-1825-0097@2019-04:2023-03:0`     — no grace at all
 *
 * No commas anywhere, so the existing comma-joined attributes carry it as is.
 * `@` cannot occur in an ORCID iD or a researchmap permalink.
 */
const SEED_WINDOW_SEPARATOR = '@'

/**
 * The suffix pattern, anchored and strict.
 *
 * A tail that does not match *in full* is not a window, and the whole string
 * stays the id — so a value that happens to contain an `@` is never silently
 * reinterpreted as a time-bounded seed.
 */
const SEED_WINDOW_PATTERN =
  /^(\d{4}(?:-\d{2})?)?(?::(\d{4}(?:-\d{2})?)?(?::(\d{1,3}))?)?$/

/** `"YYYY-MM"` / `"YYYY"`, the same shape `ListConfig.from` accepts. */
const YEAR_MONTH_PATTERN = /^\d{4}(-\d{2})?$/

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value.trim())
}

/** Seed → its attribute/query-string form. Inverse of `decodeSeed`. */
export function encodeSeed(seed: Seed): string {
  const id = seedId(seed)
  const window = seedWindowOf(seed)
  if (!window) return id

  const from = window.from ?? ''
  const to = window.to ?? ''
  const grace = window.grace == null ? '' : String(window.grace)

  let tail = from
  if (to !== '' || grace !== '') tail += `:${to}`
  if (grace !== '') tail += `:${grace}`
  return `${id}${SEED_WINDOW_SEPARATOR}${tail}`
}

/**
 * Attribute/query-string value → seed.
 *
 * Anything that is not unambiguously a window comes back as a bare string, so
 * this is safe to run over every value of every existing `data-orcid`.
 */
export function decodeSeed(value: string): Seed {
  const raw = value.trim()
  const at = raw.lastIndexOf(SEED_WINDOW_SEPARATOR)
  if (at <= 0) return raw

  const match = SEED_WINDOW_PATTERN.exec(raw.slice(at + 1))
  // An empty tail (`id@`) matches the pattern with nothing captured; that is a
  // stray separator, not a window.
  if (!match || (!match[1] && !match[2] && !match[3])) return raw

  const seed: SeedWindow = { id: raw.slice(0, at) }
  if (match[1]) seed.from = match[1]
  if (match[2]) seed.to = match[2]
  if (match[3]) {
    const grace = Number.parseInt(match[3], 10)
    if (Number.isFinite(grace) && grace >= 0) seed.grace = grace
  }
  return seed
}

// ────────────────────────────────────────────────── year-month arithmetic ──

/**
 * `"YYYY-MM"` / `"YYYY"` → the `year*100+month` integer the R original used
 * (`publication-list-generator/app.R:236-243`).
 *
 * `fallbackMonth` is what a bare year means: January for a lower bound,
 * December for an upper one.
 */
export function yearMonthBound(
  value: string,
  fallbackMonth: number,
): number | null {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = match[2] ? Number.parseInt(match[2], 10) : fallbackMonth
  if (!Number.isFinite(year)) return null
  return year * 100 + (month >= 1 && month <= 12 ? month : fallbackMonth)
}

/** Missing month counts as January, exactly as in `app.R:237`. */
export function publicationYearMonth(pub: Publication): number {
  const year = typeof pub.year === 'number' && pub.year > 0 ? pub.year : 0
  const month =
    pub.month != null && pub.month >= 1 && pub.month <= 12 ? pub.month : 1
  return year * 100 + month
}

/** Shift a `year*100+month` bound by whole months, carrying across years. */
export function addMonths(bound: number, months: number): number {
  const year = Math.floor(bound / 100)
  const month = bound % 100
  const total = year * 12 + (month - 1) + months
  return Math.floor(total / 12) * 100 + (total % 12) + 1
}

function formatBound(bound: number): string {
  const year = Math.floor(bound / 100)
  const month = bound % 100
  return `${year}-${String(month).padStart(2, '0')}`
}

// ──────────────────────────────────────────────────────── window resolution ──

/** A seed's window, reduced to the two numbers the comparison needs. */
export interface ResolvedSeedWindow {
  id: string
  /** inclusive lower bound as `year*100+month`, or `null` for an open start */
  from: number | null
  /** inclusive upper bound, grace already added, or `null` for "still active" */
  to: number | null
  /** one clause naming the window, for the warning text */
  description: string
}

export interface ResolvedSeedWindows {
  windows: Map<string, ResolvedSeedWindow>
  warnings: string[]
}

function resolveOne(seed: Seed): ResolvedSeedWindow | string | null {
  const window = seedWindowOf(seed)
  if (!window) return null
  const id = seedId(seed)

  let from: number | null = null
  if (window.from != null && window.from !== '') {
    from = yearMonthBound(window.from, 1)
    if (from == null) {
      return `Seed ${id} has an unreadable start date "${window.from}"; expected YYYY or YYYY-MM. The date was ignored, so nothing was filtered on it.`
    }
  }

  let to: number | null = null
  const grace =
    window.grace != null && Number.isFinite(window.grace) && window.grace >= 0
      ? Math.floor(window.grace)
      : DEFAULT_SEED_GRACE_MONTHS
  if (window.to != null && window.to !== '') {
    const end = yearMonthBound(window.to, 12)
    if (end == null) {
      return `Seed ${id} has an unreadable end date "${window.to}"; expected YYYY or YYYY-MM. The date was ignored, so nothing was filtered on it.`
    }
    to = addMonths(end, grace)
  }

  if (from == null && to == null) return null

  const parts: string[] = []
  if (from != null) parts.push(`from ${formatBound(from)}`)
  if (to != null) {
    parts.push(
      grace > 0
        ? `to ${window.to} plus ${grace} month${grace === 1 ? '' : 's'} for publication lag (${formatBound(to)})`
        : `to ${window.to} with no grace period`,
    )
  } else {
    parts.push('with no end date')
  }

  return { id, from, to, description: `${id} (${parts.join(', ')})` }
}

/**
 * Every window in a config, keyed by the seed id the sources write into
 * `Publication.seedIds`.
 *
 * Those ids have to line up exactly: ORCID records carry the normalized iD,
 * researchmap records the permalink, and PubMed records `label ?? query` — the
 * same values this walk reads out of `config.seeds`, because both sides go
 * through `normalizeConfig` first.
 *
 * A malformed date is reported rather than guessed at. A window that silently
 * failed to parse would leave the departed member's seed wide open while the
 * config says otherwise, which is the one outcome nobody would go looking for.
 */
export function resolveSeedWindows(config: ListConfig): ResolvedSeedWindows {
  const windows = new Map<string, ResolvedSeedWindow>()
  const warnings: string[] = []

  const add = (seed: Seed) => {
    const resolved = resolveOne(seed)
    if (resolved == null) return
    if (typeof resolved === 'string') {
      warnings.push(resolved)
      return
    }
    windows.set(resolved.id, resolved)
  }

  for (const seed of config.seeds.orcid ?? []) add(seed)
  for (const seed of config.seeds.researchmap ?? []) add(seed)
  for (const seed of config.seeds.pubmed ?? []) {
    const id = seed.label ?? seed.query
    add({ id, ...(seed.from != null ? { from: seed.from } : {}),
      ...(seed.to != null ? { to: seed.to } : {}),
      ...(seed.grace != null ? { grace: seed.grace } : {}) })
  }

  return { windows, warnings }
}

function isWithin(value: number, window: ResolvedSeedWindow): boolean {
  if (window.from != null && value < window.from) return false
  if (window.to != null && value > window.to) return false
  return true
}

export interface SeedWindowResult {
  publications: Publication[]
  warnings: string[]
}

/**
 * Drop out-of-window seed ids, then drop the records that lost all of them.
 *
 * Three things it deliberately does not do:
 *
 *   - **Touch a pinned record.** `INCLUDE_SEED_ID` in `seedIds` exempts it
 *     outright, before any date is looked at — unless `config.exclude` names it,
 *     because an exclude outranks a pin and an exemption that ignored that would
 *     be a way for an excluded record to come back.
 *   - **Judge an undated record.** A record with no usable year cannot be
 *     placed inside or outside a window, and guessing would remove work from a
 *     CV on the strength of missing metadata. It is kept.
 *   - **Remove anything quietly.** Every removal is named and counted in the
 *     returned warnings, and so is the number of records a *second* member's
 *     window rescued — that number is the co-authorship case working, and it is
 *     worth being able to see it happen.
 */
export function applySeedWindows(
  pubs: readonly Publication[],
  config: ListConfig,
): SeedWindowResult {
  const { windows, warnings } = resolveSeedWindows(config)
  if (windows.size === 0) return { publications: [...pubs], warnings }

  // An exclude outranks a pin, so the pin exemption below must not cover an
  // excluded record. `pipeline.ts` stage 3 has already dropped those before this
  // runs; reading the list again here is what makes the rule a property of this
  // function rather than of the order two stages happen to be in.
  const excluded: IdRef[] = []
  for (const raw of config.exclude ?? []) {
    const ref = parseIdRef(raw)
    // An unreadable reference is reported by the pipeline, not twice here.
    if (ref) excluded.push(ref)
  }

  const publications: Publication[] = []
  const removed: Publication[] = []
  /** seed id → how many records it alone was responsible for losing */
  const blamed = new Map<string, number>()
  let rescued = 0

  for (const pub of pubs) {
    if (
      pub.seedIds.includes(INCLUDE_SEED_ID) &&
      !excluded.some((ref) => matchesIdRef(pub, ref))
    ) {
      publications.push(pub)
      continue
    }
    if (!(typeof pub.year === 'number' && pub.year > 0)) {
      publications.push(pub)
      continue
    }

    const value = publicationYearMonth(pub)
    const kept: string[] = []
    const dropped: string[] = []
    // `INCLUDE_SEED_ID` carries no window, so leaving it in would make it count
    // as a surviving seed and keep every record that reaches this point —
    // declining the exemption above would then change nothing. A record only
    // gets here with the marker still on it when an exclude cancelled the pin.
    for (const id of pub.seedIds.filter((id) => id !== INCLUDE_SEED_ID)) {
      const window = windows.get(id)
      if (window == null || isWithin(value, window)) kept.push(id)
      else dropped.push(id)
    }

    if (dropped.length === 0) {
      publications.push(pub)
      continue
    }
    if (kept.length > 0) {
      // The crux: a co-author who is still in the group keeps the paper.
      rescued++
      publications.push({ ...pub, seedIds: kept })
      continue
    }
    removed.push(pub)
    for (const id of dropped) blamed.set(id, (blamed.get(id) ?? 0) + 1)
  }

  if (removed.length > 0) {
    const bySeed = [...blamed.entries()]
      .map(([id, count]) => {
        const window = windows.get(id)
        return `${window?.description ?? id}: ${count}`
      })
      .join('; ')
    warnings.push(
      `Left ${removed.length} record(s) off the list because every seed that ` +
        `contributed them has a time window that does not cover them: ` +
        `${removed.map((p) => p.title || p.doi || p.pmid || p.key).join('; ')}. ` +
        `Windows responsible — ${bySeed}. ` +
        `Pin a record (include / data-include) to keep it whatever the windows say, ` +
        `as long as it is not also in exclude.`,
    )
  }
  if (rescued > 0) {
    warnings.push(
      `${rescued} record(s) fell outside one member's time window but stayed ` +
        `on the list because another member's window still covers them.`,
    )
  }

  return { publications, warnings }
}
