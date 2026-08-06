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
import { decodeSeed } from '@/core/seeds'
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

// ─────────────────────────────────────────── PMIDs typed into a query box ──

/**
 * One `12345678[pmid]` term. `[uid]` is PubMed's own synonym for the field.
 *
 * Anchored on the digits so `0000-0003-1317-0220[auid]` cannot match: `auid`
 * is not `uid` once the `[` has been consumed.
 */
const PMID_TERM = /(\d{1,9})\s*\[\s*(?:pmid|uid)\s*\]/gi

/** Any `[field]` tag, which is what makes a chunk of a PubMed query a term. */
const FIELD_TAG = /\[\s*[a-z][a-z0-9 /_-]*\s*\]/gi

export interface PmidQueryHint {
  /** the query verbatim, so the UI can point at the line it means */
  query: string
  /** canonical `"pmid:…"` refs found in it, de-duplicated, in order */
  refs: string[]
  /** how many of its field-tagged terms were `[pmid]` / `[uid]` */
  pmidTerms: number
  /** how many field-tagged terms it has in total */
  terms: number
}

/**
 * Is this "query" really a list of pins?
 *
 * A PubMed query made mostly of bare `[pmid]` terms is somebody asking for
 * specific papers, and the query box is the wrong box for that: a query is a
 * *search*, so unless it is an `[auid]` one its hits are candidates and stay
 * off the published list until someone confirms them — which cannot happen on
 * an embedded page. The same identifiers in the pinned-papers box are confirmed
 * outright. Same five papers, opposite outcome.
 *
 * "Mostly" is a strict majority of the field-tagged terms, so the owner's
 * `("SLEEPI"[author]) OR (… 5 × [pmid])` fires while an ordinary author search
 * with one pinned PMID OR'd onto it does not. Returns `null` rather than a
 * flag, because the UI needs the identifiers to be able to name them.
 */
export function detectPmidQuery(query: string): PmidQueryHint | null {
  const refs: string[] = []
  let pmidTerms = 0
  for (const match of query.matchAll(PMID_TERM)) {
    pmidTerms++
    const ref = `pmid:${match[1]}`
    if (!refs.includes(ref)) refs.push(ref)
  }
  if (pmidTerms === 0) return null

  const terms = (query.match(FIELD_TAG) ?? []).length
  if (pmidTerms * 2 <= terms) return null
  return { query, refs, pmidTerms, terms }
}

/** `detectPmidQuery` over the whole PubMed textarea, one entry per query. */
export function detectPmidQueries(text: string): PmidQueryHint[] {
  const hints: PmidQueryHint[] = []
  for (const seed of parsePubmedQueries(text)) {
    const hint = detectPmidQuery(seed.query)
    if (hint) hints.push(hint)
  }
  return hints
}

// ──────────────────────────────────── a group name searched against [au] ──

/**
 * A term written against PubMed's personal-author field.
 *
 * Both spellings of the field: `[au]` and its long form `[author]`. The value
 * is either a quoted phrase or a run of bare words immediately before the tag.
 */
const AUTHOR_TERM =
  /(?:"([^"]+)"|([A-Za-z0-9À-ɏ'’.\-一-鿿぀-ヿ]+(?:[ \t]+[A-Za-z0-9À-ɏ'’.\-一-鿿぀-ヿ]+)*))[ \t]*\[\s*(?:au|author)\s*\]/gi

/** `[cn]`, and the long form PubMed prints it as. */
const CORPORATE_TAG = /\[\s*(?:cn|corporate\s+author)\s*\]/i

/**
 * Words that only ever appear in the name of a body, never in a person's name.
 *
 * Deliberately short. Every entry here is one that cannot be a surname or a
 * given name in any of the naming systems this tool sees.
 */
const COLLECTIVE_WORDS =
  /\b(group|collaborative|collaboration|collaborators|consortium|consortia|investigators|network|trial|initiative|committee|taskforce|task force)\b/i

/** `Furukawa Y`, `van der Berg AB` — a trailing run of initials. */
function endsWithInitials(words: readonly string[]): boolean {
  const last = words[words.length - 1] ?? ''
  return last.length <= 3 && last.length >= 1 && !/[a-z]/.test(last)
}

/** `SLEEPI`, `RECOVERY`, `SLEEP-I` — one bare token with no lowercase in it. */
function isAcronym(word: string): boolean {
  return word.length >= 2 && /^[A-Z0-9]/.test(word) && !/[a-z]/.test(word)
}

export type CollectiveAuthorReason = 'collective-word' | 'acronym' | 'phrase'

export interface CollectiveAuthorHint {
  /** the query verbatim, so the UI can point at the line it means */
  query: string
  /** the `[au]` values that read as a group name, in order, de-duplicated */
  names: string[]
  /** what made the first of them look like one */
  reason: CollectiveAuthorReason
}

/**
 * Does this query search for a *group* in the field that only holds *people*?
 *
 * PubMed keeps a collective author — a study group, a trial consortium — in a
 * separate field from the personal authors. `"RECOVERY Collaborative
 * Group"[au]` returns 0; the same phrase against `[cn]` returns 18 records,
 * which PubMed translates as `[Author - Corporate]` (measured against the live
 * E-utilities API, 2026-08-06). Someone who tries `[au]`, gets nothing, and
 * concludes their group is not in PubMed has been misled by a field name.
 *
 * The rule, over each `[au]` / `[author]` term's value:
 *
 *   1. it contains a word that only names a body — `group`, `collaborative`,
 *      `consortium`, `investigators`, `network`, `trial` … — quoted or not; or
 *   2. it is a single bare token of two or more characters with no lowercase
 *      letter in it, i.e. an acronym (`SLEEPI`, `RECOVERY`, `SLEEP-I`); or
 *   3. it is a **quoted** phrase of three or more words that does not end in a
 *      run of initials.
 *
 * A query that already mentions `[cn]` is left alone — the user knows.
 *
 * What the thresholds are for: personal names in PubMed are written `Family I`
 * or `Family Initials`, which is two words ending in initials, so rule 3 skips
 * both `Furukawa Y[au]` (unquoted anyway) and `"Yuki Furukawa"[au]`, and the
 * initials test additionally spares `"van der Berg AB"[au]`. Rule 2 cannot fire
 * on `Furukawa Y` because that is two tokens. A false hint costs a sentence of
 * reading; a missed one costs a list that is empty for a reason nobody can see,
 * so the rules lean towards firing.
 */
export function detectCollectiveAuthorQuery(
  query: string,
): CollectiveAuthorHint | null {
  if (CORPORATE_TAG.test(query)) return null

  const names: string[] = []
  let reason: CollectiveAuthorReason | null = null

  for (const match of query.matchAll(AUTHOR_TERM)) {
    const quoted = match[1] != null
    // An unquoted run of words can reach back across a boolean operator
    // (`hospital AND Tanaka H[au]`); only the last clause is the author value.
    const raw = (match[1] ?? match[2] ?? '')
      .split(/\b(?:AND|OR|NOT)\b/)
      .pop() as string
    const value = raw.trim()
    if (value === '') continue
    const words = value.split(/\s+/).filter((w) => w !== '')
    if (words.length === 0) continue

    let hit: CollectiveAuthorReason | null = null
    if (COLLECTIVE_WORDS.test(value)) hit = 'collective-word'
    else if (words.length === 1 && isAcronym(words[0])) hit = 'acronym'
    else if (quoted && words.length >= 3 && !endsWithInitials(words)) hit = 'phrase'
    if (hit == null) continue

    reason ??= hit
    if (!names.includes(value)) names.push(value)
  }

  if (reason == null || names.length === 0) return null
  return { query, names, reason }
}

/** `detectCollectiveAuthorQuery` over the whole textarea, one entry per query. */
export function detectCollectiveAuthorQueries(
  text: string,
): CollectiveAuthorHint[] {
  const hints: CollectiveAuthorHint[] = []
  for (const seed of parsePubmedQueries(text)) {
    const hint = detectCollectiveAuthorQuery(seed.query)
    if (hint) hints.push(hint)
  }
  return hints
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

/** One token of a pasted line, with its window taken off it. */
export interface MemberWindowToken {
  /**
   * What is left of the token once the window has been removed — `''` for a
   * bare `2019-04..2023-03`, the identifier for an `id@2019-04:2023-03`.
   */
  rest: string
  window: MemberWindow
}

/**
 * Read a window off one token, in **either** spelling.
 *
 * There are two, for reasons specific to each transport, and a user meets both:
 *
 *   - `2019-04..2023-03+36` — the members box (`MEMBER_WINDOW` above). Canonical:
 *     it is what the placeholder shows and what `setMemberWindow` writes back.
 *   - `id@2019-04:2023-03:36` — the `data-*` attributes and the URL parameters
 *     (`encodeSeed` / `decodeSeed` in `src/core/seeds.ts`), where `..` and a
 *     bare separator would collide with the comma-joined attribute syntax.
 *
 * The second is the one a user *reads*, because it is sitting in the snippet
 * they just copied out of the wizard. Typing it back into the members box used
 * to do nothing visible: the token failed `MEMBER_WINDOW`, was left in place,
 * and its `@…` tail fell through into the name and permalink cells. So both are
 * accepted here — read, never rewritten. A line is only ever normalised to the
 * `..` form when the user edits that member's dates, which goes through
 * `setMemberWindow`.
 *
 * **An email address in a pasted spreadsheet column is not a window.** The `@`
 * branch defers to `decodeSeed`, whose tail pattern is anchored and holds only
 * digits, hyphens and colons, so `someone@example.com` — whose tail is letters
 * and a dot — comes back as a plain string and is treated exactly as it is
 * today. As a second guard the identifier half must itself be free of `@`, and
 * as with `parseMemberWindow` a tail carrying only a grace period and no dates
 * is not a window either.
 */
export function parseMemberWindowToken(token: string): MemberWindowToken | null {
  const raw = token.trim()
  if (raw === '') return null

  const dotted = parseMemberWindow(raw)
  if (dotted) return { rest: '', window: dotted }

  if (!raw.includes('@')) return null
  const seed = decodeSeed(raw)
  if (typeof seed === 'string') return null
  if (seed.id === '' || seed.id.includes('@')) return null
  if (!seed.from && !seed.to) return null

  const window: MemberWindow = {}
  if (seed.from) window.from = seed.from
  if (seed.to) window.to = seed.to
  if (seed.grace != null) window.grace = seed.grace
  return { rest: seed.id, window }
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
 * A line may also carry the member's time in the group, in any position, as a
 * `2019-04..2023-03` token or as the `0000-0002-1825-0097@2019-04:2023-03`
 * spelling the snippet's `data-*` attributes use — see
 * `parseMemberWindowToken`. **A line without one is a seed with no window**,
 * which is what every pasted list has always been and what it stays.
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
    //
    // Only the window itself is taken out. In the `id@from:to` spelling the
    // identifier stays in `rest`, where the ORCID and researchmap checks below
    // find it exactly as they would have found it on its own.
    for (const token of rest.split(/[\s,\t]+/)) {
      const parsed = parseMemberWindowToken(token)
      if (!parsed) continue
      const { window } = parsed
      if (window.from) member.from = window.from
      if (window.to) member.to = window.to
      if (window.grace != null) member.grace = window.grace
      rest = rest.replace(token, () => ` ${parsed.rest} `)
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

  // Strip whatever window the line already carries, wherever it sits, in
  // whichever spelling it is written in — an `id@2019-04:2023-03` token keeps
  // its identifier and loses only the dates, so editing a date here cannot cost
  // the member their seed, and cannot leave two windows on one line.
  const stripped = lines[lineIndex]
    .split(/([\s,\t]+)/)
    .map((part) => parseMemberWindowToken(part)?.rest ?? part)
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
