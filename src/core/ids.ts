/**
 * Identifier normalization and the stable dedupe key.
 *
 * Ported from `publication-list-generator/R/utils.R` (normalization + pattern
 * detection) and `R/deduplicate.R:8-38` (versioned-DOI collapsing).
 *
 * Framework-free and DOM-free on purpose: both the wizard and the embed
 * bundle depend on this module, and every function here is unit-tested.
 *
 * OpenAlex author-ID helpers are deliberately NOT ported — OpenAlex is used
 * only for DOI/PMID enrichment in this project, never as a seed.
 */

import type { Publication } from './types'

const DOI_URL_PREFIX = /^https?:\/\/(dx\.)?doi\.org\//
const ORCID_URL_PREFIX = /^https?:\/\/orcid\.org\//
const RESEARCHMAP_URL_PREFIX = /^https?:\/\/researchmap\.jp\//

/** Trailing ".N" on versioned DOIs (F1000Research, Wellcome Open Research, …). */
const DOI_VERSION_SUFFIX = /\.([1-9]\d?)$/

/**
 * DOI prefixes whose publishers append a `.N` version suffix.
 *
 * The suffix is a publisher convention, not a DOI-wide one, so stripping it
 * unconditionally is unsafe: `10.7717/peerj.55` and `10.7717/peerj.56` are two
 * unrelated PeerJ articles, and a blind strip would collapse every short-numbered
 * article of such a journal onto a single key — silently merging different
 * papers into one entry.
 *
 * F1000-style open-review publishing (F1000Research, Wellcome Open Research,
 * Gates Open Research, HRB Open Research) is the only family that actually
 * versions, and all of it sits under `10.12688/`. `R/deduplicate.R:8-38` has the
 * unguarded bug; this port deliberately does not reproduce it.
 *
 * Exported so it is greppable and easy to extend if another versioned publisher
 * turns up.
 */
export const VERSIONED_DOI_PREFIXES: readonly string[] = ['10.12688/']

const ORCID_PATTERN = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/
const RESEARCHMAP_PATTERN = /^[A-Za-z0-9_]{2,30}$/

/** Lowercase, trim, strip any `https://doi.org/` style prefix. */
export function normalizeDoi(x: string): string {
  return x.trim().toLowerCase().replace(DOI_URL_PREFIX, '').replace(/\/+$/, '')
}

/** Trim, strip an `https://orcid.org/` prefix, uppercase (the checksum may be `X`). */
export function normalizeOrcid(x: string): string {
  return x.trim().replace(ORCID_URL_PREFIX, '').replace(/\/+$/, '').toUpperCase()
}

/** Trim, strip an `https://researchmap.jp/` prefix, keep only the first path segment. */
export function normalizeResearchmapId(x: string): string {
  return x
    .trim()
    .replace(RESEARCHMAP_URL_PREFIX, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '')
}

export function isOrcidId(x: string): boolean {
  return ORCID_PATTERN.test(x.trim())
}

export function isResearchmapId(x: string): boolean {
  const v = x.trim()
  return RESEARCHMAP_PATTERN.test(v) && !isOrcidId(v)
}

export interface StrippedDoi {
  /** the base DOI with any trailing version suffix removed */
  doi: string
  /** the version number that was stripped, if any */
  version?: number
}

/**
 * Split a versioned DOI into its base and version number.
 *
 * `10.12688/f1000research.12345.3` → `{ doi: '10.12688/f1000research.12345', version: 3 }`
 * `10.1136/bmj.n71`                → `{ doi: '10.1136/bmj.n71' }`
 * `10.7717/peerj.55`               → `{ doi: '10.7717/peerj.55' }`  (not versioned)
 *
 * Port of `R/deduplicate.R:8-38`: only `.1`–`.99` count as versions, so a DOI
 * whose last segment happens to end in a large number is left alone. Unlike the
 * R original, the suffix is only stripped for publishers that actually version
 * (`VERSIONED_DOI_PREFIXES`) — see the note there.
 */
export function stripDoiVersion(doi: string): StrippedDoi {
  const normalized = normalizeDoi(doi)
  if (!VERSIONED_DOI_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { doi: normalized }
  }
  const match = DOI_VERSION_SUFFIX.exec(normalized)
  if (!match) return { doi: normalized }
  return {
    doi: normalized.slice(0, match.index),
    version: Number.parseInt(match[1], 10),
  }
}

/**
 * Title fallback slug: lowercase, whitespace-collapsed, letters and digits
 * only (Unicode-aware so Japanese titles from researchmap survive), truncated
 * to 80 characters.
 */
export function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 80)
}

/** The minimum a record needs before it can be keyed. */
export type PubKeyInput = Pick<Publication, 'title'> &
  Partial<Pick<Publication, 'doi' | 'pmid'>>

/**
 * Stable dedupe key, in precedence order: DOI → PMID → title slug.
 *
 * The DOI is version-stripped, so the F1000 v1…v4 records of one paper all
 * collapse onto a single key; `Publication.doiVersion` carries the version.
 */
export function pubKey(pub: PubKeyInput): string {
  if (pub.doi && pub.doi.trim() !== '') {
    return `doi:${stripDoiVersion(pub.doi).doi}`
  }
  if (pub.pmid && pub.pmid.trim() !== '') {
    return `pmid:${pub.pmid.trim()}`
  }
  return `title:${titleSlug(pub.title ?? '')}`
}

export type IdRefKind = 'pmid' | 'doi'

export interface IdRef {
  kind: IdRefKind
  value: string
}

/**
 * Parse an `include` / `exclude` reference string.
 *
 * Canonical form is `"pmid:12345678"` or `"doi:10.1136/bmj.n71"`. Bare input
 * is accepted too, so a user can paste raw PMIDs and DOIs into the wizard:
 * all-digits → PMID, anything starting with `10.` or a doi.org URL → DOI.
 * Returns `null` when the string is not a usable reference.
 */
export function parseIdRef(s: string): IdRef | null {
  const raw = s.trim()
  if (raw === '') return null

  const colon = raw.indexOf(':')
  if (colon > 0) {
    const prefix = raw.slice(0, colon).trim().toLowerCase()
    const rest = raw.slice(colon + 1).trim()
    if (prefix === 'pmid') {
      return /^\d+$/.test(rest) ? { kind: 'pmid', value: rest } : null
    }
    if (prefix === 'doi') {
      const doi = normalizeDoi(rest)
      return doi.startsWith('10.') ? { kind: 'doi', value: doi } : null
    }
  }

  // Tolerant fallbacks for pasted raw identifiers.
  if (/^\d{1,9}$/.test(raw)) return { kind: 'pmid', value: raw }
  const doi = normalizeDoi(raw)
  if (doi.startsWith('10.')) return { kind: 'doi', value: doi }
  return null
}

/** Render an `IdRef` back to its canonical string. */
export function formatIdRefValue(ref: IdRef): string {
  return `${ref.kind}:${ref.value}`
}

/**
 * Canonical `include` / `exclude` reference for a publication, using the same
 * DOI-before-PMID precedence as `pubKey`. Returns `null` when the record has
 * neither identifier (a title-slug key is not a valid reference string).
 */
export function formatIdRef(pub: PubKeyInput): string | null {
  if (pub.doi && pub.doi.trim() !== '') {
    return `doi:${stripDoiVersion(pub.doi).doi}`
  }
  if (pub.pmid && pub.pmid.trim() !== '') {
    return `pmid:${pub.pmid.trim()}`
  }
  return null
}
