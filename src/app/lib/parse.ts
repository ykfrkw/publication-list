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
  /**
   * Index of this member's line in the textarea, counting blank and commented
   * lines. The member-row controls edit the textarea in place — it stays the
   * single source of truth — and this is how a row finds its line.
   */
  lineIndex: number
  name?: string
  orcid?: string
  researchmap?: string
  /** "YYYY-MM" / "YYYY" — start of the member's time in the group */
  from?: string
  /** "YYYY-MM" / "YYYY" — end of it */
  to?: string
  /** months of publication lag allowed after `to`; default is 24 */
  grace?: number
}

/** The `from`/`to`/`grace` triple, on its own. */
export interface MemberWindow {
  from?: string
  to?: string
  grace?: number
}

/**
 * How a member's time in the group is written in the members box:
 * `2019-04..2023-03`, `2019-04..` (still here), `..2023-03` (joined before the
 * record starts), optionally `+36` for a non-default grace period.
 *
 * `..` is the separator because nothing else in a pasted spreadsheet row looks
 * like it — a name never contains one, and a researchmap permalink cannot.
 * Anchored, so a token is either a window or is left alone entirely.
 */
const MEMBER_WINDOW =
  /^(\d{4}(?:-\d{2})?)?\.\.(\d{4}(?:-\d{2})?)?(?:\+(\d{1,3}))?$/

/** Parse one `2019-04..2023-03+36` token, or `null` if it is not one. */
export function parseMemberWindow(token: string): MemberWindow | null {
  const match = MEMBER_WINDOW.exec(token.trim())
  if (!match) return null
  if (!match[1] && !match[2]) return null
  const window: MemberWindow = {}
  if (match[1]) window.from = match[1]
  if (match[2]) window.to = match[2]
  if (match[3]) {
    const grace = Number.parseInt(match[3], 10)
    if (Number.isFinite(grace) && grace >= 0) window.grace = grace
  }
  return window
}

/** Inverse of `parseMemberWindow`. Empty string when there is no window. */
export function formatMemberWindow(window: MemberWindow | null): string {
  if (!window || (!window.from && !window.to)) return ''
  const grace = window.grace == null ? '' : `+${window.grace}`
  return `${window.from ?? ''}..${window.to ?? ''}${grace}`
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
 *
 * A line may also carry the member's time in the group as a `2019-04..2023-03`
 * token in any position — see `parseMemberWindow`. **A line without one is a
 * seed with no window**, which is what every pasted list has always been and
 * what it stays.
 */
export function parseMemberLines(text: string): ParsedMembers {
  const members: ParsedMember[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  // Split so that the index of a line in this array is its index in the
  // textarea; the member rows edit lines by that index.
  text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) return

    const member: ParsedMember = { raw: line, lineIndex }

    // Identifiers first, so what is left over can be treated as free text.
    let rest = line

    // The window token, before anything else looks at the leftovers: it is a
    // bare ASCII word with no whitespace, which is also the shape of a
    // researchmap permalink, so whichever check runs first wins.
    for (const token of rest.split(/[\s,\t]+/)) {
      const window = parseMemberWindow(token)
      if (!window) continue
      if (window.from) member.from = window.from
      if (window.to) member.to = window.to
      if (window.grace != null) member.grace = window.grace
      rest = rest.replace(token, ' ')
      break
    }

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
      return
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
      return
    }

    const key = `${member.orcid ?? ''}|${member.researchmap ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    members.push(member)
  })

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

// ──────────────────────────────────────────── editing the members textarea ──

/**
 * Set (or clear) the time window on one line of the members box.
 *
 * The textarea stays the single source of truth for the member list — there is
 * no parallel structure holding dates that could drift from the text the user
 * can see and edit. A row's date fields write back here.
 */
export function setMemberWindow(
  text: string,
  lineIndex: number,
  window: MemberWindow | null,
): string {
  const lines = text.split(/\r?\n/)
  if (lineIndex < 0 || lineIndex >= lines.length) return text

  // Strip whatever window the line already carries, wherever it sits.
  const stripped = lines[lineIndex]
    .split(/([\s,\t]+)/)
    .filter((part) => parseMemberWindow(part) == null)
    .join('')
    .replace(/[\s,\t]+$/, '')

  const token = formatMemberWindow(window)
  lines[lineIndex] = token === '' ? stripped : `${stripped}\t${token}`
  return lines.join('\n')
}

/**
 * Comment one line out, keeping it visible.
 *
 * What "removing a seed" means in a free-text box. `parseMemberLines` ignores a
 * line starting with `#`, so the seed is gone from the configuration, while the
 * person and their identifier stay on screen where the user can read them — and
 * deleting the `#` puts the seed back. That is what makes freezing recoverable
 * from the UI rather than only from a backup.
 */
export function commentOutLine(
  text: string,
  lineIndex: number,
  note: string,
): string {
  const lines = text.split(/\r?\n/)
  if (lineIndex < 0 || lineIndex >= lines.length) return text
  const line = lines[lineIndex]
  if (line.trim().startsWith('#')) return text
  lines[lineIndex] = `# ${note}\t${line.trim()}`
  return lines.join('\n')
}

/** `"YYYY-MM"` / `"YYYY"`, or `undefined` when the field is blank or malformed. */
export function parseYearMonth(value: string): string | undefined {
  const v = value.trim()
  if (v === '') return undefined
  return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v) ? v : undefined
}
