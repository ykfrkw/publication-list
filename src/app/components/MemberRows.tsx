/**
 * One row per member of a lab list: who they are, when they were here, and the
 * Freeze action for when they leave.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ROWS ARE THE EDITING SURFACE; THE TEXTAREA IS THE STORAGE FORMAT
 *
 * Naming members one at a time and saying when each of them was here is the
 * task, so it is a row per member with a field per thing, and the free-text box
 * has moved below into a disclosure that imports a spreadsheet paste.
 *
 * `draft.members` is still a single string and still the only place the member
 * list lives. That is deliberate rather than unfinished. Everything downstream
 * reads it — `draftToConfig`, `configToDraft`, `draftHasContent`, the saved
 * draft — and, more importantly, **freezing works by commenting a line out**,
 * which is what makes it recoverable: delete the `#` and the member is back.
 * A structured `WizardDraft.memberRows` would need a stored-draft migration and
 * would forfeit that property, so every control here writes a line of text
 * through the editors in `../lib/parse` and reads its value back out of the
 * parse. There is exactly one copy of the member list and the user can see it.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * WHY THE TWO MECHANISMS ARE BOTH HERE
 *
 * Freezing is the one to use, and the row says so. It converts what the member
 * has published *so far* into explicit pins and drops the seed, so it cannot be
 * wrong about a future paper — there is no future paper it can see.
 *
 * The dates are the safety net for the lab that forgets to freeze anybody: they
 * bound the seed by the member's time in the group plus a grace period for work
 * published after they left. They are a rule about dates, which means they can
 * be wrong about an individual paper, which is why they are the fallback and
 * not the headline.
 */

import { useMemo, useState } from 'react'
import { PlusIcon, SnowflakeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DEFAULT_SEED_GRACE_MONTHS } from '@/core/seeds'
import type { ListModel } from '@/core/types'
import {
  appendMemberLine,
  nextMemberLineIndex,
  removeMemberLine,
  setMemberField,
} from '../lib/parse'
import type { MemberFields, ParsedMember, ParsedMembers } from '../lib/parse'
import { applyFreeze, planFreeze } from '../lib/wizard'
import type { WizardDraft } from '../lib/wizard'

/** The fields a row can edit. `grace` is text-only — see the closing note. */
type FieldName = 'name' | 'orcid' | 'researchmap' | 'from' | 'to'

/**
 * A row, and the line of the box it is: the member parsed off that line, or
 * `null` while the line is still blank or does not exist yet.
 */
interface RowView {
  lineIndex: number
  member: ParsedMember | null
}

/**
 * The row being typed in, held as fields, so nothing moves under the cursor.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * The box is read by *shape*, not by column, so a half-typed identifier is not
 * yet the thing it is going to be: `0000-0002` is a bare word, and a bare word
 * is the shape of a researchmap permalink. Round-tripping every keystroke
 * through the text therefore has the value hopping between fields on its way in
 * — and, worse, a per-field buffer would leave each keystroke's leftovers in
 * whichever cell the previous one landed in, so the line accumulates junk.
 *
 * Holding the whole row fixes both. Every write states all five fields, so the
 * line is a function of what the user has typed and not of what the parser made
 * of the last keystroke; and every field displays the buffer, so none of them
 * moves while the row is being filled in.
 *
 * It is dropped on blur, at which point the row shows what the box actually
 * says — including, if what was typed is not a recognizable identifier, the
 * cell the parser really put it in. That is the truth and the row should not
 * hide it.
 * ───────────────────────────────────────────────────────────────────────────
 */
interface EditBuffer {
  lineIndex: number
  fields: MemberFields
}

function seedIdsOf(member: ParsedMember): string[] {
  const ids: string[] = []
  if (member.orcid) ids.push(member.orcid)
  if (member.researchmap) ids.push(member.researchmap)
  return ids
}

/** What to call this row in the fields' accessible names. */
function labelOf(row: RowView, position: number): string {
  if (row.member == null) return `member ${position}`
  return row.member.name ?? seedIdsOf(row.member)[0] ?? `member ${position}`
}

/** The one-line statement of what pressing Confirm will do. */
function freezeSummary(pinned: number, losing: number): string {
  const head =
    `Pins the ${pinned} paper${pinned === 1 ? '' : 's'} of theirs that ` +
    `${pinned === 1 ? 'is' : 'are'} on the list right now and removes their seed, ` +
    `so those stay and nothing they publish afterwards can be added.`
  if (losing === 0) return head
  return (
    `${head} ${losing} of them ${losing === 1 ? 'has' : 'have'} neither a DOI ` +
    `nor a PMID, cannot be pinned, and will disappear from the list.`
  )
}

export function MemberRows({
  draft,
  update,
  parsed,
  model,
  onFreeze,
}: {
  draft: WizardDraft
  update: (patch: Partial<WizardDraft>) => void
  /**
   * `draft.members`, already parsed. Passed in rather than parsed again here:
   * the form above needs the same parse for its counts, and every keystroke in
   * every one of these fields used to run it twice.
   */
  parsed: ParsedMembers
  /** The built list. Freezing needs it — it operates on real publications. */
  model?: ListModel | null
  /** Apply a frozen draft and rebuild, the way the review queue does. */
  onFreeze?: (next: WizardDraft) => void
}) {
  const [confirming, setConfirming] = useState<number | null>(null)
  const [editing, setEditing] = useState<EditBuffer | null>(null)
  /** Whether the user has asked for an empty row to fill in. */
  const [adding, setAdding] = useState(false)

  const lineCount = useMemo(
    () => draft.members.split(/\r?\n/).length,
    [draft.members],
  )

  /**
   * The rows to draw: one per line of the box, plus at most one that has no
   * line behind it yet.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * KEYS ARE LINE INDICES, AND THAT IS LOAD-BEARING
   *
   * The key used to be `orcid|researchmap`, derived from the values. The moment
   * an identifier field was edited the key changed, React remounted the `<li>`,
   * and the focus left the input mid-keystroke — which is survivable when the
   * only fields are two date boxes people paste into, and unusable once the
   * identifiers themselves are typed here.
   *
   * A line index is stable across any edit to the line's contents, so the two
   * remaining ways a row can change key are the two where it should: a line was
   * added or removed above it.
   *
   * The row being filled in for the first time is keyed by the line it is about
   * to become — `nextMemberLineIndex` — so the first keystroke, which creates
   * that line, does not change its key either.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const rows: RowView[] = (() => {
    const byLine = new Map<number, ParsedMember>()
    for (const member of parsed.rows) byLine.set(member.lineIndex, member)

    const blanks = new Set<number>()
    // An untouched form opens on one empty row: the point of this block is that
    // a member is added here, and a form with nothing to type into does not say
    // so. After that a row appears when it is asked for.
    if (parsed.rows.length === 0 || adding) {
      blanks.add(nextMemberLineIndex(draft.members))
    }
    // A row whose every field has just been emptied has no member to parse off
    // it any more. Keep drawing it: it is the row the cursor is in.
    if (editing != null) blanks.add(editing.lineIndex)

    const views: RowView[] = parsed.rows.map((member) => ({
      lineIndex: member.lineIndex,
      member,
    }))
    for (const lineIndex of blanks) {
      if (!byLine.has(lineIndex)) views.push({ lineIndex, member: null })
    }
    return views.sort((a, b) => a.lineIndex - b.lineIndex)
  })()

  /** What a row's fields are worth right now: the buffer, else the parse. */
  const fieldsOf = (row: RowView): MemberFields => {
    if (editing != null && editing.lineIndex === row.lineIndex) {
      return editing.fields
    }
    const member = row.member
    if (member == null) return {}
    return {
      name: member.name,
      orcid: member.orcid,
      researchmap: member.researchmap,
      from: member.from,
      to: member.to,
      grace: member.grace,
    }
  }

  const shown = (row: RowView, field: FieldName): string =>
    fieldsOf(row)[field] ?? ''

  /** Write one field back into the box, restating the whole row. */
  const edit = (row: RowView, field: FieldName, value: string) => {
    const fields: MemberFields = { ...fieldsOf(row), [field]: value }
    setEditing({ lineIndex: row.lineIndex, fields })

    const next =
      row.lineIndex >= lineCount
        ? appendMemberLine(draft.members, fields)
        : setMemberField(draft.members, row.lineIndex, {
            // Every field, every time: an omitted one would keep whatever the
            // parser made of the last keystroke. Emptying them all clears the
            // line, and the row stays on screen because `editing` holds it.
            name: fields.name ?? '',
            orcid: fields.orcid ?? '',
            researchmap: fields.researchmap ?? '',
            from: fields.from ?? '',
            to: fields.to ?? '',
            grace: fields.grace,
          })

    if (next === draft.members) return
    update({ members: next })
    // The line exists now, so the row is a real one and the placeholder row is
    // spent. The key does not change, so the field keeps the cursor.
    if (row.member == null) setAdding(false)
  }

  const remove = (row: RowView) => {
    setEditing(null)
    setConfirming(null)
    if (row.member == null) {
      setAdding(false)
      return
    }
    update({ members: removeMemberLine(draft.members, row.lineIndex) })
  }

  const withOrcid = parsed.members.filter((m) => m.orcid).length
  const withRm = parsed.members.filter((m) => m.researchmap).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium">Members and their time here</h4>
        <p className="text-xs text-muted-foreground">
          {parsed.members.length} member
          {parsed.members.length === 1 ? '' : 's'} — {withOrcid} with an ORCID
          iD, {withRm} with a researchmap permalink. Dates are optional: leave
          them blank and the member is included with no time limit.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row, position) => {
          const label = labelOf(row, position + 1)
          const ids = row.member ? seedIdsOf(row.member) : []
          const plan =
            model != null && confirming === row.lineIndex && ids.length > 0
              ? planFreeze(model, ids, row.member?.name ?? ids[0])
              : null

          return (
            <li
              key={row.lineIndex}
              className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Name
                  <Input
                    className="h-8 text-xs"
                    spellCheck={false}
                    placeholder="Yuki Furukawa"
                    aria-label={`Name — ${label}`}
                    autoFocus={adding && row.member == null}
                    value={shown(row, 'name')}
                    onChange={(e) => edit(row, 'name', e.currentTarget.value)}
                    onBlur={() => setEditing(null)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  ORCID iD
                  <Input
                    className="h-8 font-mono text-xs"
                    spellCheck={false}
                    placeholder="0000-0003-1317-0220"
                    aria-label={`ORCID iD — ${label}`}
                    value={shown(row, 'orcid')}
                    onChange={(e) => edit(row, 'orcid', e.currentTarget.value)}
                    onBlur={() => setEditing(null)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  researchmap
                  <Input
                    className="h-8 font-mono text-xs"
                    spellCheck={false}
                    placeholder="furukawayuki"
                    aria-label={`researchmap — ${label}`}
                    value={shown(row, 'researchmap')}
                    onChange={(e) =>
                      edit(row, 'researchmap', e.currentTarget.value)
                    }
                    onBlur={() => setEditing(null)}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Joined
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    spellCheck={false}
                    placeholder="2019-04"
                    aria-label={`Joined — ${label}`}
                    value={shown(row, 'from')}
                    onChange={(e) => edit(row, 'from', e.currentTarget.value)}
                    onBlur={() => setEditing(null)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Left
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    spellCheck={false}
                    placeholder="2023-03"
                    aria-label={`Left — ${label}`}
                    value={shown(row, 'to')}
                    onChange={(e) => edit(row, 'to', e.currentTarget.value)}
                    onBlur={() => setEditing(null)}
                  />
                </label>

                <div className="ms-auto flex flex-wrap items-center gap-2">
                  {/*
                    Nothing to freeze without a seed: freezing pins a member's
                    papers and takes their seed out, and a row with no
                    identifier on it has neither. The button appears with the
                    identifier rather than sitting there inert.
                  */}
                  {ids.length > 0 && confirming !== row.lineIndex ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={model == null}
                      title={
                        model == null
                          ? 'Generate the list first — freezing pins the papers that are on it.'
                          : undefined
                      }
                      onClick={() => setConfirming(row.lineIndex)}
                    >
                      <SnowflakeIcon />
                      Freeze
                    </Button>
                  ) : null}
                  {row.member != null || adding ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove — ${label}`}
                      onClick={() => remove(row)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>

              {plan != null ? (
                <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2.5">
                  <p className="text-xs leading-relaxed">
                    {freezeSummary(plan.refs.length, plan.losing.length)}
                  </p>
                  {plan.losing.length > 0 ? (
                    <ul className="flex list-disc flex-col gap-0.5 ps-4 text-xs text-destructive">
                      {plan.losing.map((pub) => (
                        <li key={pub.key}>{pub.title || pub.key}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const next = applyFreeze(draft, plan, row.lineIndex)
                        setConfirming(null)
                        if (onFreeze) onFreeze(next)
                        else update(next)
                      }}
                    >
                      Freeze {plan.label}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
          Add member
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">
          When someone leaves, press Freeze.
        </strong>{' '}
        It pins everything of theirs that is on the list today and takes their
        seed out, so their later work at another institution can never appear
        here. The dates are the fallback if nobody remembers to: a paper counts
        while its author was here, plus {DEFAULT_SEED_GRACE_MONTHS} months for
        publication lag. For a different grace period, open the text below and
        write <code>2019-04..2023-03+36</code> on the member’s line.
      </p>
    </div>
  )
}
