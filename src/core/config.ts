/**
 * ListConfig parsing, defaults, serialization and hashing.
 *
 * Framework-free. The only DOM contact in this module is inside
 * `parseConfigFromDataset`, which receives an element from the caller — no
 * DOM API is touched at module scope.
 */

import type { CitationStyle, ListConfig, PubmedSeed } from './types'
import { normalizeDoi, normalizeOrcid, normalizeResearchmapId } from './ids'

const CITATION_STYLE_VALUES: readonly CitationStyle[] = [
  'vancouver',
  'apa',
  'harvard',
  'chicago',
  'nature',
]

const GROUP_BY_VALUES = ['category', 'year', 'none'] as const
const JAPANESE_VALUES = ['separate', 'merge', 'hide'] as const
const REVIEW_POLICY_VALUES = ['strict', 'auto'] as const

export const DEFAULT_STYLE: CitationStyle = 'vancouver'
export const DEFAULT_GROUP_BY: NonNullable<ListConfig['groupBy']> = 'category'
export const DEFAULT_JAPANESE: NonNullable<ListConfig['japanese']> = 'separate'
export const DEFAULT_REVIEW_POLICY: NonNullable<ListConfig['reviewPolicy']> =
  'strict'

/**
 * Result of reading an embed container's `data-*` attributes.
 *
 * The remote-config pointers (`data-config`, `data-list`) are returned beside
 * the config rather than inside it: they say *where to fetch a ListConfig
 * from*, they are not part of one.
 */
export interface DatasetConfig {
  config: Partial<ListConfig>
  /** `data-config` — URL of a hosted pubs.json */
  configUrl?: string
  /** `data-list` — id in this repository's invite-only `lists/` registry */
  listId?: string
}

/** Split a comma-separated attribute into trimmed, non-empty values. */
function splitList(value: string | undefined): string[] | undefined {
  if (value == null) return undefined
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
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
 * Read a `ListConfig` out of an embed container's `data-*` attributes.
 *
 * Recognized: data-orcid, data-researchmap, data-pubmed, data-include,
 * data-exclude, data-style, data-from, data-to, data-group-by, data-japanese,
 * data-review-policy, data-limit, data-bold-names (comma-separated where
 * plural), plus the remote-config pointers data-config and data-list.
 */
export function parseConfigFromDataset(el: HTMLElement): DatasetConfig {
  const config: Partial<ListConfig> = {}

  const orcid = splitList(attr(el, 'data-orcid'))?.map(normalizeOrcid)
  const researchmap = splitList(attr(el, 'data-researchmap'))?.map(
    normalizeResearchmapId,
  )
  const pubmed: PubmedSeed[] | undefined = splitList(
    attr(el, 'data-pubmed'),
  )?.map((query) => ({ query }))

  if (orcid || researchmap || pubmed) {
    config.seeds = {}
    if (orcid) config.seeds.orcid = orcid
    if (researchmap) config.seeds.researchmap = researchmap
    if (pubmed) config.seeds.pubmed = pubmed
  }

  const include = splitList(attr(el, 'data-include'))
  if (include) config.include = include
  const exclude = splitList(attr(el, 'data-exclude'))
  if (exclude) config.exclude = exclude
  const boldNames = splitList(attr(el, 'data-bold-names'))
  if (boldNames) config.boldNames = boldNames

  const style = oneOf(attr(el, 'data-style'), CITATION_STYLE_VALUES)
  if (style) config.style = style
  const groupBy = oneOf(attr(el, 'data-group-by'), GROUP_BY_VALUES)
  if (groupBy) config.groupBy = groupBy
  const japanese = oneOf(attr(el, 'data-japanese'), JAPANESE_VALUES)
  if (japanese) config.japanese = japanese
  // An unrecognized value is ignored, so a typo falls back to the safe
  // `strict` default rather than silently publishing unreviewed candidates.
  const reviewPolicy = oneOf(attr(el, 'data-review-policy'), REVIEW_POLICY_VALUES)
  if (reviewPolicy) config.reviewPolicy = reviewPolicy

  const from = parseYearMonth(attr(el, 'data-from'))
  if (from) config.from = from
  const to = parseYearMonth(attr(el, 'data-to'))
  if (to) config.to = to

  const limit = parsePositiveInt(attr(el, 'data-limit'))
  if (limit != null) config.limit = limit

  return {
    config,
    configUrl: attr(el, 'data-config'),
    listId: attr(el, 'data-list'),
  }
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
  const config: ListConfig = {
    v: 1,
    seeds: {
      ...(seeds.orcid?.length ? { orcid: seeds.orcid.map(normalizeOrcid) } : {}),
      ...(seeds.researchmap?.length
        ? { researchmap: seeds.researchmap.map(normalizeResearchmapId) }
        : {}),
      ...(seeds.pubmed?.length ? { pubmed: seeds.pubmed } : {}),
    },
    style: partial.style ?? DEFAULT_STYLE,
    groupBy: partial.groupBy ?? DEFAULT_GROUP_BY,
    japanese: partial.japanese ?? DEFAULT_JAPANESE,
    reviewPolicy: partial.reviewPolicy ?? DEFAULT_REVIEW_POLICY,
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

/** Stable pretty JSON, used for the `pubs.json` download and for hashing. */
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
