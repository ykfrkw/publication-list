/**
 * Publication type categorization.
 *
 * Full port of `publication-list-generator/R/categorize.R:5-71`. Framework-free
 * and side-effect-free: the wizard and the embed bundle both call this.
 *
 * Where the R version and the older TS `categorizeWork`
 * (`orcid-publication-list/src/types/index.ts:72-106`) disagree, R wins:
 *
 *  - `erratum` / `paratext` → R returns `"exclude"`, the old TS returned
 *    `'other'`. Errata are not publications of the author in any meaningful
 *    sense and used to pad the list; they are dropped (and counted) instead.
 *  - `scientific_journal` (researchmap's type string) → `original`. The old TS
 *    predates the researchmap source and never handled it.
 */

import type { Publication, PublicationCategory } from './types'
import { isOpenReviewJournal } from './sources/crossref'

/**
 * The open-review journal list and its matcher live in `sources/crossref.ts`
 * — the module that performs the Crossref peer-review lookup owns the list it
 * filters on — and are re-exported here so callers of the categorizer do not
 * need to know that. Single source of truth: do not redeclare the literal.
 */
export { OPEN_REVIEW_JOURNALS, isOpenReviewJournal } from './sources/crossref'

/**
 * Journal / venue names that identify a preprint server.
 *
 * Matched as a case-insensitive substring of the journal name, exactly like
 * `str_detect(j, fixed(s))` in `R/categorize.R:19`.
 */
export const PREPRINT_SERVERS: readonly string[] = [
  'medrxiv',
  'biorxiv',
  'arxiv',
  'ssrn',
  'chemrxiv',
  'psyarxiv',
  'preprints.org',
  'research square',
  'authorea',
]

/** Port of `is_preprint_server` (`R/categorize.R:16-20`). */
export function isPreprintServer(journal: string | undefined): boolean {
  const j = (journal ?? '').toLowerCase()
  if (j === '') return false
  return PREPRINT_SERVERS.some((s) => j.includes(s))
}

/** `categorizePublication` can also reject a record outright. */
export type CategorizeOutcome = PublicationCategory | 'exclude'

const ORCID_ORIGINAL_TYPES = ['journal-article', 'review', 'scientific_journal']

const ORCID_OTHER_TOKENS = [
  'book',
  'chapter',
  'conference',
  'abstract',
  'report',
  'dissertation',
  'working-paper',
  'other',
]

/**
 * Port of `categorize_pub` (`R/categorize.R:29-61`), precedence preserved:
 *
 *  1. preprint server journal, or ORCID type `preprint` outside an
 *     open-review journal
 *  2. open-review journal → approved ? original : preprint
 *  3. OpenAlex work type (authoritative when present)
 *  4. ORCID / researchmap type
 *  5. default `original`
 */
export function categorizePublication(pub: Publication): CategorizeOutcome {
  const journal = pub.journal ?? ''
  const oaType = (pub.openAlexType ?? '').toLowerCase()
  const orcidType = (pub.orcidType ?? '').toLowerCase()

  // 1. Preprint servers, regardless of any other type signal.
  if (isPreprintServer(journal)) return 'preprint'
  if (orcidType === 'preprint' && !isOpenReviewJournal(journal)) {
    return 'preprint'
  }

  // 2. Open peer-review journals.
  if (isOpenReviewJournal(journal)) {
    return pub.peerReviewApproved === true ? 'original' : 'preprint'
  }

  // 3. OpenAlex type. An unrecognized value falls through to step 4.
  if (oaType !== '') {
    if (oaType === 'letter') return 'letter'
    if (oaType === 'editorial') return 'editorial'
    if (oaType === 'article' || oaType === 'review') return 'original'
    if (oaType === 'preprint') return 'preprint'
    if (oaType === 'erratum' || oaType === 'paratext') return 'exclude'
  }

  // 4. Fallback to the ORCID / researchmap type.
  if (ORCID_ORIGINAL_TYPES.includes(orcidType)) return 'original'
  if (orcidType.includes('letter')) return 'letter'
  if (orcidType.includes('editorial') || orcidType.includes('comment')) {
    return 'editorial'
  }
  if (ORCID_OTHER_TOKENS.some((t) => orcidType.includes(t))) return 'other'

  // 5. Default.
  return 'original'
}

export interface CategorizeAllResult {
  /** categorized records, `category` always set */
  publications: Publication[]
  /**
   * records categorized as `exclude` (errata, paratext). Returned rather than
   * dropped so the caller can report "3 errata excluded" instead of silently
   * losing rows. Their `category` is left untouched.
   */
  excluded: Publication[]
}

/**
 * Categorize every record and split out the excluded ones.
 *
 * Non-mutating: the input array and its members are left untouched.
 */
export function categorizeAll(pubs: Publication[]): CategorizeAllResult {
  const publications: Publication[] = []
  const excluded: Publication[] = []

  for (const pub of pubs) {
    const outcome = categorizePublication(pub)
    if (outcome === 'exclude') {
      excluded.push({ ...pub })
    } else {
      publications.push({ ...pub, category: outcome })
    }
  }

  return { publications, excluded }
}
