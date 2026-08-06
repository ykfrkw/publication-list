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
import { CheckboxField, Field, SelectField } from './Field'
import type { WizardDraft } from '../lib/wizard'

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
