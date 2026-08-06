/**
 * ListConfig parsing, defaults, serialization and hashing.
 *
 * Framework-free. The only DOM contact in this module is inside
 * `parseConfigFromDataset`, which receives an element from the caller — no
 * DOM API is touched at module scope.
 */

import type { CitationStyle, ListConfig, PubmedSeed } from './types'
import { normalizeDoi, normalizeOrcid, normalizeResearchmapId } from './ids'
import { decodeSeed, normalizeSeedList } from './seeds'

const CITATION_STYLE_VALUES: readonly CitationStyle[] = [
  'vancouver',
  'apa',
  'harvard',
  'chicago',
  'nature',
]

const GROUP_BY_VALUES = ['category-year', 'category', 'year', 'none'] as const
const PREPRINTS_VALUES = ['include', 'exclude'] as const
const JAPANESE_VALUES = ['separate', 'merge', 'hide'] as const
const REVIEW_POLICY_VALUES = ['strict', 'auto'] as const
const DISCLAIMER_VALUES = ['show', 'hide'] as const

export const DEFAULT_STYLE: CitationStyle = 'vancouver'
/**
 * Publication-type sections, and inside each one a divider per year.
 *
 * Both questions a publication page gets asked at once: *what kind of work is
 * this* and *how recent is it*. The type sections keep original articles from
 * being read alongside editorials and letters, and the year dividers inside
 * them answer "is this group still active?" without the reader scanning dates
 * down the citations.
 *
 * `category`, `year` and `none` all remain one attribute away on every
 * transport, and `none` is what a reference list wants.
 */
export const DEFAULT_GROUP_BY: NonNullable<ListConfig['groupBy']> =
  'category-year'
/**
 * The source note is on unless it is switched off.
 *
 * A list assembled automatically from third-party records should say so where
 * it is read, not only in this repository's documentation: the reader of an
 * embedded lab page has no other way to know that a missing paper is a gap in
 * ORCID rather than a claim about the group.
 */
export const DEFAULT_DISCLAIMER: NonNullable<ListConfig['disclaimer']> = 'show'
/**
 * Preprints are off unless asked for. Same reasoning as `strict` review
 * policy: the default is the conservative reading of "my publication list".
 */
export const DEFAULT_PREPRINTS: NonNullable<ListConfig['preprints']> = 'exclude'
export const DEFAULT_JAPANESE: NonNullable<ListConfig['japanese']> = 'separate'
export const DEFAULT_REVIEW_POLICY: NonNullable<ListConfig['reviewPolicy']> =
  'strict'

/**
 * Result of reading an embed container's `data-*` attributes.
 *
 * The registry pointer (`data-list`) is returned beside the config rather than
 * inside it: it says *where to fetch a ListConfig from*, it is not part of one.
 */
export interface DatasetConfig {
  config: Partial<ListConfig>
  /** `data-list` — id in this repository's invite-only `lists/` registry */
  listId?: string
}

/**
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A REGISTRY ID
 *
 * A `data-list` / `?list=` value is interpolated into `lists/<id>.json` and
 * resolved against a base URL, so it is a **path fragment supplied by whoever
 * wrote the markup**. `new URL()` resolves `..` the way any path does:
 * `data-list="../../secrets"` addresses `<site>/secrets.json`, outside the
 * registry entirely.
 *
 * The rule is therefore "a bare filename": start with a letter or digit, then
 * letters, digits, dot, dash, underscore. No slash, so no path; no leading dot,
 * so `..` cannot even begin. Anything else is refused before a request is made.
 *
 * It lives here, beside `DatasetConfig.listId`, because this module is where an
 * id is produced and all three consumers already import from it — the widget
 * (`src/widget/main.ts`), the embed script (`src/embed/entry.ts`) and the
 * wizard's restore (`src/app/lib/restore.ts`). It was written out three times
 * before, and `entry.ts` was the copy that got missed: its comment claimed the
 * guard while the code resolved the id unchecked. One definition, so a fourth
 * consumer cannot repeat that.
 *
 * Each consumer still decides what to *do* with a bad id — they have different
 * ways of reporting one — but none of them decides what "bad" means.
 * ──────────────────────────────────────────────────────────────────────────
 */
export const LIST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/** Is this `data-list` / `?list=` value safe to resolve against `lists/`? */
export function isListId(value: string | undefined): value is string {
  return value != null && LIST_ID_PATTERN.test(value)
}

/**
 * ──────────────────────────────────────────────────────────────────────────
 * HOW A COMMA TRAVELS IN A COMMA-JOINED LIST
 *
 * Six parameters are lists, and both transports join them with `,`. A PubMed
 * query is free text and a realistic one contains a comma —
 * `Furukawa Y[au] AND (Tokyo, Japan[ad])` — which the naive join turns into two
 * seeds, silently and with no error anywhere.
 *
 * So every element is percent-escaped on the way out and unescaped on the way
 * in, and only for the two characters that need it:
 *
 *   encode:  `%` → `%25`   then   `,` → `%2C`
 *   decode:  `%2C` → `,`   then   `%25` → `%`
 *
 * The orders are mirror images, which is what makes it a true inverse: after
 * encoding, the only `%` left in the output is the one that starts an escape,
 * so decoding `%2C` first cannot chew into a `%25` and decoding `%25` second
 * cannot manufacture a fresh `%2C`. `%252C` (a literal `%2C` the user typed)
 * decodes to `%2C`, not to a comma.
 *
 * `encodeListValue` lives here rather than in the snippet builder so that the
 * writer and the reader are the same pair of functions, and the `data-*` and
 * query-string transports cannot drift apart on it.
 *
 * The one cost, accepted deliberately: a snippet published *before* this
 * existed whose value contained the literal text `%25`, `%2C` or `%2c` now
 * decodes differently. The tool is days old and has no users but its author.
 * ──────────────────────────────────────────────────────────────────────────
 */
export function encodeListValue(value: string): string {
  return value.replace(/%/g, '%25').replace(/,/g, '%2C')
}

/** Inverse of `encodeListValue`. Lowercase `%2c` is accepted for hand edits. */
export function decodeListValue(value: string): string {
  return value.replace(/%2C/gi, ',').replace(/%25/g, '%')
}

/**
 * Split a comma-separated attribute into trimmed, non-empty values.
 *
 * Trimming happens before decoding, so an escape can carry leading or trailing
 * whitespace that the split would otherwise eat.
 */
function splitList(value: string | undefined): string[] | undefined {
  if (value == null) return undefined
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(decodeListValue)
  return parts.length > 0 ? parts : undefined
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value == null) return undefined
  const v = value.trim().toLowerCase()
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

function attr(el: HTMLElement, name: string): string | undefined {
  const v = el.getAttribute(name)
  if (v == null) return undefined
  const trimmed = v.trim()
  return trimmed === '' ? undefined : trimmed
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value == null) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** "YYYY-MM" or "YYYY" (normalized to "YYYY-01" / "YYYY-12" by the caller). */
function parseYearMonth(value: string | undefined): string | undefined {
  if (value == null) return undefined
  return /^\d{4}(-\d{2})?$/.test(value) ? value : undefined
}

/**
 * Canonical parameter names, without the `data-` prefix the DOM spells them
 * with. `parseConfigFromDataset` and `parseConfigFromSearchParams` both drive
 * the same reader over this vocabulary, so the two transports can never drift
 * apart on which knobs exist or how their values are coerced.
 */
export const CONFIG_PARAM_NAMES = [
  'orcid',
  'researchmap',
  'pubmed',
  'pubmed-trusted',
  'include',
  'exclude',
  'bold-names',
  'style',
  'group-by',
  'preprints',
  'japanese',
  'review-policy',
  'disclaimer',
  'from',
  'to',
  'limit',
  'list',
] as const

/**
 * Pulls one raw parameter value out of whatever transport is in play.
 *
 * `multi` says whether the parameter is a comma-separated list. A transport
 * that can carry the same name more than once (a query string) uses it to
 * decide between joining the repeats and taking the first; one that cannot
 * (a `data-*` attribute) ignores it.
 */
type ConfigReader = (name: string, multi: boolean) => string | undefined

/**
 * The single place a `ListConfig` is coerced out of string parameters.
 *
 * Every rule about what is accepted lives here — which names exist, which are
 * comma-separated, which vocabularies are closed, and what an unrecognized
 * value does. Both public parsers are thin adapters over it.
 */
function readConfig(read: ConfigReader): DatasetConfig {
  const config: Partial<ListConfig> = {}

  // `decodeSeed` before the id normalizer, so `ID@2019-04:2023-03` keeps its
  // window and a plain `ID` comes back as the bare string it has always been.
  const orcid = splitList(read('orcid', true))
    ?.map(decodeSeed)
    .map((seed) => normalizeSeedList([seed], normalizeOrcid)[0])
    .filter((seed) => seed !== undefined)
  const researchmap = splitList(read('researchmap', true))
    ?.map(decodeSeed)
    .map((seed) => normalizeSeedList([seed], normalizeResearchmapId)[0])
    .filter((seed) => seed !== undefined)
  // No window decoding here: a PubMed seed's value is a free-text query, and
  // reinterpreting part of one as a date range would be a guess about somebody
  // else's search syntax. `from` / `to` / `grace` on a PubMed seed — like
  // `label` — have nowhere to travel on either transport and are wizard-side
  // losses that `restore.ts` reports rather than swallows.
  //
  // **`trust` is the exception, and it travels beside the query rather than
  // inside it.** Its loss is the one that is not cosmetic: a seed the owner
  // marked confirmed, arriving as a plain query, silently reverts to
  // `'candidate'` and its records vanish from the page. But a marker smuggled
  // into the query text would be indistinguishable from the user's own search
  // syntax — so the query string stays exactly what the user typed (commas
  // and all: `encodeListValue` above is what keeps one intact), and
  // the flag rides in a second parameter, `pubmed-trusted`, as the zero-based
  // positions of the trusted queries within `pubmed`. Positions are safe here
  // because both parameters are written in one go by
  // `configToDataAttributes`; they are never edited apart.
  //
  // Anything unusable in that list — a non-integer, a negative number, an index
  // past the end of the query list — is ignored rather than raised. A snippet
  // someone has hand-edited then falls back to "needs review", which is the
  // safe direction: an unreviewed record stays off the page.
  const trustedLines = new Set<number>()
  for (const raw of splitList(read('pubmed-trusted', true)) ?? []) {
    if (!/^\d+$/.test(raw)) continue
    const index = Number.parseInt(raw, 10)
    if (Number.isSafeInteger(index)) trustedLines.add(index)
  }
  const pubmed: PubmedSeed[] | undefined = splitList(read('pubmed', true))?.map(
    (query, index) =>
      trustedLines.has(index) ? { query, trust: 'confirmed' as const } : { query },
  )

  if (orcid || researchmap || pubmed) {
    config.seeds = {}
    if (orcid) config.seeds.orcid = orcid
    if (researchmap) config.seeds.researchmap = researchmap
    if (pubmed) config.seeds.pubmed = pubmed
  }

  const include = splitList(read('include', true))
  if (include) config.include = include
  const exclude = splitList(read('exclude', true))
  if (exclude) config.exclude = exclude
  const boldNames = splitList(read('bold-names', true))
  if (boldNames) config.boldNames = boldNames

  const style = oneOf(read('style', false), CITATION_STYLE_VALUES)
  if (style) config.style = style
  const groupBy = oneOf(read('group-by', false), GROUP_BY_VALUES)
  if (groupBy) config.groupBy = groupBy
  // Like `review-policy`, an unrecognized value falls back to the cautious
  // default rather than publishing something the author did not ask for.
  const preprints = oneOf(read('preprints', false), PREPRINTS_VALUES)
  if (preprints) config.preprints = preprints
  const japanese = oneOf(read('japanese', false), JAPANESE_VALUES)
  if (japanese) config.japanese = japanese
  // An unrecognized value is ignored, so a typo falls back to the safe
  // `strict` default rather than silently publishing unreviewed candidates.
  const reviewPolicy = oneOf(read('review-policy', false), REVIEW_POLICY_VALUES)
  if (reviewPolicy) config.reviewPolicy = reviewPolicy
  // Unrecognized again falls back to the default, which here means the note
  // stays on: a typo must not quietly strip a statement about provenance.
  const disclaimer = oneOf(read('disclaimer', false), DISCLAIMER_VALUES)
  if (disclaimer) config.disclaimer = disclaimer

  const from = parseYearMonth(read('from', false))
  if (from) config.from = from
  const to = parseYearMonth(read('to', false))
  if (to) config.to = to

  const limit = parsePositiveInt(read('limit', false))
  if (limit != null) config.limit = limit

  return {
    config,
    listId: read('list', false),
  }
}

/**
 * Read a `ListConfig` out of an embed container's `data-*` attributes.
 *
 * Recognized: data-orcid, data-researchmap, data-pubmed, data-pubmed-trusted,
 * data-include,
 * data-exclude, data-style, data-from, data-to, data-group-by, data-preprints,
 * data-japanese, data-review-policy, data-disclaimer, data-limit,
 * data-bold-names (comma-separated where plural, and each value escaped by
 * `encodeListValue`), plus the registry pointer data-list.
 */
export function parseConfigFromDataset(el: HTMLElement): DatasetConfig {
  return readConfig((name) => attr(el, `data-${name}`))
}

/**
 * Names a query string may spell a parameter with.
 *
 * The hyphenated form is canonical, because it is what dropping the `data-`
 * prefix off the attribute yields and therefore what the wizard's iframe
 * snippet emits. The camelCase spellings are accepted too: they match the
 * `ListConfig` field names, and a hand-written iframe URL is exactly where
 * someone reaches for `groupBy` before `group-by`.
 */
const SEARCH_PARAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'bold-names': ['bold-names', 'boldNames', 'boldnames'],
  'group-by': ['group-by', 'groupBy', 'groupby'],
  'pubmed-trusted': ['pubmed-trusted', 'pubmedTrusted', 'pubmedtrusted'],
  'review-policy': ['review-policy', 'reviewPolicy', 'reviewpolicy'],
}

/**
 * Read a `ListConfig` out of a URL query string — the iframe fallback's
 * transport, in place of the JS embed's `data-*` attributes.
 *
 * Identical vocabulary and identical coercion (both go through `readConfig`),
 * so `?orcid=…&style=vancouver` and `data-orcid="…" data-style="vancouver"`
 * produce the same config. Two things a query string can do that an attribute
 * cannot, and how they are handled:
 *
 *   - **repeated names** — `?orcid=A&orcid=B` is treated as the list `A,B`,
 *     the same as `?orcid=A,B`. For a single-valued parameter the first
 *     occurrence wins and the rest are ignored.
 *   - **camelCase spellings** — see `SEARCH_PARAM_ALIASES`.
 */
export function parseConfigFromSearchParams(
  params: URLSearchParams,
): DatasetConfig {
  return readConfig((name, multi) => {
    const names = SEARCH_PARAM_ALIASES[name] ?? [name]
    const values: string[] = []
    for (const alias of names) {
      for (const raw of params.getAll(alias)) {
        const trimmed = raw.trim()
        if (trimmed === '') continue
        values.push(trimmed)
        if (!multi) return trimmed
      }
    }
    return values.length > 0 ? values.join(',') : undefined
  })
}

/**
 * Rebuild the PubMed seed list from known fields only.
 *
 * Same shape of rule as `normalizeSeedList`: drop a seed with no query, and
 * drop redundancy rather than write it out — a seed with no `trust` and one
 * marked `'candidate'` are the same seed, so only `'confirmed'` survives.
 *
 * The narrowing is what matters for `trust`: **anything that is not exactly
 * `'confirmed'` is dropped**, so a typo (`"trusted"`, `true`, `"yes"`) in a
 * hand-edited `lists/*.json` falls back to the reviewed default rather than
 * publishing unreviewed hits. Same direction as `review-policy` above.
 */
function normalizePubmedSeeds(
  seeds: readonly PubmedSeed[] | undefined,
): PubmedSeed[] {
  const out: PubmedSeed[] = []
  for (const seed of seeds ?? []) {
    const query = (seed.query ?? '').trim()
    if (query === '') continue
    const next: PubmedSeed = { query }
    if (seed.label != null && seed.label !== '') next.label = seed.label
    if (seed.trust === 'confirmed') next.trust = 'confirmed'
    if (seed.from != null) next.from = seed.from
    if (seed.to != null) next.to = seed.to
    if (seed.grace != null) next.grace = seed.grace
    out.push(next)
  }
  return out
}

/** Canonicalize an include/exclude reference string; drops unusable entries. */
function normalizeRefs(refs: string[] | undefined): string[] | undefined {
  if (!refs) return undefined
  const out: string[] = []
  for (const raw of refs) {
    const s = raw.trim()
    if (s === '') continue
    const lower = s.toLowerCase()
    if (lower.startsWith('doi:')) out.push(`doi:${normalizeDoi(s.slice(4))}`)
    else if (lower.startsWith('pmid:')) out.push(`pmid:${s.slice(5).trim()}`)
    else out.push(s)
  }
  return out.length > 0 ? Array.from(new Set(out)) : undefined
}

/** Fill in the defaults so downstream code never has to branch on `undefined`. */
export function normalizeConfig(partial: Partial<ListConfig>): ListConfig {
  const seeds = partial.seeds ?? {}
  // `normalizeSeedList` normalizes the id and leaves any window on it intact,
  // so a bare-string seed stays a bare string and a windowed one stays an
  // object. Nothing downstream has to know which form it was given.
  const orcid = normalizeSeedList(seeds.orcid, normalizeOrcid)
  const researchmap = normalizeSeedList(seeds.researchmap, normalizeResearchmapId)
  const pubmed = normalizePubmedSeeds(seeds.pubmed)
  const config: ListConfig = {
    v: 1,
    seeds: {
      ...(orcid.length ? { orcid } : {}),
      ...(researchmap.length ? { researchmap } : {}),
      ...(pubmed.length ? { pubmed } : {}),
    },
    style: partial.style ?? DEFAULT_STYLE,
    groupBy: partial.groupBy ?? DEFAULT_GROUP_BY,
    preprints: partial.preprints ?? DEFAULT_PREPRINTS,
    japanese: partial.japanese ?? DEFAULT_JAPANESE,
    reviewPolicy: partial.reviewPolicy ?? DEFAULT_REVIEW_POLICY,
    disclaimer: partial.disclaimer ?? DEFAULT_DISCLAIMER,
  }

  const include = normalizeRefs(partial.include)
  if (include) config.include = include
  const exclude = normalizeRefs(partial.exclude)
  if (exclude) config.exclude = exclude
  if (partial.boldNames?.length) config.boldNames = partial.boldNames
  if (partial.from) config.from = partial.from
  if (partial.to) config.to = partial.to
  if (partial.limit != null && partial.limit > 0) config.limit = partial.limit

  return config
}

/** Deterministic JSON: object keys sorted, two-space indent, trailing newline. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue
      out[key] = sortKeys(src[key])
    }
    return out
  }
  return value
}

/**
 * Stable pretty JSON.
 *
 * Its consumer is `configHash` below — the cache key — and the `lists/*.json`
 * registry files, which are written by hand in this repository. There is no
 * longer a download button behind it; the way a user comes back to a
 * configuration is to paste their snippet into the wizard (`restore.ts`).
 */
export function serializeConfig(config: ListConfig): string {
  return `${JSON.stringify(sortKeys(config), null, 2)}\n`
}

/**
 * FNV-1a 32-bit hash of the serialized config, as 8 hex digits.
 *
 * Non-cryptographic and synchronous on purpose: it only has to key the
 * localStorage cache entry, and `crypto.subtle.digest` is async.
 */
export function configHash(config: ListConfig): string {
  const input = serializeConfig(config)
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash * 16777619, kept in 32-bit range without overflowing the mantissa
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
