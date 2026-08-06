/**
 * Controls shared by all three modes: citation style, date range, grouping,
 * preprint inclusion, Japanese-language handling, bold names, review policy and
 * the limit.
 *
 * Every one of these maps to a single `ListConfig` field of the same name; see
 * `draftToConfig`. The one that is not a straight copy is the preprint
 * checkbox: a boolean here, `'include'` / `'exclude'` in the config.
 */

import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { CITATION_STYLES } from '@/core/types'
import { headingLevelFor } from '@/core/config'
import { CheckboxField, Field, SelectField } from './Field'
import { HEADING_LEVEL_CHOICES, type WizardDraft } from '../lib/wizard'

// The two-level grouping leads because it is the default everywhere except the
// reference-list mode, which starts on "One flat list".
const GROUP_BY = [
  {
    value: 'category-year' as const,
    label: 'By publication type, then year within each',
  },
  { value: 'category' as const, label: 'By publication type only' },
  { value: 'year' as const, label: 'By year only' },
  { value: 'none' as const, label: 'One flat list' },
]

/**
 * ──────────────────────────────────────────────────────────────────────────
 * AUTOMATIC AND THE SNAPSHOT CANNOT BOTH BE HAD
 *
 * Automatic works by measuring the page the list is pasted into, which only the
 * embed script can do. A snapshot is written here, before anyone has said where
 * it will be pasted, so a snapshot plus Automatic would bake one level and then
 * change to another on load — leaving crawlers and JavaScript-off visitors on
 * the wrong outline permanently.
 *
 * **The option is disabled rather than hidden, and a line beside the select
 * says why.** Disabling alone would leave someone who came for Automatic
 * staring at a greyed-out row with no explanation and no idea which checkbox
 * caused it; a line alone would leave the select reading "Automatic" while the
 * snippet below it says H3, which is the control lying about its own output.
 * The select shows the level that will actually be written — `headingLevelFor`
 * resolves it, the same function `buildEmbedSnippet` uses — so what is on
 * screen and what is in the snippet are the same number.
 *
 * Nothing is lost by un-ticking the snapshot box: the stored choice is still
 * `'auto'` (see `WizardDraft.headingLevel`), so the select goes straight back
 * to Automatic.
 * ──────────────────────────────────────────────────────────────────────────
 */
const HEADING_LEVEL_LABELS: Record<string, string> = {
  auto: 'Automatic — match the page it is pasted into (recommended)',
  '2': 'H2',
  '3': 'H3',
  '4': 'H4',
  '5': 'H5',
}

const JAPANESE = [
  { value: 'separate' as const, label: 'In a section of their own' },
  { value: 'merge' as const, label: 'Mixed in with everything else' },
  { value: 'hide' as const, label: 'Left out' },
]

const REVIEW_POLICY = [
  { value: 'strict' as const, label: 'Hold candidates for review (recommended)' },
  { value: 'auto' as const, label: 'Publish candidates immediately' },
]

export function SharedOptions({
  draft,
  update,
}: {
  draft: WizardDraft
  update: (patch: Partial<WizardDraft>) => void
}) {
  // The value the snippet will carry, not the raw draft field: with the
  // snapshot box ticked these differ, and the select must show the one that
  // ends up in the markup. See the note above `HEADING_LEVEL_LABELS`.
  const headingLevel = headingLevelFor(
    { headingLevel: draft.headingLevel },
    draft.snapshot,
  )
  const headingLevelOptions = HEADING_LEVEL_CHOICES.map((choice) => ({
    value: String(choice),
    label: HEADING_LEVEL_LABELS[String(choice)],
    disabled: choice === 'auto' && draft.snapshot,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Citation style"
          value={draft.style}
          onChange={(style) => update({ style })}
          options={CITATION_STYLES}
        />
        <SelectField
          label="Group the list"
          hint="The first option starts a section for each publication type — original articles, letters, editorials — and inside each one puts a small heading for every year, newest first. The others give you one of those two levels on its own, or no headings at all. Publication types come from what the sources report about a work, which is not always right."
          value={draft.groupBy}
          onChange={(groupBy) => update({ groupBy })}
          options={GROUP_BY}
        />
      </div>

      <SelectField
        label="Heading level"
        hint={
          draft.snapshot
            ? 'Automatic is unavailable while “Include the list itself in the snippet” is ticked: that copy of the list is written here, before it knows what page it will sit on, so it needs a fixed level. Un-tick that box to use Automatic.'
            : 'Automatic looks at the page the list is pasted into and uses the level just below the nearest heading above it, so the list fits that page’s outline. Pick a level yourself if you would rather fix it. Year dividers always sit one level below.'
        }
        value={String(headingLevel)}
        onChange={(value) =>
          update({
            headingLevel:
              value === 'auto'
                ? 'auto'
                : (Number.parseInt(value, 10) as 2 | 3 | 4 | 5),
          })
        }
        options={headingLevelOptions}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" hint="Year or year-month, e.g. 2020 or 2020-04. Leave blank for no lower bound.">
          {(id) => (
            <Input
              id={id}
              value={draft.from}
              inputMode="numeric"
              placeholder="2020-01"
              onChange={(e) => update({ from: e.currentTarget.value })}
            />
          )}
        </Field>
        <Field label="To" hint="Same format. Leave blank to include everything up to today.">
          {(id) => (
            <Input
              id={id}
              value={draft.to}
              inputMode="numeric"
              placeholder="2026-12"
              onChange={(e) => update({ to: e.currentTarget.value })}
            />
          )}
        </Field>
      </div>

      <Field
        label="Names to bold"
        hint="Comma-separated. Spell them out in full (“Yuki Furukawa”, not “Furukawa Y”) so two people with the same surname are not both bolded. Left blank, the seed profiles’ own names are used."
      >
        {(id) => (
          <Input
            id={id}
            value={draft.boldNames}
            spellCheck={false}
            placeholder="Yuki Furukawa"
            onChange={(e) => update({ boldNames: e.currentTarget.value })}
          />
        )}
      </Field>

      <Separator />

      {/*
        Unchecked is the default, and the label says so by being an opt-in:
        "Include preprints" reads as "they are not included right now". The
        pipeline reports every preprint it holds back in the warnings panel,
        so an unticked box is never a silent omission.
      */}
      <CheckboxField
        checked={draft.preprints}
        onChange={(preprints) => update({ preprints })}
        label="Include preprints"
        hint="Off by default, so the list is published work. Turning it on adds a Preprints section for medRxiv, bioRxiv, arXiv and the like — and for an F1000-family article whose referees have not approved it yet."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Japanese-language publications"
          hint="researchmap supplies these; ORCID and PubMed mostly do not."
          value={draft.japanese}
          onChange={(japanese) => update({ japanese })}
          options={JAPANESE}
        />
        <SelectField
          label="Unconfirmed candidates"
          hint="“Hold for review” keeps a namesake’s paper off your page until you confirm it."
          value={draft.reviewPolicy}
          onChange={(reviewPolicy) => update({ reviewPolicy })}
          options={REVIEW_POLICY}
        />
      </div>

      <Field
        label="Show at most"
        hint="Number of publications, newest first. Leave blank to show all of them."
      >
        {(id) => (
          <Input
            id={id}
            value={draft.limit}
            inputMode="numeric"
            placeholder="all"
            onChange={(e) => update({ limit: e.currentTarget.value })}
          />
        )}
      </Field>
    </div>
  )
}
