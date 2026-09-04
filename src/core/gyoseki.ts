/**
 * 業績集 (gyoseki) classification: which of the ten `GyosekiCategory` sections
 * a record files under, plus the manual `categoryPins` overrides.
 *
 * Framework-free, like everything under `src/core`. Runs after `categorizeAll`
 * (it reads `Publication.category` for letters/editorials) and never mutates
 * its input.
 *
 * Decision tree, applied in this exact order:
 *
 * 1. kind 'award' → `award`.
 * 2. kind 'book': normalize `bookRole` (trim, NFKC, lowercase). Contains any of
 *    `分担`, `部分`, `一部`, `contributor`, `part` → `book-chapter`. Live
 *    researchmap role tokens observed: `single_work`(単著), `joint_work`(共著),
 *    `joint_translation`(共訳), `contributor`(分担執筆), `others`, absent — of
 *    these only `contributor` is a chapter role. Else → `book-lead`.
 *    Exception: role absent AND `bookRange` looks like a page/chapter range
 *    (regex over `pp?\.?\s*\d`, `章`, `頁`) → `book-chapter`.
 * 3. kind 'presentation', in this exact order:
 *    ① `pub.language === 'ja'` → `domestic-presentation`
 *    ② `language === 'en'` → `intl-presentation`
 *    ③ `hasJapaneseCharacters(eventJa ?? event ?? '')` → domestic
 *    ④ event present, no CJK in it, and title has no CJK → intl
 *    ⑤ default → domestic (conservative).
 *    `invited` / `presentationType` never change the bucket.
 * 4. kind paper (or absent): `isJa = pub.language === 'ja'`.
 *    - `fromMisc`: `miscType` or journal or title contains 報告/座談会/
 *      `report`/`meeting_report` AND isJa → `ja-report`; else isJa →
 *      `ja-review`; else → `en-review`.
 *    - `pub.category` (already set by `categorizeAll`) 'letter' or 'editorial'
 *      → isJa ? `ja-review` : `en-review`. This outranks the SR/MA exception
 *      below: an actual letter *about* a meta-analysis is still a letter.
 *    - title matches `SRMA_TITLE_PATTERN` (systematic review / meta-analysis
 *      / network meta / scoping / umbrella review) → ORIGINAL side, whatever
 *      `openAlexType` or the journal name says. OpenAlex types SR/MA as
 *      `review`, conflating them with narrative reviews, but the 業績集
 *      convention (confirmed against the 東大精神神経科 sample) files SR/MA
 *      as 原著 — they report new analyses of data, reviews of the literature
 *      only in method.
 *    - `pub.openAlexType === 'review'` → review side.
 *    - journal name contains a `REVIEW_JOURNAL_TOKENS` token → review side.
 *    - everything else (incl. category 'preprint' and 'other') →
 *      isJa ? `ja-original` : `en-original`.
 */

import type { GyosekiCategory, Publication } from './types'
import { GYOSEKI_ORDER } from './types'
import { matchesIdRef, parseIdRef } from './ids'
import { hasJapaneseCharacters } from './sources/names'

/** `bookRole` substrings that mean "wrote a part, not the whole book". */
const BOOK_CHAPTER_ROLE_TOKENS = ['分担', '部分', '一部', 'contributor', 'part']

/** A `bookRange` that reads as pages or a chapter: `pp. 12`, `第3章`, `45頁`. */
const BOOK_RANGE_PATTERN = /pp?\.?\s*\d|章|頁/iu

/**
 * Journal-name tokens that file a paper on the review side.
 *
 * Matched with a plain case-insensitive `includes()`. That is a deliberate
 * tradeoff: `'review'` as a substring also hits journals like "Peer Review"
 * or "Systematic Reviews" whose *articles* may well be original research. A
 * word-boundary match would miss "Reviews" plurals and CJK has no boundaries
 * to match on, so the simple rule wins and `categoryPins` is the escape hatch
 * for the occasional wrong bucket.
 */
export const REVIEW_JOURNAL_TOKENS: readonly string[] = [
  'review',
  'reviews',
  'trends in',
  'current opinion',
  '総説',
  '解説',
]

/** `miscType` / journal / title substrings that mark a 報告書-type record. */
const REPORT_TOKENS = ['報告', '座談会', 'report', 'meeting_report']

/**
 * Titles that announce a systematic review, meta-analysis, network / scoping /
 * umbrella review.
 *
 * These file on the ORIGINAL side even when `openAlexType` says `review` or
 * the journal name carries a review token: OpenAlex's `review` type conflates
 * narrative reviews with SR/MA, and a 業績集 files SR/MA under 原著論文 —
 * they produce new quantitative results. Japanese phrasings (メタ解析 etc.)
 * are not matched yet; `categoryPins` covers those records.
 */
export const SRMA_TITLE_PATTERN =
  /systematic\s+review|meta-?analy(?:sis|ses|tic)|network\s+meta|scoping\s+review|umbrella\s+review/i

function normalizeRole(role: string | undefined): string {
  return (role ?? '').trim().normalize('NFKC').toLowerCase()
}

function categorizeBook(pub: Publication): GyosekiCategory {
  const role = normalizeRole(pub.bookRole)
  if (role !== '') {
    if (BOOK_CHAPTER_ROLE_TOKENS.some((t) => role.includes(t))) {
      return 'book-chapter'
    }
    return 'book-lead'
  }
  // No role at all: a page/chapter range is the one other signal researchmap
  // gives that the member wrote part of the book rather than the book.
  if (BOOK_RANGE_PATTERN.test(pub.bookRange ?? '')) return 'book-chapter'
  return 'book-lead'
}

function categorizePresentation(pub: Publication): GyosekiCategory {
  if (pub.language === 'ja') return 'domestic-presentation'
  if (pub.language === 'en') return 'intl-presentation'
  const eventName = pub.eventJa ?? pub.event ?? ''
  if (hasJapaneseCharacters(eventName)) return 'domestic-presentation'
  if (
    eventName !== '' &&
    !hasJapaneseCharacters(eventName) &&
    !hasJapaneseCharacters(pub.title ?? '')
  ) {
    return 'intl-presentation'
  }
  // Conservative default: a 業績集 that over-claims an international talk is
  // worse than one that under-claims it.
  return 'domestic-presentation'
}

function looksLikeReport(pub: Publication): boolean {
  const haystack = [pub.miscType ?? '', pub.journal ?? '', pub.title ?? '']
    .join(' ')
    .toLowerCase()
  return REPORT_TOKENS.some((t) => haystack.includes(t))
}

function isReviewJournal(journal: string | undefined): boolean {
  const j = (journal ?? '').toLowerCase()
  if (j === '') return false
  return REVIEW_JOURNAL_TOKENS.some((t) => j.includes(t))
}

function categorizePaper(pub: Publication): GyosekiCategory {
  const isJa = pub.language === 'ja'

  // A `misc` record is a review/report by construction — researchmap's misc
  // list is where 総説・解説・報告書 live — unless a paper twin absorbed it
  // (dedupe clears `fromMisc` in that case, see `dedupe.ts`).
  if (pub.fromMisc) {
    if (isJa && looksLikeReport(pub)) return 'ja-report'
    return isJa ? 'ja-review' : 'en-review'
  }

  // Deliberately above the SR/MA exception: an actual letter or editorial
  // *about* a meta-analysis is still a letter, and stays review-side.
  if (pub.category === 'letter' || pub.category === 'editorial') {
    return isJa ? 'ja-review' : 'en-review'
  }
  // The SR/MA exception: a title announcing a systematic review or
  // meta-analysis demotes both weaker review signals below (OpenAlex's
  // `review` type and the journal-name tokens) — see `SRMA_TITLE_PATTERN`.
  if (SRMA_TITLE_PATTERN.test(pub.title ?? '')) {
    return isJa ? 'ja-original' : 'en-original'
  }
  if ((pub.openAlexType ?? '').toLowerCase() === 'review') {
    return isJa ? 'ja-review' : 'en-review'
  }
  if (isReviewJournal(pub.journal)) {
    return isJa ? 'ja-review' : 'en-review'
  }

  return isJa ? 'ja-original' : 'en-original'
}

/** Which 業績集 section one record files under. See the module header. */
export function categorizeGyoseki(pub: Publication): GyosekiCategory {
  const kind = pub.kind ?? 'paper'
  if (kind === 'award') return 'award'
  if (kind === 'book') return categorizeBook(pub)
  if (kind === 'presentation') return categorizePresentation(pub)
  return categorizePaper(pub)
}

export interface ApplyCategoryPinsResult {
  publications: Publication[]
  warnings: string[]
}

/**
 * Apply the manual `categoryPins` overrides (`<ref>=<category>`).
 *
 * Entries arrive pre-canonicalized by `normalizeCategoryPins` (config.ts), but
 * both halves are still validated here — a pin handed in un-normalized must
 * un-pin, never mis-pin. The split is on the **last** `=` because a DOI may
 * itself contain one. A pin that matches no record on the list gets a warning:
 * a silent no-op pin is indistinguishable from a working one.
 *
 * Immutable: matched records are replaced by copies, the rest pass through.
 */
export function applyCategoryPins(
  pubs: Publication[],
  pins: string[] | undefined,
): ApplyCategoryPinsResult {
  const warnings: string[] = []
  if (!pins || pins.length === 0) return { publications: pubs, warnings }

  let publications = pubs
  for (const entry of pins) {
    const separator = entry.lastIndexOf('=')
    if (separator <= 0) continue
    const ref = parseIdRef(entry.slice(0, separator))
    if (ref == null) continue
    const category = entry.slice(separator + 1).trim().toLowerCase()
    if (!(GYOSEKI_ORDER as readonly string[]).includes(category)) continue

    let matched = false
    publications = publications.map((pub) => {
      if (!matchesIdRef(pub, ref)) return pub
      matched = true
      return { ...pub, gyosekiCategory: category as GyosekiCategory }
    })
    if (!matched) {
      warnings.push(`Category pin "${entry}" matched no record.`)
    }
  }

  return { publications, warnings }
}
