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
import { Field } from './Field'
import { MemberRows } from './MemberRows'
import {
  detectPmidQueries,
  parseIdList,
  parseMemberLines,
  parsePubmedQueries,
} from '../lib/parse'
import type { PmidQueryHint as PmidQuery } from '../lib/parse'
import type { WizardDraft } from '../lib/wizard'
import type { ListModel } from '@/core/types'

type Update = (patch: Partial<WizardDraft>) => void

const textareaClass = 'min-h-28 font-mono text-xs'

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
      {rest}). Identifiers belong in the pinned-papers box below: a pinned
      record is confirmed outright and appears on the embedded page, whereas
      anything a PubMed query finds is a candidate that stays off the page until
      you confirm it here in the wizard — and an embedded page has no review
      queue, so a candidate never reaches it. Moving them is left to you; this
      box is not edited for you.
    </span>
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
      label="PMIDs and DOIs"
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

      <Field
        label="PubMed queries (one per line)"
        hint={
          <>
            {queries.length} quer{queries.length === 1 ? 'y' : 'ies'}. An{' '}
            <code>[auid]</code> search on your ORCID iD is trusted; an{' '}
            <code>[au]</code> name search is not, and its hits go to the review
            queue below.
            <PmidQueryNote hints={pmidQueries} />
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

      <Field
        label="Pin extra papers (PMIDs and DOIs)"
        hint={<Counts ok={pins.refs.length} okLabel="identifier" invalid={pins.invalid} />}
      >
        {(id) => (
          <Textarea
            id={id}
            className={textareaClass}
            spellCheck={false}
            value={draft.pins}
            onChange={(e) => update({ pins: e.currentTarget.value })}
            placeholder="10.1101/2024.01.01.573000"
          />
        )}
      </Field>
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
            in any column order.
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

      <Field
        label="PubMed queries (one per line)"
        hint={
          <>
            {queries.length} quer{queries.length === 1 ? 'y' : 'ies'}. Useful for
            a member with no ORCID iD, narrowed by affiliation — e.g.{' '}
            <code>Tanaka H[au] AND (&quot;Univ Tokyo&quot;[ad])</code>. Name
            searches feed the review queue rather than the published list. Most
            groups are not registered in PubMed as an author at all, so a bare
            group tag usually returns nothing; pin those papers instead.
            <PmidQueryNote hints={pmidQueries} />
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
            placeholder={'Tanaka H[au] AND ("Univ Tokyo"[ad])\nFurukawa Y[au] AND (Tokyo[ad])'}
          />
        )}
      </Field>

      <Field
        label="Pinned papers (PMIDs and DOIs)"
        hint={
          <>
            <Counts ok={pins.refs.length} okLabel="identifier" invalid={pins.invalid} />{' '}
            Pinned records are published whichever source found them, unless you
            reject them in the review queue — rejecting always wins.
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
    </div>
  )
}
