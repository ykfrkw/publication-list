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
import { parseIdList, parseMemberLines, parsePubmedQueries } from '../lib/parse'
import type { WizardDraft } from '../lib/wizard'
import type { ListModel } from '@/core/types'

type Update = (patch: Partial<WizardDraft>) => void

const textareaClass = 'min-h-28 font-mono text-xs'

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
            a group tag such as <code>SLEEPI[au]</code>. Name searches feed the
            review queue rather than the published list.
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
            placeholder={'SLEEPI[au]\nFurukawa Y[au] AND (Tokyo[ad])'}
          />
        )}
      </Field>

      <Field
        label="Pinned papers (PMIDs and DOIs)"
        hint={
          <>
            <Counts ok={pins.refs.length} okLabel="identifier" invalid={pins.invalid} />{' '}
            Pinned records are always published, whichever source found them.
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
