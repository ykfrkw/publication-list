/**
 * Why is this list empty, and what will the embed actually show?
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * A group configured a PubMed seed that returned exactly the five papers they
 * wanted. Every one of those five was a `candidate`, because only an `[auid]`
 * query is trusted outright, and under the default `strict` policy a candidate
 * is not in `ListModel.publications`. So the built list was empty, the snippet
 * was an empty `<section class="publist">`, and the page it was pasted into
 * rendered nothing — permanently, because **reviewing happens in the wizard and
 * nowhere else**. An embed has no review queue and never will: there is no
 * person at the other end of a page load to confirm anything. A snippet whose
 * records are all unreviewed candidates is empty by construction, not by
 * accident, and no amount of waiting fixes it.
 *
 * Nothing upstream failed and nothing in the pipeline was wrong. What was
 * missing was anybody saying so.
 *
 * The empty case is the worst instance of a general one: an embed shows
 * `publications`, the wizard shows `publications` *and* a review queue, so the
 * embed is smaller than the preview whenever a candidate is outstanding. Both
 * are diagnosed here, as plain functions over a `ListModel`, so the wording is
 * testable without a DOM and the wizard panels only have to render it.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { DroppedCounts, ListModel } from '@/core/types'

/**
 * Why the list came out empty. The three cases need opposite fixes, which is
 * the whole reason they are distinguished rather than merged into one apology.
 */
export type EmptyCause =
  /** records were found, but they are all awaiting review */
  | 'candidates'
  /** records were found and a filter removed every one of them */
  | 'filtered'
  /** no source returned anything at all */
  | 'nothing'

export interface EmptyDiagnosis {
  cause: EmptyCause
  /** headline, already carrying the count that makes it specific */
  title: string
  /** what to do about it, in terms of controls that are on screen */
  body: string
  /**
   * For `'filtered'`: one phrase per filter that removed something, in the
   * order the pipeline applies them. Non-empty only for that cause, and
   * rendered as a list so no single filter can be mistaken for the only one.
   */
  filters: string[]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

/** `"2020"`, `"up to 2024-06"`, `"2020 to 2024-06"` — however much was set. */
function dateRangeLabel(from?: string, to?: string): string {
  if (from && to) return `${from} to ${to}`
  if (from) return `from ${from}`
  if (to) return `up to ${to}`
  return 'the date range'
}

/**
 * Name each filter that removed something.
 *
 * Every phrase points at the control that undoes it, because "3 removed by the
 * date range" is only actionable if the reader knows which box that is.
 */
export function describeDropped(
  dropped: DroppedCounts | undefined,
  config: ListModel['config'],
): string[] {
  if (dropped == null) return []
  const out: string[] = []
  if (dropped.excluded > 0) {
    out.push(
      `${dropped.excluded} in the exclude list — they are named under “${dropped.excluded} removed” below, each with an Undo`,
    )
  }
  if (dropped.window > 0) {
    out.push(
      `${dropped.window} by a member’s Joined / Left dates — widen the window, or pin the ${plural(dropped.window, 'paper')}`,
    )
  }
  if (dropped.erratum > 0) {
    out.push(
      `${dropped.erratum} categorised as an erratum or as paratext, which are never listed`,
    )
  }
  if (dropped.preprint > 0) {
    out.push(
      `${dropped.preprint} held back as ${plural(dropped.preprint, 'a preprint', 'preprints')} — tick “Include preprints” under Formatting and filters to show ${plural(dropped.preprint, 'it', 'them')}`,
    )
  }
  if (dropped.dateRange > 0) {
    out.push(
      `${dropped.dateRange} outside the date range you set (${dateRangeLabel(config.from, config.to)}) — clear the From / To fields to bring ${plural(dropped.dateRange, 'it', 'them')} back`,
    )
  }
  if (dropped.limit > 0) {
    out.push(`${dropped.limit} beyond the limit of ${config.limit}`)
  }
  return out
}

/**
 * Diagnose an empty list, or `null` when there is nothing wrong.
 *
 * Precedence is `candidates` → `filtered` → `nothing`, because that is the
 * order of how directly the remedy puts a record on the page: confirming a
 * candidate is one click and adds it, changing a filter is a setting, and a
 * seed that found nothing has to be re-entered. When a filter also removed
 * something the candidate message says so rather than hiding it.
 */
export function diagnoseEmptyList(model: ListModel): EmptyDiagnosis | null {
  if (model.publications.length > 0) return null

  const filters = describeDropped(model.dropped, model.config)
  const total = filters.length === 0 ? 0 : sum(model.dropped)
  const waiting = model.candidates.length

  if (waiting > 0) {
    const also =
      total > 0
        ? ` Separately, ${total} other ${plural(total, 'record')} ${plural(total, 'was', 'were')} removed by your settings: ${filters.join('; ')}.`
        : ''
    return {
      cause: 'candidates',
      title: `Your list is empty — ${waiting} ${plural(waiting, 'record')} ${plural(waiting, 'is', 'are')} waiting in the review queue`,
      body:
        `A PubMed author-name search is not trusted on its own, so everything one finds is held as a candidate. ` +
        `Confirming a candidate in the review queue above is what puts it on the list — until then it is on no list, ` +
        `and it can never appear in an embed, because reviewing happens here in the wizard and never on the embedded page.` +
        also,
      filters: [],
    }
  }

  if (total > 0) {
    return {
      cause: 'filtered',
      title: `Your list is empty — every record found was filtered out`,
      body:
        `${total} ${plural(total, 'record')} came back from your seeds and ${plural(total, 'was', 'were')} then removed. ` +
        `Change or clear the setting named below to bring ${plural(total, 'it', 'them')} back.`,
      filters,
    }
  }

  return {
    cause: 'nothing',
    title: 'Your list is empty — no source returned a record',
    body:
      'None of your seeds produced anything, so there is nothing for a filter or the review queue to be holding back. ' +
      'Check the ORCID iD, the researchmap permalink and the PubMed query you entered: an ORCID record with no works ' +
      'in it, a mistyped permalink, and a query that matches nothing all look exactly like this. Run the query at ' +
      'pubmed.ncbi.nlm.nih.gov to see whether it returns anything, or pin the papers you want by PMID or DOI.',
    filters: [],
  }
}

function sum(dropped: DroppedCounts | undefined): number {
  if (dropped == null) return 0
  return (
    dropped.excluded +
    dropped.window +
    dropped.erratum +
    dropped.preprint +
    dropped.dateRange +
    dropped.limit
  )
}

/**
 * How many records the wizard is showing that an embed of this list would not.
 *
 * Exactly the candidates that are not also in `publications`. Under the default
 * `strict` policy that is all of them; under `auto` it is none, because there
 * the pipeline publishes candidates too and the embed shows what the preview
 * shows. Comparing the two lists rather than reading `reviewPolicy` means this
 * stays correct whichever way that setting moves.
 */
export function candidatesMissingFromEmbed(model: ListModel): number {
  if (model.candidates.length === 0) return 0
  const published = new Set(model.publications.map((p) => p.key))
  return model.candidates.filter((c) => !published.has(c.key)).length
}
