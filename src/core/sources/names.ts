/**
 * Author-name formatting shared by the enrichment sources.
 *
 * Ported from `publication-list-generator/R/enrich_openalex.R`:
 * `format_author_short()` (given-first, the Western convention) and
 * `format_author_family_first()` (family-first, added by R commit 9eb5e68 for
 * researchmap).
 *
 * **Neither formatter can be applied blind.** `Yuki Furukawa` is `Furukawa Y`
 * under one and `Yuki F` under the other, and nothing in the string itself says
 * which is meant. R commit 9eb5e68 assumed researchmap always writes
 * family-first even in `authors.en`; measured against the live API on
 * 2026-08-05 that is false — `yk_frkw` stores given-first, `7000024045` stores
 * family-first, and one account (`nakayama`) mixes both inside a single list.
 *
 * So the order is *detected*, not assumed: see `detectNameOrder`, which matches
 * the seed member's independently known given/family split against the list.
 * When detection fails, callers keep the raw string rather than guess.
 */

/** Surname particles that stay lowercase and belong to the family name. */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'di', 'la', 'le', 'el', 'al',
  'den', 'der', 'das', 'dos', 'du', 'ten',
])

/**
 * Capitalize a word, including after hyphens: `fares-otero` → `Fares-Otero`.
 *
 * The split covers Unicode dashes as well as ASCII `-`. OpenAlex returns
 * `Schneider‐Thoma` with U+2010, and splitting on ASCII alone lowercased the
 * whole thing to `Schneider‐thoma`.
 */
const HYPHENS = /[-\u2010-\u2015]/

export function capitalizeWord(word: string): string {
  const lower = word.toLowerCase()
  if (PARTICLES.has(lower)) return lower
  let out = ''
  let atWordStart = true
  for (const ch of lower) {
    out += atWordStart ? ch.toUpperCase() : ch
    atWordStart = HYPHENS.test(ch)
  }
  return out
}

/**
 * Is this token an initial rather than a full word?
 * A single letter, a letter with a period, or 2–3 capitals (`DD`, `NE`).
 */
function isInitialToken(token: string): boolean {
  const stripped = token.replace(/\.$/, '')
  return stripped.length <= 1 || (stripped.length <= 3 && /^[A-Z]+$/.test(stripped))
}

/**
 * Names already in short form are re-emitted as `Family I`.
 *
 * A short form is one family word plus at least one group of initials, in
 * either order — `Furukawa Y` and `T. Takayama` are the same name written two
 * ways, and both come out `Furukawa Y` / `Takayama T`. Rebuilding rather than
 * merely re-capitalizing is what makes an OpenAlex `K. Koba` line up with the
 * `Koba K` next to it in the same citation.
 *
 * Particles do not count towards the "exactly one family word" test: they
 * belong to the family name, so `van Dalfsen JH` is a short form with one
 * family word (`Dalfsen`) and one initial group (`JH`). Counting `van` as a
 * word of its own pushed this name out of the short-form path entirely and both
 * formatters then mangled it — `van DJ` (family-first) or `Jh vD` (given-first).
 */
function keepShortForm(parts: string[]): string | undefined {
  const flags = parts.map(isInitialToken)
  const words = parts.filter((_, i) => !flags[i])
  const familyWords = words.filter((part) => !PARTICLES.has(part.toLowerCase()))
  const initials = parts.filter((_, i) => flags[i])
  if (familyWords.length !== 1 || initials.length === 0) return undefined

  // `words` keeps any particle in front of the family name it belongs to.
  const family = words.map(capitalizeWord).join(' ')
  const suffix = initials.map((part) => part.replace(/\.$/, '').toUpperCase()).join('')
  return `${family} ${suffix}`
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
 * `Kikuchi Sou` → `Kikuchi S`. Port of R commit 9eb5e68. Some researchmap
 * accounts do write their `authors.en` this way (`Osaka Ken'ichi`), and for
 * those `formatAuthorShort` would produce `Sou K`.
 *
 * Only call this when the order has actually been established — by
 * `detectNameOrder`, or because the caller knows the field's convention.
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

// ────────────────────────────────────────────────────────── name order ──

/**
 * Is this a FULL name rather than an abbreviated one?
 *
 * "Full" means at least one component beyond the family name is a word rather
 * than an initial, periods ignored. `Yuki Furukawa` and `Natalia E. Fares-Otero`
 * are full; `Furukawa Y`, `Schneider CL`, `van Dalfsen JH` and `Osaka, K.` are
 * not. Particles are part of the family name and never count as that component.
 *
 * This is the predicate that keeps short forms out of `Publication.authorsFull`.
 * A short form parked there looks populated to every downstream consumer —
 * `openalex.ts` stops filling it, `crossref.ts` stops repairing it, and
 * `format.ts` then decides which author to bold from `Türkmen C`, which cannot
 * tell one Türkmen from another.
 *
 * A name written in kana or CJK is always "full": it carries no initials and
 * abbreviating it would be wrong anyway (田口 良子 → 田口 良).
 */
export function isFullPersonName(displayName: string): boolean {
  if (!displayName) return false
  if (hasJapaneseCharacters(displayName)) return true
  const parts = splitName(displayName)
  if (parts.length < 2) return false
  const words = parts.filter(
    (part) => !isInitialToken(part) && !PARTICLES.has(part.toLowerCase()),
  )
  return words.length >= 2
}

/**
 * A person whose given and family names are known *separately*.
 *
 * ORCID `/person` returns `given-names` and `family-name` as distinct fields,
 * and so does a researchmap profile — which is the only reason the order of a
 * researchmap author list can be measured rather than assumed.
 */
export interface PersonNameAnchor {
  given: string
  family: string
}

export type NameOrder = 'given-first' | 'family-first'

/** Lowercase ASCII letters only: `Ken'ichi` → `kenichi`, `Türkmen` → `turkmen`. */
function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
}

/** Does the segment next to the family name look like this person's given name? */
function matchesGiven(rawRest: string[], normRest: string[], given: string): boolean {
  if (given === '' || normRest.length === 0) return false
  const first = normRest[0]
  if (first === '') return false
  if (first === given) return true
  // "Furukawa Y", "Furukawa TA": an initial group starting with the right letter.
  return isInitialToken(rawRest[0]) && first.charAt(0) === given.charAt(0)
}

/**
 * Which order is this single name written in, judged against one anchor?
 *
 * `undefined` when the name is not the anchor person, or when both readings fit
 * (someone whose given and family names are the same word).
 */
export function detectNameOrderFor(
  displayName: string,
  anchor: PersonNameAnchor,
): NameOrder | undefined {
  const family = splitName(anchor.family).map(normalizeToken).filter((t) => t !== '')
  const given = (splitName(anchor.given).map(normalizeToken).filter((t) => t !== ''))[0] ?? ''
  if (family.length === 0 || given === '') return undefined

  const raw = splitName(displayName)
  const norm = raw.map(normalizeToken)
  const k = family.length
  if (raw.length <= k) return undefined

  const familyKey = family.join(' ')
  const head = norm.slice(0, k).join(' ')
  const tail = norm.slice(raw.length - k).join(' ')

  const familyFirst =
    head === familyKey && matchesGiven(raw.slice(k), norm.slice(k), given)
  const givenFirst =
    tail === familyKey &&
    matchesGiven(raw.slice(0, raw.length - k), norm.slice(0, raw.length - k), given)

  if (familyFirst === givenFirst) return undefined
  return familyFirst ? 'family-first' : 'given-first'
}

/**
 * Which order is a whole author list written in?
 *
 * The signal is the seed member's own name: they appear in their own author
 * lists, and their given/family split is known independently from ORCID or a
 * researchmap profile. Everything else about a name — script, token count, even
 * whether it "looks Japanese" — is a guess, and a guess here silently rewrites
 * every co-author on the page.
 *
 * Only FULL-form matches vote. A short form is written `Family I` under both
 * conventions, so `Furukawa Y` proves nothing about how the full names sitting
 * next to it in the same list are ordered.
 *
 * Returns `undefined` when the anchor person does not appear in full form, or
 * when two matches disagree. Callers must not guess in that case.
 */
export function detectNameOrder(
  names: readonly string[],
  anchors: readonly PersonNameAnchor[],
): NameOrder | undefined {
  if (anchors.length === 0) return undefined
  let vote: NameOrder | undefined

  for (const name of names) {
    if (!isFullPersonName(name)) continue
    for (const anchor of anchors) {
      const order = detectNameOrderFor(name, anchor)
      if (!order) continue
      if (vote !== undefined && vote !== order) return undefined
      vote = order
    }
  }

  return vote
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
