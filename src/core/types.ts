/**
 * Shared contract between the React wizard (`src/app`) and the framework-free
 * embed bundle (`src/embed`).
 *
 * Nothing in `src/core/**` may import React, Tailwind or any framework. Plain
 * DOM APIs are allowed only inside `parseConfigFromDataset` (see `config.ts`).
 */

export type CitationStyle =
  | 'vancouver'
  | 'apa'
  | 'harvard'
  | 'chicago'
  | 'nature'

export type PublicationCategory =
  | 'original'
  | 'preprint'
  | 'letter'
  | 'editorial'
  | 'other'

export type SourceName = 'orcid' | 'pubmed' | 'researchmap' | 'manual'

/** confirmed = auto-included; candidate = needs review */
export type Trust = 'confirmed' | 'candidate'

export interface Publication {
  /** stable dedupe key: "doi:<normalized>" || "pmid:<id>" || "title:<slug>" */
  key: string
  title: string
  /** short form, e.g. "Furukawa Y" */
  authors: string[]
  /** full form when available, e.g. "Yuki Furukawa" */
  authorsFull: string[]
  journal: string
  year: number
  month?: number
  /** normalized, lowercase, no https://doi.org/ prefix */
  doi?: string
  /** trailing ".N" stripped from versioned DOIs (F1000 etc.) */
  doiVersion?: number
  pmid?: string
  language?: 'en' | 'ja' | string
  /**
   * Raw affiliation strings, when a source supplies them.
   *
   * Nothing populates this yet — none of the five upstream endpoints this
   * project calls returns affiliations in the responses it already fetches.
   * It exists because the candidate triage in `pipeline.ts` pre-selects a
   * candidate that shares an affiliation token with the confirmed set, and
   * that rule needs somewhere to read from the day a source does supply them.
   */
  affiliations?: string[]
  orcidType?: string
  openAlexType?: string
  peerReviewApproved?: boolean
  sources: SourceName[]
  /** which seed(s) produced this */
  seedIds: string[]
  trust: Trust
  category?: PublicationCategory
}

export interface Member {
  id: string
  name?: string
  orcid?: string
  researchmap?: string
}

export interface PubmedSeed {
  /** e.g. "0000-0003-1317-0220[auid]", "Furukawa Y[au] AND (Tokyo[ad])" */
  query: string
  label?: string
}

export interface ListConfig {
  v: 1
  seeds: {
    orcid?: string[]
    researchmap?: string[]
    pubmed?: PubmedSeed[]
  }
  /** "pmid:12345678" / "doi:10.1136/bmj.n71" */
  include?: string[]
  /** "pmid:12345678" / "doi:10.1136/bmj.n71" */
  exclude?: string[]
  boldNames?: string[]
  style?: CitationStyle
  /** "YYYY-MM" */
  from?: string
  /** "YYYY-MM" */
  to?: string
  groupBy?: 'category' | 'year' | 'none'
  /** how to treat Japanese-language journals coming from researchmap */
  japanese?: 'separate' | 'merge' | 'hide'
  reviewPolicy?: 'strict' | 'auto'
  limit?: number
}

export interface ListModel {
  config: ListConfig
  members: Member[]
  /** trust === 'confirmed' only */
  publications: Publication[]
  /** trust === 'candidate', for the review queue */
  candidates: Publication[]
  /**
   * `Publication.key` of the candidates the pipeline pre-selected in the review
   * queue (shared co-author or affiliation with the confirmed set). An array
   * rather than a `Set` so a `ListModel` survives a JSON round trip through
   * `cache.ts`.
   */
  suggested?: string[]
  warnings: string[]
  /** ISO date */
  generatedAt: string
}

export const CITATION_STYLES: { value: CitationStyle; label: string }[] = [
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'apa', label: 'APA 7th' },
  { value: 'harvard', label: 'Harvard' },
  { value: 'chicago', label: 'Chicago' },
  { value: 'nature', label: 'Nature' },
]

export const CATEGORY_LABELS: Record<PublicationCategory, string> = {
  original: 'Original Articles & Reviews',
  preprint: 'Preprints',
  letter: 'Letters',
  editorial: 'Editorials',
  other: 'Other Publication Types',
}

export const CATEGORY_ORDER: PublicationCategory[] = [
  'original',
  'preprint',
  'letter',
  'editorial',
  'other',
]
