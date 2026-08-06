/**
 * The per-mode input forms.
 *
 * Each mode is a different way of filling the same `ListConfig`; the mapping
 * lives in `draftToConfig` (`../lib/wizard.ts`) and these components only
 * collect text. Parsed counts are echoed back under every field so the user
 * can see what the tool made of their paste before spending ten seconds on a
 * network round trip.
 */

import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckboxField, Field } from './Field'
import { MemberRows } from './MemberRows'
import {
  detectCollectiveAuthorQueries,
  detectPmidQueries,
  parseIdList,
  parseMemberLines,
  parsePubmedQueries,
} from '../lib/parse'
import type {
  CollectiveAuthorHint,
  PmidQueryHint as PmidQuery,
} from '../lib/parse'
import type { WizardDraft } from '../lib/wizard'
import { isAuidQuery } from '@/core/sources/pubmed'
import type { ListModel } from '@/core/types'

type Update = (patch: Partial<WizardDraft>) => void

const textareaClass = 'min-h-28 font-mono text-xs'

/**
 * The pinned-papers field, spelled the same way in all three modes.
 *
 * It used to be `PMIDs and DOIs` in the reference-list mode, `Pin extra papers
 * (PMIDs and DOIs)` for a person and `Pinned papers (PMIDs and DOIs)` for a lab
 * — three names for one box, in a wizard whose whole point is that a list built
 * in one mode reopens in another. One name.
 */
const PINNED_LABEL = 'Pinned papers (PMIDs and DOIs)'

/**
 * What a pin means, in the one sentence that matters.
 *
 * Person mode carried no explanation at all, which left the difference between
 * this box and the query box — the difference that decides whether a record
 * ever reaches an embedded page — visible only in lab mode.
 */
const PINNED_HINT =
  'Pinned records are published whichever source found them, unless you reject them in the review queue — rejecting always wins.'

/**
 * "You have typed pins into the search box."
 *
 * A hint beside the field, never a rewrite of it. The input is the user's, and
 * a tool that silently reshuffles a query someone spent ten minutes on is worse
 * than one that says nothing — so this states what it sees, says why the other
 * box is the right one, and leaves the moving to them.
 *
 * The reason is the whole point and is spelled out rather than implied: the two
 * boxes differ in *trust*, and trust is what decides whether a record ever
 * reaches an embedded page.
 */
function PmidQueryNote({ hints }: { hints: PmidQuery[] }) {
  if (hints.length === 0) return null

  const refs: string[] = []
  let pmidTerms = 0
  for (const hint of hints) {
    pmidTerms += hint.pmidTerms
    for (const ref of hint.refs) if (!refs.includes(ref)) refs.push(ref)
  }
  const ids = refs.map((ref) => ref.replace(/^pmid:/, ''))
  const shown = ids.slice(0, 6).join(', ')
  const rest = ids.length > 6 ? ` and ${ids.length - 6} more` : ''

  return (
    <span className="text-amber-700 dark:text-amber-500">
      {' '}
      <strong className="font-medium">
        {pmidTerms === 1
          ? 'That looks like a pin rather than a search.'
          : 'Those look like pins rather than a search.'}
      </strong>{' '}
      {pmidTerms} of the terms {pmidTerms === 1 ? 'is' : 'are'} a bare{' '}
      <code>[pmid]</code> lookup ({shown}
      {rest}). Identifiers belong in the pinned-papers box above: a pinned
      record is confirmed outright and appears on the embedded page, whereas
      anything a PubMed query finds is a candidate that stays off the page until
      you confirm it here in the wizard — and an embedded page has no review
      queue, so a candidate never reaches it. Moving them is left to you; this
      box is not edited for you.
    </span>
  )
}

/**
 * "You are searching for a group in the field that only holds people."
 *
 * Same contract as `PmidQueryNote`: a hint beside the field, no rewriting.
 *
 * It exists because the failure it describes is silent and self-confirming. A
 * researcher types `"SLEEPI Study Group"[au]`, gets nothing, and reasonably
 * concludes PubMed does not know their group — when PubMed may well hold it in
 * the *collective* author field, which `[au]` does not search and `[cn]` does.
 * Measured against the live API: `"RECOVERY Collaborative Group"[au]` returns
 * 0 records, `[cn]` returns 18, translated as `[Author - Corporate]`.
 *
 * So the note says both halves. Not only "try `[cn]`", but that a zero from
 * `[au]` is not evidence of absence — that is the inference the wording has to
 * stop, because it is the one that ends the search.
 */
function CollectiveAuthorNote({ hints }: { hints: CollectiveAuthorHint[] }) {
  if (hints.length === 0) return null

  const names: string[] = []
  for (const hint of hints) {
    for (const name of hint.names) if (!names.includes(name)) names.push(name)
  }
  const example = names[0] ?? ''

  return (
    <span className="text-amber-700 dark:text-amber-500">
      {' '}
      <strong className="font-medium">
        {names.length === 1
          ? 'That looks like a group name searched in the personal-author field.'
          : 'Those look like group names searched in the personal-author field.'}
      </strong>{' '}
      PubMed files a collective author — a study group, a trial consortium — in
      its own field, and <code>[au]</code> does not search it. Use{' '}
      <code>{`"${example}"[cn]`}</code> instead; PubMed calls that field{' '}
      <em>Author – Corporate</em>.{' '}
      <strong className="font-medium">
        An <code>[au]</code> search returning nothing does not mean the group is
        not in PubMed
      </strong>{' '}
      — check <code>[cn]</code> before concluding that. If <code>[cn]</code> is
      empty too, the records really do carry no collective author, and pinning
      the papers above is the answer. Rewriting the query is left to you; this
      box is not edited for you.
    </span>
  )
}

/**
 * The per-query "publish without review" opt-in.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * This is the only control in the wizard that lets a *search* put records on a
 * published page unseen, so the label says what it costs rather than what it
 * does. Three things it has to make unmistakable:
 *
 *   - ticking it is an assertion the user is making, not a setting they are
 *     choosing — that they have run this query on PubMed and read the results;
 *   - it applies to hits the query has not made yet, which they will never be
 *     shown;
 *   - it is recoverable: Remove on a publication's own line outranks it, as it
 *     outranks a pin.
 *
 * It is off for every query, always: `WizardDraft.pubmedTrusted` starts empty
 * and nothing writes to it but this control.
 *
 * An `[auid]` query is left out entirely. It is already confirmed by the
 * pipeline, so a tick box beside it would be inert, and an inert box next to a
 * live one teaches the wrong thing about both.
 * ──────────────────────────────────────────────────────────────────────────
 */
function PubmedTrustRows({
  draft,
  update,
}: {
  draft: WizardDraft
  update: Update
}) {
  const queries = useMemo(() => parsePubmedQueries(draft.pubmed), [draft.pubmed])
  const reviewable = queries.filter((seed) => !isAuidQuery(seed.query))
  if (reviewable.length === 0) return null

  const trusted = new Set(draft.pubmedTrusted)
  const toggle = (query: string, checked: boolean) => {
    // Also drops ticks belonging to queries that are no longer in the box, so
    // deleting a trusted line and typing it again does not silently restore
    // the assertion that was made about the old one.
    const live = new Set(queries.map((seed) => seed.query))
    const next = draft.pubmedTrusted.filter((q) => q !== query && live.has(q))
    if (checked) next.push(query)
    update({ pubmedTrusted: next })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium">
          Publish a query’s results without reviewing them
        </h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Leave these unticked unless you are sure. Ticking one means:{' '}
          <em>
            I have run this query on PubMed and every record it returns is my
            group’s work.
          </em>{' '}
          Its hits then go straight onto the published list and into the
          embedded page with no review step — including papers it finds in
          future, which you will not see first. Untick it and they go back to
          the review queue. If a trusted query does bring in something wrong,
          press <strong className="font-medium">Remove</strong> on that paper’s
          own line in the list below; removing outranks this, exactly as it
          outranks a pinned paper.
        </p>
      </div>
      {reviewable.map((seed) => (
        <CheckboxField
          key={seed.query}
          checked={trusted.has(seed.query)}
          onChange={(checked) => toggle(seed.query, checked)}
          label={
            <span className="font-mono text-xs break-all">{seed.query}</span>
          }
        />
      ))}
    </div>
  )
}

function Counts({
  ok,
  okLabel,
  invalid,
}: {
  ok: number
  okLabel: string
  invalid: string[]
}) {
  return (
    <>
      <span>
        {ok} {okLabel}
        {ok === 1 ? '' : 's'} recognized.
      </span>
      {invalid.length > 0 ? (
        <span className="text-destructive">
          {' '}
          Not recognized: {invalid.slice(0, 6).join(', ')}
          {invalid.length > 6 ? ` and ${invalid.length - 6} more` : ''}.
        </span>
      ) : null}
    </>
  )
}

/** Mode 1 — a reference list for one article. */
export function ArticleModeForm({
  draft,
  update,
}: {
  draft: WizardDraft
  update: Update
}) {
  const parsed = useMemo(() => parseIdList(draft.pins), [draft.pins])
  return (
    <Field
      label={PINNED_LABEL}
      hint={
        <Counts ok={parsed.refs.length} okLabel="identifier" invalid={parsed.invalid} />
      }
    >
      {(id) => (
        <Textarea
          id={id}
          className={textareaClass}
          spellCheck={false}
          value={draft.pins}
          onChange={(e) => update({ pins: e.currentTarget.value })}
          placeholder={'33782057\n10.1136/bmj.n71\nhttps://doi.org/10.1001/jamapsychiatry.2024.0189'}
        />
      )}
    </Field>
  )
}

/** Mode 2 — one person's publication list. */
export function PersonModeForm({
  draft,
  update,
}: {
  draft: WizardDraft
  update: Update
}) {
  const queries = useMemo(() => parsePubmedQueries(draft.pubmed), [draft.pubmed])
  const pmidQueries = useMemo(() => detectPmidQueries(draft.pubmed), [draft.pubmed])
  const collective = useMemo(
    () => detectCollectiveAuthorQueries(draft.pubmed),
    [draft.pubmed],
  )
  const pins = useMemo(() => parseIdList(draft.pins), [draft.pins])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="ORCID iD"
          hint="The most reliable seed. Anything in your ORCID works record is trusted outright."
        >
          {(id) => (
            <Input
              id={id}
              value={draft.orcid}
              spellCheck={false}
              inputMode="text"
              onChange={(e) => update({ orcid: e.currentTarget.value })}
              placeholder="0000-0003-1317-0220"
            />
          )}
        </Field>
        <Field
          label="researchmap permalink"
          hint="Optional. Adds Japanese-language work that ORCID and PubMed do not carry."
        >
          {(id) => (
            <Input
              id={id}
              value={draft.researchmap}
              spellCheck={false}
              onChange={(e) => update({ researchmap: e.currentTarget.value })}
              placeholder="furukawayuki"
            />
          )}
        </Field>
      </div>

      {/*
        Pins first, searches second. Naming a paper by its identifier is the
        simpler act, the more reliable one and the more common one: it always
        finds exactly the record meant, and it needs no review. A PubMed query
        is the harder tool — it can be too broad, it can return nothing, and
        everything it finds waits in a queue. Putting the easy, certain box
        under the hard, uncertain one told the reader the wrong thing about
        which they should reach for.
      */}
      <Field
        label={PINNED_LABEL}
        hint={
          <>
            <Counts ok={pins.refs.length} okLabel="identifier" invalid={pins.invalid} />{' '}
            {PINNED_HINT}
          </>
        }
      >
        {(id) => (
          <Textarea
            id={id}
            className={textareaClass}
            spellCheck={false}
            value={draft.pins}
            onChange={(e) => update({ pins: e.currentTarget.value })}
            placeholder={'33782057\n10.1101/2024.01.01.573000'}
          />
        )}
      </Field>

      <Field
        label="PubMed queries (one per line)"
        hint={
          <>
            {queries.length} quer{queries.length === 1 ? 'y' : 'ies'}. An{' '}
            <code>[auid]</code> search on your ORCID iD is trusted; an{' '}
            <code>[au]</code> name search is not, and its hits go to the review
            queue below unless you tick it as trusted underneath.
            <PmidQueryNote hints={pmidQueries} />
            <CollectiveAuthorNote hints={collective} />
          </>
        }
      >
        {(id) => (
          <Textarea
            id={id}
            className={textareaClass}
            spellCheck={false}
            value={draft.pubmed}
            onChange={(e) => update({ pubmed: e.currentTarget.value })}
            placeholder={'0000-0003-1317-0220[auid]\nFurukawa Y[au] AND (Tokyo[ad])'}
          />
        )}
      </Field>

      <PubmedTrustRows draft={draft} update={update} />
    </div>
  )
}

/** Mode 3 — a lab or research group. */
export function LabModeForm({
  draft,
  update,
  model,
  onFreeze,
}: {
  draft: WizardDraft
  update: Update
  /** The built list, so a member row can be frozen against real publications. */
  model?: ListModel | null
  onFreeze?: (next: WizardDraft) => void
}) {
  const members = useMemo(() => parseMemberLines(draft.members), [draft.members])
  const queries = useMemo(() => parsePubmedQueries(draft.pubmed), [draft.pubmed])
  const pmidQueries = useMemo(() => detectPmidQueries(draft.pubmed), [draft.pubmed])
  const collective = useMemo(
    () => detectCollectiveAuthorQueries(draft.pubmed),
    [draft.pubmed],
  )
  const pins = useMemo(() => parseIdList(draft.pins), [draft.pins])

  const withOrcid = members.members.filter((m) => m.orcid).length
  const withRm = members.members.filter((m) => m.researchmap).length

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Members (one per line)"
        hint={
          <>
            {members.members.length} member
            {members.members.length === 1 ? '' : 's'} — {withOrcid} with an ORCID
            iD, {withRm} with a researchmap permalink. Paste a column straight
            out of a spreadsheet: tabs, commas and ORCID URLs are all understood,
            in any column order. A line can also carry the member’s time in the
            group — <code>2019-04..2023-03</code> — which you can type here or
            fill in on the rows below.
            {members.invalid.length > 0 ? (
              <span className="text-destructive">
                {' '}
                No identifier found on {members.invalid.length} line
                {members.invalid.length === 1 ? '' : 's'}:{' '}
                {members.invalid.slice(0, 3).join(' / ')}
                {members.invalid.length > 3 ? ' …' : ''}
              </span>
            ) : null}
          </>
        }
      >
        {(id) => (
          <Textarea
            id={id}
            className="min-h-36 font-mono text-xs"
            spellCheck={false}
            value={draft.members}
            onChange={(e) => update({ members: e.currentTarget.value })}
            placeholder={
              'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki\n0000-0002-1825-0097\t2019-04..2023-03\nhttps://researchmap.jp/someone'
            }
          />
        )}
      </Field>

      <MemberRows
        draft={draft}
        update={update}
        model={model}
        onFreeze={onFreeze}
      />

      {/* Pins above searches, for the reason spelled out in `PersonModeForm`. */}
      <Field
        label={PINNED_LABEL}
        hint={
          <>
            <Counts ok={pins.refs.length} okLabel="identifier" invalid={pins.invalid} />{' '}
            {PINNED_HINT}
          </>
        }
      >
        {(id) => (
          <Textarea
            id={id}
            className={textareaClass}
            spellCheck={false}
            value={draft.pins}
            onChange={(e) => update({ pins: e.currentTarget.value })}
            placeholder={'33782057\n10.1136/bmj.n71'}
          />
        )}
      </Field>

      <Field
        label="PubMed queries (one per line)"
        hint={
          <>
            {queries.length} quer{queries.length === 1 ? 'y' : 'ies'}. Useful for
            a member with no ORCID iD, narrowed by affiliation — e.g.{' '}
            <code>Tanaka H[au] AND (&quot;Univ Tokyo&quot;[ad])</code>. Name
            searches feed the review queue rather than the published list,
            unless you tick one as trusted underneath. Searching for the group
            itself takes a different field: a collective author lives in{' '}
            <code>&quot;Your Group&quot;[cn]</code>, never in <code>[au]</code>,
            and if <code>[cn]</code> is empty too then the records carry no
            collective author and pinning them is the answer.
            <PmidQueryNote hints={pmidQueries} />
            <CollectiveAuthorNote hints={collective} />
          </>
        }
      >
        {(id) => (
          <Textarea
            id={id}
            className={textareaClass}
            spellCheck={false}
            value={draft.pubmed}
            onChange={(e) => update({ pubmed: e.currentTarget.value })}
            placeholder={'Tanaka H[au] AND ("Univ Tokyo"[ad])\n"RECOVERY Collaborative Group"[cn]'}
          />
        )}
      </Field>

      <PubmedTrustRows draft={draft} update={update} />
    </div>
  )
}
