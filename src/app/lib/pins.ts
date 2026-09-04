/**
 * The pure half of the preview's pinning UI: what a category change or a
 * within-section drag writes into the draft, and how the draft's pins are
 * overlaid onto a built model so the preview and the snippet update without a
 * rebuild.
 *
 * React-free on purpose, like `wizard.ts`: jsdom cannot exercise a real
 * drag-and-drop, so the interesting logic lives here as plain functions and
 * `PreviewList.tsx` only wires events to them. See `__tests__/pins.test.ts`.
 */

import { categorizeGyoseki } from '@/core/gyoseki'
import { formatCategoryPinRef } from '@/core/ids'
import type {
  GyosekiCategory,
  ListConfig,
  ListModel,
  Publication,
} from '@/core/types'
import { projectCategoryPins, type WizardDraft } from './wizard'

/**
 * Write (or clear) one record's category pin.
 *
 * Choosing the category the record would land in anyway — its
 * `categorizeGyoseki` result — *deletes* the pin instead of storing a no-op
 * one: a pin that restates the default would survive metadata fixes upstream
 * and silently keep overriding them, and it would dirty the config (and the
 * `configHash` cache key) for nothing.
 *
 * A record with no pin reference (`formatCategoryPinRef` returns `undefined`)
 * cannot be addressed and the draft comes back untouched; the control for one
 * is disabled in the UI, so this is belt and braces.
 */
export function setCategoryPin(
  draft: WizardDraft,
  pub: Publication,
  category: GyosekiCategory,
): WizardDraft {
  const ref = formatCategoryPinRef(pub)
  if (ref == null) return draft

  const next = { ...draft.categoryPins }
  if (category === categorizeGyoseki(pub)) {
    if (!(ref in next)) return draft
    delete next[ref]
  } else {
    if (next[ref] === category) return draft
    next[ref] = category
  }
  return { ...draft, categoryPins: next }
}

/** One innermost list of the preview: a year section, or a flat group. */
export interface SectionRefs {
  /** the render key — `RenderSection.key` / `RenderGroup.key` */
  key: string
  /** pin refs of the section's items, in display order; ref-less items omitted */
  refs: readonly string[]
}

/**
 * Recompute `orderPins` after the user reordered one section of the preview.
 *
 * THE RULE: the new `orderPins` is the concatenation of every section's
 * current display order — but ONLY for sections the user has touched at least
 * once — taken in section (display) order. A section counts as touched when it
 * is the one being reordered now, or when any of its displayed refs already
 * appears in the existing pins, which is exactly the trace a previous touch
 * left behind. Untouched sections contribute nothing, so the default
 * newest-first sort keeps ruling them and a new paper still enters them where
 * recency puts it.
 *
 * Writing the changed section wholesale (not just the moved record) is what
 * makes the order the user sees the order that is saved: `applyOrderPins`
 * moves pinned records to the *front* of their section, so a partial write
 * would reshuffle the records around the one that moved.
 *
 * Existing pins for refs displayed in no section right now — a record hidden
 * by a date filter or a limit — are kept, appended at the end, so narrowing
 * the list temporarily cannot erase ordering work.
 */
export function rebuildOrderPins(
  sections: readonly SectionRefs[],
  existing: readonly string[],
  changedKey: string,
  changedRefs: readonly string[],
): string[] {
  const existingSet = new Set(existing)
  const out: string[] = []
  const used = new Set<string>()
  const push = (ref: string) => {
    if (used.has(ref)) return
    used.add(ref)
    out.push(ref)
  }

  for (const section of sections) {
    const touched =
      section.key === changedKey ||
      section.refs.some((ref) => existingSet.has(ref))
    if (!touched) continue
    const refs = section.key === changedKey ? changedRefs : section.refs
    for (const ref of refs) push(ref)
  }

  const displayed = new Set(sections.flatMap((section) => [...section.refs]))
  for (const ref of existing) if (!displayed.has(ref)) push(ref)

  return out
}

/**
 * Overlay the draft's taxonomy and pins onto a built model.
 *
 * This is what makes a pin take effect the moment it is made: the preview and
 * the snippet both render from the model, and a network rebuild just to move
 * one line would be absurd. The overlay does exactly what the pipeline will do
 * on the next build — categorize with `categorizeGyoseki`, then apply the
 * pins — so the optimistic view and the rebuilt one cannot disagree.
 *
 * The baked `gyosekiCategory` on each record is deliberately ignored and
 * recomputed: it may carry a pin that the user has since *removed*, and an
 * overlay that trusted it could never un-pin anything.
 */
export function overlayDraftPins(
  model: ListModel,
  draft: Pick<WizardDraft, 'taxonomy' | 'categoryPins' | 'orderPins'>,
): ListModel {
  const gyoseki = draft.taxonomy === 'gyoseki'

  const config: ListConfig = { ...model.config }
  delete config.taxonomy
  delete config.categoryPins
  delete config.orderPins
  if (gyoseki) config.taxonomy = 'gyoseki'
  const categoryPins = projectCategoryPins(draft.categoryPins)
  if (categoryPins.length > 0) config.categoryPins = categoryPins
  if (draft.orderPins.length > 0) config.orderPins = [...draft.orderPins]

  let publications = model.publications
  if (gyoseki) {
    publications = publications.map((pub) => {
      const ref = formatCategoryPinRef(pub)
      const category =
        (ref != null ? draft.categoryPins[ref] : undefined) ??
        categorizeGyoseki(pub)
      return pub.gyosekiCategory === category
        ? pub
        : { ...pub, gyosekiCategory: category }
    })
  }

  return { ...model, config, publications }
}
