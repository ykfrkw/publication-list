/**
 * One row per member of a lab list: who they are, when they were here, and the
 * Freeze action for when they leave.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MEMBERS TEXTAREA REMAINS THE SOURCE OF TRUTH
 *
 * These rows are a view over `draft.members`, not a second copy of it. A date
 * typed here is written back into that line as a `2019-04..2023-03` token, and
 * freezing comments the line out. So there is exactly one place the member list
 * lives, the user can see and hand-edit everything these controls do, and
 * pasting a list of bare ORCID iDs — with no dates anywhere — keeps working
 * exactly as it did, producing exactly the seeds it did before.
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
import { SnowflakeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DEFAULT_SEED_GRACE_MONTHS } from '@/core/seeds'
import type { ListModel } from '@/core/types'
import {
  formatMemberWindow,
  parseMemberLines,
  setMemberWindow,
} from '../lib/parse'
import type { ParsedMember } from '../lib/parse'
import { applyFreeze, planFreeze } from '../lib/wizard'
import type { WizardDraft } from '../lib/wizard'

/** A stable identity for a row, independent of its position in the text. */
function rowKey(member: ParsedMember): string {
  return `${member.orcid ?? ''}|${member.researchmap ?? ''}`
}

function seedIdsOf(member: ParsedMember): string[] {
  const ids: string[] = []
  if (member.orcid) ids.push(member.orcid)
  if (member.researchmap) ids.push(member.researchmap)
  return ids
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
  model,
  onFreeze,
}: {
  draft: WizardDraft
  update: (patch: Partial<WizardDraft>) => void
  /** The built list. Freezing needs it — it operates on real publications. */
  model?: ListModel | null
  /** Apply a frozen draft and rebuild, the way the review queue does. */
  onFreeze?: (next: WizardDraft) => void
}) {
  const { members } = useMemo(
    () => parseMemberLines(draft.members),
    [draft.members],
  )
  const [confirming, setConfirming] = useState<string | null>(null)

  /**
   * Nothing pasted yet — say what this block is for anyway.
   *
   * It used to render nothing at all until a member existed, which meant the
   * one capability people open this tab *for* — someone joined, someone left —
   * was invisible on an untouched form. The only hint was a date inside the
   * textarea's placeholder, which reads as sample text. A heading and a line
   * cost nothing and are the difference between finding this and concluding it
   * was never built. No example rows: a disabled row that does nothing teaches
   * the wrong thing about the real ones.
   */
  if (members.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3">
        <h4 className="text-sm font-medium">Members and their time here</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Every member you add above gets a row here with optional{' '}
          <strong className="font-medium text-foreground">Joined</strong> and{' '}
          <strong className="font-medium text-foreground">Left</strong> dates and
          a <strong className="font-medium text-foreground">Freeze</strong>{' '}
          button — press Freeze when someone leaves and what they published here
          stays on the list while what they publish next can never join it.
        </p>
      </div>
    )
  }

  const setWindow = (
    member: ParsedMember,
    patch: { from?: string; to?: string },
  ) => {
    const from = (patch.from ?? member.from ?? '').trim()
    const to = (patch.to ?? member.to ?? '').trim()
    const window = {
      ...(from !== '' ? { from } : {}),
      ...(to !== '' ? { to } : {}),
      ...(member.grace != null ? { grace: member.grace } : {}),
    }
    // An empty pair clears the token rather than leaving `..` behind; the
    // member then reverts to the windowless seed they started as.
    update({
      members: setMemberWindow(
        draft.members,
        member.lineIndex,
        formatMemberWindow(window) === '' ? null : window,
      ),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Members and their time here</h4>
        <p className="text-xs text-muted-foreground">
          Dates are optional — leave them blank and the member is included with
          no time limit, exactly as before.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const key = rowKey(member)
          const ids = seedIdsOf(member)
          const plan =
            model != null && confirming === key
              ? planFreeze(model, ids, member.name ?? ids[0])
              : null

          return (
            <li
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-0 grow flex-col">
                  <span className="truncate text-sm font-medium">
                    {member.name ?? ids[0]}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {ids.join(' · ')}
                  </span>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Joined
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    spellCheck={false}
                    placeholder="2019-04"
                    aria-label={`Joined — ${member.name ?? ids[0]}`}
                    value={member.from ?? ''}
                    onChange={(e) =>
                      setWindow(member, { from: e.currentTarget.value })
                    }
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Left
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    spellCheck={false}
                    placeholder="2023-03"
                    aria-label={`Left — ${member.name ?? ids[0]}`}
                    value={member.to ?? ''}
                    onChange={(e) =>
                      setWindow(member, { to: e.currentTarget.value })
                    }
                  />
                </label>

                {confirming === key ? null : (
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
                    onClick={() => setConfirming(key)}
                  >
                    <SnowflakeIcon />
                    Freeze
                  </Button>
                )}
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
                        const next = applyFreeze(draft, plan, member.lineIndex)
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

      <p className="text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">
          When someone leaves, press Freeze.
        </strong>{' '}
        It pins everything of theirs that is on the list today and takes their
        seed out, so their later work at another institution can never appear
        here. The dates are the fallback if nobody remembers to: a paper counts
        while its author was here, plus {DEFAULT_SEED_GRACE_MONTHS} months for
        publication lag. Write <code>2019-04..2023-03</code> straight into the
        box above if you prefer, and add <code>+36</code> for a longer grace
        period.
      </p>
    </div>
  )
}
