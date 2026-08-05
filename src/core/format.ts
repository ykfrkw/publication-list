/**
 * Citation string builders.
 *
 * Ported from `publication-list-generator/R/format_citation.R` (the newer of
 * the two references) with the bold-name matching of R commit `7eb9d07`
 * ("Match bold_names against full author names to prevent Yuri/Yuki
 * confusion"). Where `orcid-publication-list/src/api/formatter.ts` disagreed
 * with the R version, the R version won.
 *
 * Framework-free and DOM-free: shared by the React wizard and the embed
 * bundle. Nothing here reads or writes the document.
 *
 * SECURITY: every string that reaches this module comes from an upstream API
 * (ORCID, PubMed, OpenAlex, Crossref, researchmap) and is therefore untrusted.
 * Titles, journal names, author names, DOIs — all of it goes through
 * `escapeHtml` (or `escapeUrl` for hrefs) before it is interpolated into
 * markup. The plain-text builders never escape, because their output never
 * becomes HTML.
 */

import type { CitationStyle, Publication } from './types'

// ───────────────────────────────────────────────────────────── escaping ──

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape the five characters that can break out of HTML text or attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/**
 * Escape a URL for use in an `href`.
 *
 * Percent-encoding first means a quote or angle bracket smuggled into a DOI
 * can never terminate the attribute, even before `escapeHtml` runs.
 */
export function escapeUrl(url: string): string {
  let encoded: string
  try {
    encoded = encodeURI(url)
  } catch {
    // Lone surrogates make encodeURI throw; fall back to escaping only.
    encoded = url
  }
  return escapeHtml(encoded)
}

// ─────────────────────────────────────────────────────── name matching ──

/**
 * Surname particles, from `R/format_citation.R`. They let "Annemieke van
 * Straten" resolve its family name to "van straten" rather than "straten".
 */
const PARTICLES = new Set([
  'van',
  'von',
  'de',
  'del',
  'di',
  'la',
  'le',
  'el',
  'al',
  'den',
  'der',
  'das',
  'dos',
])

/** Characters `String.normalize('NFD')` cannot decompose into ASCII + marks. */
const TRANSLITERATIONS: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
}

/**
 * Port of the R `normalize()` helper: lowercase, transliterate to ASCII, drop
 * everything that is not a letter or a space, collapse whitespace.
 *
 * "Müller-Bergh, J." → "muller bergh j"
 *
 * One deviation from R: hyphens, dashes and slashes become spaces rather than
 * being deleted, so a compound surname written "Müller-Bergh" lines up with
 * one written "Muller Bergh". Apostrophes and periods are still deleted, which
 * keeps "O'Brien" a single word rather than an "o" initial plus "brien".
 */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[øæœßđðþłı]/g, (ch) => TRANSLITERATIONS[ch])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-\u2010-\u2015/]+/g, ' ')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a bold name into leading given-name parts and the family name. */
function splitBoldName(parts: string[]): { initials: string; family: string } {
  let surnameStart = parts.length - 1
  for (let k = 0; k < parts.length; k++) {
    if (PARTICLES.has(parts[k]) && k > 0 && k < parts.length - 1) {
      surnameStart = k
      break
    }
  }
  return {
    initials: parts
      .slice(0, surnameStart)
      .map((p) => p.charAt(0))
      .join(''),
    family: parts.slice(surnameStart).join(' '),
  }
}

/**
 * Does every part of the bold name land on a *distinct* word of the author's
 * full name?
 *
 * The R version tested `str_detect(name_norm, fixed(part))` — a substring
 * search over the whole name. That is too loose: a bold name of "Li" matches
 * "Alice", and a bare initial "y" matches anywhere inside "Hayashi". Here each
 * part must line up with the *start of a word*, and each word can only be
 * consumed once. Longest parts are matched first so a surname claims its own
 * word before an initial can steal it.
 */
function matchesAllParts(authorParts: string[], boldParts: string[]): boolean {
  const used = new Array<boolean>(authorParts.length).fill(false)
  const ordered = [...boldParts].sort((a, b) => b.length - a.length)

  for (const part of ordered) {
    let hit = -1
    for (let i = 0; i < authorParts.length; i++) {
      if (used[i]) continue
      const word = authorParts[i]
      if (word === part || word.startsWith(part)) {
        hit = i
        break
      }
    }
    if (hit === -1) return false
    used[hit] = true
  }
  return true
}

/**
 * Does an author's name match any entry of `boldNames`? Case-insensitive,
 * accent-insensitive, and matched on the *full* name where one is available.
 *
 * Two regimes, exactly as in R:
 *
 * 1. The author name is itself short form ("Furukawa Y" — one long word plus
 *    initials). Compare family name plus initials: "Yuki Furukawa" matches
 *    "Furukawa Y" because the family names are equal and "y" appears in the
 *    bold name's initials.
 * 2. The author name is full form ("Furukawa Yuki"). Every part of the bold
 *    name must land on a distinct word. This is what keeps "Furukawa Yuki"
 *    from bolding a co-author called "Furukawa Yuri".
 *
 * Note the limit of regime 2: a *bold name* given in short form ("Furukawa Y")
 * carries no information that separates Yuki from Yuri, so it matches both.
 * To disambiguate co-authors who share a surname and an initial, the bold name
 * must be spelled out.
 */
export function matchesBoldName(
  fullName: string,
  boldNames: readonly string[],
): boolean {
  if (!fullName || boldNames.length === 0) return false

  const nameNorm = normalizeName(fullName)
  if (nameNorm === '') return false

  const authorParts = nameNorm.split(' ')
  const wordParts = authorParts.filter((p) => p.length >= 2)
  // Particles belong to the surname, so "van Straten A" counts as short form
  // with the family name "van straten" — R counted "van" as a name word of its
  // own and so never reached its own particle handling.
  const nameWords = wordParts.filter((p) => !PARTICLES.has(p))
  const authorIsShort = authorParts.length >= 2 && nameWords.length === 1

  const authorFamily = wordParts.join(' ')
  const authorInitials = authorParts.filter((p) => p.length === 1).join('')

  for (const bn of boldNames) {
    const bnNorm = normalizeName(bn)
    if (bnNorm === '') continue
    const bnParts = bnNorm.split(' ')

    if (authorIsShort) {
      const bold = splitBoldName(bnParts)
      if (
        authorFamily === bold.family &&
        (authorInitials === '' || bold.initials.includes(authorInitials))
      ) {
        return true
      }
    } else if (matchesAllParts(authorParts, bnParts)) {
      return true
    }
  }
  return false
}

// ──────────────────────────────────────────────────────────── authors ──

/**
 * Bold markup for a matched author.
 *
 * The R version emitted `<strong><u>…</u></strong>`. This project uses plain
 * `<b>` so the fragment inherits the host page's typography and never
 * underlines (an underline reads as a link in a web context).
 */
function markBold(name: string): string {
  return `<b>${name}</b>`
}

function joinForStyle(parts: string[], style: CitationStyle): string {
  if (parts.length === 1) return parts[0]
  const head = parts.slice(0, -1).join(', ')
  const tail = parts[parts.length - 1]
  switch (style) {
    case 'apa':
      return `${head}, & ${tail}`
    case 'harvard':
      return `${head} and ${tail}`
    case 'chicago':
      return `${head}, and ${tail}`
    default:
      // Vancouver, Nature
      return parts.join(', ')
  }
}

/**
 * Build the author segment.
 *
 * Display uses the short forms in `pub.authors`; bold status is decided from
 * `pub.authorsFull` when the two lists line up (R falls back to the short form
 * on any length mismatch, and so does this).
 *
 * Truncation follows the R version: more than six authors → first three, then
 * any bolded author who would have been hidden, then "et al." The older TS
 * formatter used per-style thresholds (6 / 20 / 3 / 10 / 5); R wins.
 */
function formatAuthorList(
  pub: Publication,
  style: CitationStyle,
  boldNames: readonly string[],
  html: boolean,
): string {
  const authors = (pub.authors ?? []).filter((a) => a && a.trim() !== '')
  if (authors.length === 0) return ''

  const full = pub.authorsFull ?? []
  const matchAgainst = full.length === authors.length ? full : authors

  const isBold = matchAgainst.map((name) => matchesBoldName(name, boldNames))
  const formatted = authors.map((name, i) => {
    const text = html ? escapeHtml(name) : name
    return html && isBold[i] ? markBold(text) : text
  })

  if (formatted.length > 6) {
    const visible = formatted.slice(0, 3)
    const hiddenHighlighted = formatted
      .slice(3)
      .filter((_, i) => isBold[i + 3])
    if (hiddenHighlighted.length > 0) {
      return `${visible.join(', ')}, ...${hiddenHighlighted.join(', ')}, et al.`
    }
    return `${visible.join(', ')}, et al.`
  }

  return joinForStyle(formatted, style)
}

// ─────────────────────────────────────────────────────────── citation ──

const DOI_BASE = 'https://doi.org/'

function buildCitation(
  pub: Publication,
  style: CitationStyle,
  boldNames: readonly string[],
  html: boolean,
): string {
  const authorStr = formatAuthorList(pub, style, boldNames, html)

  const rawTitle = (pub.title ?? '').trim()
  const title = html ? escapeHtml(rawTitle) : rawTitle

  const rawJournal = (pub.journal ?? '').trim()
  const journal =
    rawJournal === ''
      ? ''
      : html
        ? `<em>${escapeHtml(rawJournal)}</em>`
        : rawJournal

  const year =
    typeof pub.year === 'number' && pub.year > 0 ? String(pub.year) : ''
  const yearBold = html ? `<b>${year}</b>` : year

  const doi = (pub.doi ?? '').trim()
  const doiPart =
    doi === ''
      ? ''
      : html
        ? `doi: <a href="${escapeUrl(DOI_BASE + doi)}" target="_blank">${escapeHtml(doi)}</a>`
        : `doi: ${doi}`

  let parts: string[]
  switch (style) {
    case 'apa':
      // Authors (Year). Title. Journal. doi: …
      parts = [
        authorStr,
        year && `(${year}).`,
        title && `${title}.`,
        journal && `${journal}.`,
        doiPart,
      ]
      break
    case 'harvard':
      // Authors (Year) 'Title', Journal. doi: …
      parts = [
        authorStr,
        year && `(${year})`,
        title && `'${title}',`,
        journal && `${journal}.`,
        doiPart,
      ]
      break
    case 'chicago':
      // Authors. "Title." Journal (Year). doi: …
      parts = [
        authorStr && `${authorStr}.`,
        title && `"${title}."`,
        journal,
        year && `(${year}).`,
        doiPart,
      ]
      break
    case 'nature':
      // Authors. Title. Journal **Year**. doi: …
      parts = [
        authorStr && `${authorStr}.`,
        title && `${title}.`,
        journal,
        year && `${yearBold}.`,
        doiPart,
      ]
      break
    case 'vancouver':
    default:
      // Authors. Title. Journal. Year. doi: …
      parts = [
        authorStr && `${authorStr}.`,
        title && `${title}.`,
        journal && `${journal}.`,
        year && `${year}.`,
        doiPart,
      ]
      break
  }

  return parts.filter((p) => p !== '').join(' ')
}

/**
 * One citation as an HTML fragment.
 *
 * All upstream text is escaped. The only markup this emits is `<b>` (bolded
 * author, bolded year in Nature), `<em>` (journal) and one `<a>` to doi.org.
 */
export function formatCitation(
  pub: Publication,
  style: CitationStyle,
  boldNames: readonly string[] = [],
): string {
  return buildCitation(pub, style, boldNames, true)
}

/**
 * The same citation with no markup, for the plain-text clipboard flavour and
 * for Markdown.
 *
 * Built directly rather than by stripping tags off the HTML (which is what R
 * and the older TS formatter did): stripping leaves entities like `&amp;`
 * behind in what is supposed to be plain text.
 */
export function formatCitationPlain(
  pub: Publication,
  style: CitationStyle,
  boldNames: readonly string[] = [],
): string {
  return buildCitation(pub, style, boldNames, false)
}
