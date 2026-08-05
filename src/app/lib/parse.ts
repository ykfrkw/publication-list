/**
 * Free-text → structured input, for the three wizard modes.
 *
 * Everything here is a pure function over strings so it can be unit-tested
 * without a DOM. Identifier semantics are NOT reimplemented: `parseIdRef`,
 * `normalizeOrcid`, `isOrcidId` and friends come from `src/core/ids.ts`, which
 * is the single source of truth for what counts as a PMID, a DOI, an ORCID or
 * a researchmap permalink.
 */

import {
  formatIdRefValue,
  normalizeOrcid,
  normalizeResearchmapId,
  parseIdRef,
} from '@/core/ids'
import type { PubmedSeed } from '@/core/types'

export interface ParsedRefs {
  /** canonical `"pmid:…"` / `"doi:…"` strings, de-duplicated, order preserved */
  refs: string[]
  /** the chunks that were not usable identifiers, verbatim, for the UI to show */
  invalid: string[]
}

/**
 * Parse a paste of PMIDs and DOIs.
 *
 * Accepts one per line, comma-separated, or whitespace-separated, in any
 * mixture. A line is tried whole first, so a DOI that legitimately contains a
 * comma (rare but legal) survives; only when the whole line fails is it split
 * on commas and whitespace.
 */
export function parseIdList(text: string): ParsedRefs {
  const refs: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  const push = (chunk: string): boolean => {
    const ref = parseIdRef(chunk)
    if (!ref) return false
    const value = formatIdRefValue(ref)
    if (!seen.has(value)) {
      seen.add(value)
      refs.push(value)
    }
    return true
  }

  for (const rawLine of text.split(/[\r\n;]+/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (push(line)) continue
    for (const chunk of line.split(/[\s,]+/)) {
      const piece = chunk.trim()
      if (piece === '') continue
      if (!push(piece)) invalid.push(piece)
    }
  }

  return { refs, invalid }
}

/** One PubMed query per line. Blank lines and `#` comments are ignored. */
export function parsePubmedQueries(text: string): PubmedSeed[] {
  const seen = new Set<string>()
  const seeds: PubmedSeed[] = []
  for (const rawLine of text.split(/[\r\n]+/)) {
    const query = rawLine.trim()
    if (query === '' || query.startsWith('#')) continue
    if (seen.has(query)) continue
    seen.add(query)
    seeds.push({ query })
  }
  return seeds
}

export interface ParsedMember {
  /** the input line, verbatim — shown back to the user */
  raw: string
  name?: string
  orcid?: string
  researchmap?: string
}

export interface ParsedMembers {
  members: ParsedMember[]
  /** lines that carried neither an ORCID nor a researchmap id */
  invalid: string[]
}

/** Header cells we drop rather than mistake for a member. */
const HEADER_CELLS = new Set([
  'name',
  'names',
  'member',
  'members',
  'orcid',
  'orcid id',
  'orcid_id',
  'researchmap',
  'researchmap id',
  'permalink',
  '氏名',
  '名前',
])

const ORCID_ANYWHERE = /\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/
const RESEARCHMAP_URL_ANYWHERE = /(?:https?:\/\/)?researchmap\.jp\/[^\s,\t]+/i

/**
 * A cell that reads as a person's name rather than an identifier.
 *
 * Anything containing whitespace or a non-ASCII character (Japanese names) is
 * a name. That leaves bare ASCII tokens, which is exactly the shape of a
 * researchmap permalink.
 */
function looksLikeName(cell: string): boolean {
  return /\s/.test(cell) || /[^\x20-\x7e]/.test(cell)
}

/**
 * Parse a pasted member list.
 *
 * One member per line. A line may be a bare ORCID iD, a bare researchmap
 * permalink, an `https://orcid.org/…` URL, or a TSV/CSV row pasted out of
 * Excel in any column order — identifiers are located by shape, not by
 * position, so `Name<TAB>ORCID` and `ORCID<TAB>Name` both work, and so does a
 * plain `Yuki Furukawa 0000-0003-1317-0220`.
 *
 * The one ambiguity left is a name and a researchmap permalink separated by a
 * single space: a permalink is just a bare word, and there is no way to tell
 * it from a middle name. Separate those two with a tab, a comma or two spaces.
 */
export function parseMemberLines(text: string): ParsedMembers {
  const members: ParsedMember[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const rawLine of text.split(/[\r\n]+/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const member: ParsedMember = { raw: line }

    // Identifiers first, so what is left over can be treated as free text.
    let rest = line
    const orcidMatch = ORCID_ANYWHERE.exec(rest)
    if (orcidMatch) {
      member.orcid = normalizeOrcid(orcidMatch[0])
      rest = rest.replace(orcidMatch[0], ' ')
      // Strip a now-orphaned `https://orcid.org/` prefix.
      rest = rest.replace(/(?:https?:\/\/)?orcid\.org\/?/gi, ' ')
    }
    const rmMatch = RESEARCHMAP_URL_ANYWHERE.exec(rest)
    if (rmMatch) {
      member.researchmap = normalizeResearchmapId(rmMatch[0])
      rest = rest.replace(rmMatch[0], ' ')
    }

    const cells = rest
      .split(/\t|,|\s{2,}/)
      .map((c) => c.trim().replace(/^["']|["']$/g, ''))
      .filter((c) => c !== '')
    if (
      cells.length > 0 &&
      !member.orcid &&
      !member.researchmap &&
      cells.every((c) => HEADER_CELLS.has(c.toLowerCase()))
    ) {
      continue
    }

    const names: string[] = []
    for (const cell of cells) {
      if (looksLikeName(cell)) {
        names.push(cell)
        continue
      }
      // A bare ASCII token that is not an ORCID iD: a researchmap permalink.
      if (member.researchmap == null) member.researchmap = normalizeResearchmapId(cell)
      else names.push(cell)
    }

    if (names.length > 0) member.name = names.join(' ')
    if (!member.orcid && !member.researchmap) {
      invalid.push(line)
      continue
    }

    const key = `${member.orcid ?? ''}|${member.researchmap ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    members.push(member)
  }

  return { members, invalid }
}

/** Comma- or newline-separated author names, for the bold-names field. */
export function parseNameList(text: string): string[] {
  const out: string[] = []
  for (const chunk of text.split(/[\r\n,;]+/)) {
    const name = chunk.trim()
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

/** `"YYYY-MM"` / `"YYYY"`, or `undefined` when the field is blank or malformed. */
export function parseYearMonth(value: string): string | undefined {
  const v = value.trim()
  if (v === '') return undefined
  return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v) ? v : undefined
}
