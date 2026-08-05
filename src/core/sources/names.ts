/**
 * Author-name formatting shared by the enrichment sources.
 *
 * Ported from `publication-list-generator/R/enrich_openalex.R`:
 * `format_author_short()` (given-first, the Western convention) and
 * `format_author_family_first()` (family-first, added by R commit 9eb5e68 for
 * researchmap, whose `authors.en` lists Japanese names family-first).
 */

/** Surname particles that stay lowercase and belong to the family name. */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'di', 'la', 'le', 'el', 'al',
  'den', 'der', 'das', 'dos', 'du', 'ten',
])

/** Capitalize a word, including after hyphens: `fares-otero` → `Fares-Otero`. */
export function capitalizeWord(word: string): string {
  const lower = word.toLowerCase()
  if (PARTICLES.has(lower)) return lower
  return lower
    .split('-')
    .map((part) => (part === '' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-')
}

/**
 * Is this token an initial rather than a full word?
 * A single letter, a letter with a period, or 2–3 capitals (`DD`, `NE`).
 */
function isInitialToken(token: string): boolean {
  const stripped = token.replace(/\.$/, '')
  return stripped.length <= 1 || (stripped.length <= 3 && /^[A-Z]+$/.test(stripped))
}

/** Names already in short form (`Furukawa Y`) are only re-capitalized. */
function keepShortForm(parts: string[]): string | undefined {
  const flags = parts.map(isInitialToken)
  const fullWords = flags.filter((f) => !f).length
  const initials = flags.filter((f) => f).length
  if (fullWords !== 1 || initials < 1) return undefined
  return parts
    .map((part, i) => (flags[i] ? part.replace(/\.$/, '').toUpperCase() : capitalizeWord(part)))
    .join(' ')
}

function splitName(displayName: string): string[] {
  return displayName.trim().split(/\s+/).filter((p) => p !== '')
}

/**
 * Given-name-first input → `Family I`.
 *
 * `Yuki Furukawa` → `Furukawa Y`; `Annemieke van Straten` → `van Straten A`.
 * Input already in short form is passed through with tidied capitalization.
 */
export function formatAuthorShort(displayName: string): string {
  if (!displayName) return ''
  const raw = splitName(displayName)
  if (raw.length === 0) return ''
  if (raw.length === 1) return capitalizeWord(raw[0])

  const short = keepShortForm(raw)
  if (short !== undefined) return short

  const parts = raw.map(capitalizeWord)

  // Where does the surname start? A particle in the middle pulls it earlier.
  let surnameStart = parts.length - 1
  for (let k = 0; k < parts.length; k++) {
    if (PARTICLES.has(parts[k].toLowerCase()) && k > 0 && k < parts.length - 1) {
      surnameStart = k
      break
    }
  }

  const family = parts.slice(surnameStart).join(' ')
  const initials = parts
    .slice(0, surnameStart)
    .map((p) => p.charAt(0))
    .join('')
  return `${family} ${initials}`
}

/**
 * Family-name-first input → `Family I`.
 *
 * `Kikuchi Sou` → `Kikuchi S`. researchmap stores Japanese authors this way
 * even in its `en` field, so applying `formatAuthorShort` there would produce
 * `Sou K`. Port of R commit 9eb5e68.
 */
export function formatAuthorFamilyFirst(displayName: string): string {
  if (!displayName) return ''
  const raw = splitName(displayName)
  if (raw.length === 0) return ''
  if (raw.length === 1) return capitalizeWord(raw[0])

  const short = keepShortForm(raw)
  if (short !== undefined) return short

  const parts = raw.map(capitalizeWord)
  const family = parts[0]
  const initials = parts
    .slice(1)
    .map((p) => p.charAt(0))
    .join('')
  return `${family} ${initials}`
}

/** True when the string contains kana or CJK ideographs. */
const JAPANESE_CHARS = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/

export function hasJapaneseCharacters(s: string): boolean {
  return JAPANESE_CHARS.test(s)
}

/**
 * Normalize an ORCID `given`/`family` pair. ORCID often stores them shouting
 * (`YUKI FURUKAWA`), which would otherwise leak straight into a citation.
 */
export function tidyPersonName(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return ''
  if (hasJapaneseCharacters(trimmed)) return trimmed
  if (trimmed !== trimmed.toUpperCase()) return trimmed
  return trimmed.split(' ').map(capitalizeWord).join(' ')
}
