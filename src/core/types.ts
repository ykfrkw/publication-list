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

/**
 * A heading level the list may be rendered at.
 *
 * Bounded at both ends on purpose. `1` is out because a page has one `<h1>` and
 * it is the page's own title — a list dropped into someone else's article must
 * not claim it. `6` is out because the year dividers sit one level below the
 * category headings, and a list starting at 6 would have nowhere to put them.
 */
export type HeadingLevel = 2 | 3 | 4 | 5

/**
 * What `ListConfig.headingLevel` may say: a fixed level, or `'auto'`.
 *
 * `'auto'` is a request to *measure* rather than a level, so it only means
 * anything where there is a host page to measure — `src/embed/entry.ts`, which
 * runs inside one. Everywhere else it resolves to `AUTO_HEADING_FALLBACK`.
 * See `headingLevelFor` in `core/config.ts`.
 */
export type HeadingLevelSetting = 'auto' | HeadingLevel

export type PublicationCategory =
  | 'original'
  | 'preprint'
  | 'letter'
  | 'editorial'
  | 'other'

export type SourceName = 'orcid' | 'pubmed' | 'researchmap' | 'manual'

/**
 * Where the author names on a record came from.
 *
 * Wider than `SourceName` because the enrichment stages write author names too,
 * and the point of the field is to rank *name quality*, not to record which seed
 * found the work (that is `Publication.sources`).
 */
export type AuthorNameSource = SourceName | 'openalex' | 'crossref'

/** confirmed = auto-included; candidate = needs review */
export type Trust = 'confirmed' | 'candidate'

export interface Publication {
  /** stable dedupe key: "doi:<normalized>" || "pmid:<id>" || "title:<slug>" */
  key: string
  title: string
  /** short form, e.g. "Furukawa Y" */
  authors: string[]
  /**
   * Full form when available, e.g. "Yuki Furukawa".
   *
   * Only genuinely full names belong here (see `isFullPersonName`). A short
   * form parked in this array reads as "we already have the full names" to
   * `openalex.ts`, `crossref.ts` and the bold-name repair in `pipeline.ts`, all
   * of which then decline to fetch the real ones.
   */
  authorsFull: string[]
  /**
   * Provenance of `authors` / `authorsFull`, so enrichment can tell an upgrade
   * from an overwrite. `undefined` means "unknown, treat as authoritative".
   *
   * researchmap-derived names rank *below* everything else: its `authors.en`
   * order varies per account, and it stores short forms in a field that reads
   * like a full-name field.
   */
  authorsSource?: AuthorNameSource
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

/**
 * A seed bounded by the period its owner was part of the group.
 *
 * Only ever needed by a group whose membership changes: a seed left in place
 * after a student graduates keeps adding the papers they publish elsewhere to
 * their old group's page. See `src/core/seeds.ts` for the full reasoning, the
 * grace period and the seed-level (not publication-level) filtering rule.
 */
export interface SeedWindow {
  /** ORCID iD, researchmap permalink, or a PubMed seed's `label ?? query` */
  id: string
  /** "YYYY-MM" or "YYYY". Absent = open start. */
  from?: string
  /** "YYYY-MM" or "YYYY". Absent = still active, no end. */
  to?: string
  /**
   * Months after `to` in which a paper still counts as this group's output.
   * Defaults to `DEFAULT_SEED_GRACE_MONTHS` (24); `0` makes `to` hard.
   */
  grace?: number
}

/**
 * A seed identifier, optionally time-bounded.
 *
 * **A bare string behaves exactly as it always has** — no window, no filtering.
 * Every configuration written before `SeedWindow` existed keeps its meaning,
 * which is why the union exists rather than a required object form.
 */
export type Seed = string | SeedWindow

export interface PubmedSeed {
  /** e.g. "0000-0003-1317-0220[auid]", "Furukawa Y[au] AND (Tokyo[ad])" */
  query: string
  label?: string
  /**
   * Whether this query's hits are published without review.
   *
   * **Defaults to `'candidate'`**, which is what every PubMed query that is not
   * an `[auid]` search has always been: its records go to the wizard's review
   * queue and reach no page until someone confirms them. `'confirmed'` is an
   * explicit assertion by the person who wrote the query — *I have run this
   * search and it returns my group's work and nobody else's* — and it puts
   * every hit, including hits the query has not made yet, straight onto the
   * published list and into an embed with no review step.
   *
   * It is deliberately not inferred from the query text. `[auid]` is promoted
   * automatically (`pipeline.ts` stage 2) because an ORCID iD is a globally
   * unique identifier; every other field is a *name*. A collective-author
   * search — `"SLEEPI"[cn]` — looks identical in shape and is not: two groups
   * can share an acronym, and a free-text `SLEEPI` search on PubMed already
   * returns an unrelated SLEEP-I trial. So the trust is asserted, never
   * guessed.
   *
   * A record from a trusted seed is still removable: `config.exclude` outranks
   * everything, including this (`pipeline.ts` stage 3).
   */
  trust?: Trust
  /**
   * Same time window as `SeedWindow`, flattened onto the seed this source
   * already spells as an object. The seed id a window is matched against is
   * `label ?? query`.
   *
   * These three fields, like `label`, travel in a `lists/*.json` registry file
   * only: `data-pubmed` and `?pubmed=` carry the query string alone, and
   * reading part of somebody's search syntax as a date range would be a guess.
   * `restore.ts` names them as losses rather than dropping them silently.
   *
   * `trust` is the exception and does travel on both inline transports, beside
   * the query rather than inside it — `data-pubmed-trusted` / `?pubmed-trusted=`,
   * the zero-based positions of the trusted queries within `data-pubmed`.
   */
  from?: string
  to?: string
  grace?: number
}

export interface ListConfig {
  v: 1
  seeds: {
    orcid?: Seed[]
    researchmap?: Seed[]
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
  /**
   * How the list is divided into sections. Defaults to `'category-year'`: a
   * heading per publication type, and inside each one a divider per publication
   * year, newest first.
   *
   * `'category'` gives the publication-type headings alone, `'year'` the year
   * headings alone, and `'none'` one flat numbered list — which is what an
   * article's reference list wants, since there the numbers are what the prose
   * cites.
   */
  groupBy?: 'category-year' | 'category' | 'year' | 'none'
  /**
   * The heading level the group headings are rendered at; the year dividers go
   * one level below it. Defaults to `'auto'` — see `headingLevelFor` in
   * `core/config.ts` for the one case where that default is not `'auto'`.
   *
   * It exists because the list is pasted into a document that already has an
   * outline. A lab page whose section headings are `<h2>` gets a list of `<h3>`
   * sections; one whose sidebar heading is `<h4>` gets `<h5>`. Nothing else
   * about the markup changes.
   */
  headingLevel?: HeadingLevelSetting
  /**
   * Whether the rendered list carries the one-line note saying it was assembled
   * automatically and inherits whatever its sources got wrong. Defaults to
   * `'show'`.
   *
   * Independent of the credit link in every direction: the credit is a courtesy
   * the site owner may drop, this is a statement about how the list was built,
   * and neither switch touches the other.
   */
  disclaimer?: 'show' | 'hide'
  /**
   * Whether records categorized `preprint` reach the list. Defaults to
   * `'exclude'`: a publication list is normally a list of published work, and a
   * not-yet-peer-reviewed manuscript sitting unlabelled among journal articles
   * misrepresents it.
   *
   * The exclusion is applied in `pipeline.ts`, not in the renderer, so
   * `ListModel.publications` is exactly what gets displayed, and it is always
   * reported in `ListModel.warnings` — a preprint that vanished without a word
   * from its own author's page would be a bug they could not see.
   *
   * Note this also hides an F1000-family article whose referees have not
   * approved it yet: `categorize.ts` files those as `preprint`.
   */
  preprints?: 'include' | 'exclude'
  /** how to treat Japanese-language journals coming from researchmap */
  japanese?: 'separate' | 'merge' | 'hide'
  reviewPolicy?: 'strict' | 'auto'
  limit?: number
}

/**
 * How many records each filtering stage took off the list.
 *
 * Every one of these stages already explains itself in `warnings` when it drops
 * something, in prose aimed at a reader who is looking at a list. This is the
 * same information as a count, for the one question the prose cannot answer on
 * its own: *why is the list empty?* Naming the responsible filter is the
 * difference between "nothing came back" and "your `from` year is 2030", and
 * the two need opposite fixes.
 *
 * Written by `pipeline.ts` and read by the wizard. The embed ignores it.
 * Optional because a `ListModel` restored from a cache written before it
 * existed will not have one; treat an absent value as "unknown", not as zero.
 */
export interface DroppedCounts {
  /** named in `exclude` (stage 3) — includes records an exclude un-pinned */
  excluded: number
  /** ruled out by a seed's time window (stage 5c) */
  window: number
  /** categorized as an erratum or as paratext (stage 6) */
  erratum: number
  /** held back because `preprints` is `'exclude'` (stage 6b) */
  preprint: number
  /** outside `from` / `to` (stage 7) */
  dateRange: number
  /** beyond `limit` (stage 8) */
  limit: number
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
  /** What each filtering stage removed. See `DroppedCounts`. */
  dropped?: DroppedCounts
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
