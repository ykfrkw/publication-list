/**
 * The wizard's preview of the built list, composed in React.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `renderHtml`
 *
 * The preview used to be one `dangerouslySetInnerHTML` blob from
 * `renderHtml(model, { credit: false })`. That is the right shape for output
 * the user copies and the wrong one for a preview that needs a control per
 * publication: a Remove button per record needs per-record DOM, and reaching
 * into a finished HTML string to add one is how a renderer ends up with two
 * implementations that drift.
 *
 * So the split is by *purpose*, not by markup:
 *
 *   - The grouping — categories, the year dividers inside them, the trailing
 *     Japanese-language section, the sort, the limit — is NOT reimplemented
 *     here. It comes from `buildGroups`, the same exported function every
 *     renderer in `core/render.ts` walks. Neither is the citation: that is
 *     `formatCitation`, and the PMID link is `pmidOf` + `PUBMED_BASE` from the
 *     same module.
 *   - Only the *shell* is JSX, and it emits the same elements and the same
 *     `publist-` class names `renderHtml` does, so the preview keeps looking
 *     like the page the embed will render.
 *
 * **Nothing in this file reaches any output.** `renderHtml`, the WordPress
 * blocks, the Markdown / BibTeX / RIS exports, the static HTML, the clipboard
 * payload and the embed bundle all still go through `core/render.ts` and know
 * nothing about it. The Remove controls are a wizard affordance and must never
 * appear in anything anyone copies or embeds — `RemoveControl.test.tsx` pins
 * that by reading what the copy buttons actually put on the clipboard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PINNING: DRAG AND DROP, AND THE SELECT BESIDE IT
 *
 * When the caller supplies `onOrderPins`, every record with a pin reference
 * gets a drag handle. Dragging within a section rewrites that section's
 * explicit order (`rebuildOrderPins` in `../lib/pins.ts` owns the rule);
 * dragging into another 業績集 section re-files the record there
 * (`onCategoryPin`). Under the gyoseki taxonomy each record also gets a small
 * section `<select>` doing the same re-filing — the keyboard- and
 * screen-reader-reachable spelling of the same action, and the only way to
 * reach a section that is currently empty (an empty section renders no
 * heading, so there is nothing to drop onto).
 *
 * The decisions themselves are not made here: drag events are translated into
 * the pure helpers of `../lib/pins.ts`, which is where they are tested — a
 * real drag cannot be exercised under jsdom.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { Fragment } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCitation } from '@/core/format'
import { categorizeGyoseki } from '@/core/gyoseki'
import {
  DISCLAIMER_TEXT,
  PUBMED_BASE,
  TRAILER_STYLE_PROPS,
  buildGroups,
  headingLevelsOf,
  pmidOf,
} from '@/core/render'
import { DEFAULT_DISCLAIMER } from '@/core/config'
import {
  GYOSEKI_LABELS,
  GYOSEKI_ORDER,
  type GyosekiCategory,
  type ListModel,
  type Publication,
} from '@/core/types'
import { formatCategoryPinRef, formatIdRef } from '@/core/ids'
import { rebuildOrderPins, type SectionRefs } from '../lib/pins'

/**
 * Why a record can be beyond the reach of Remove.
 *
 * `include` / `exclude` hold identifiers, so a record carrying neither a DOI
 * nor a PMID cannot be named in either list — `formatIdRef` returns `null` and
 * there is nothing to write. Rendering a button that quietly did nothing would
 * be worse than not offering one, so it is disabled and says this instead. The
 * review queue makes the same statement about the same records.
 */
export const UNREMOVABLE_REASON =
  'This record has neither a DOI nor a PMID, so there is no identifier to exclude it by. Correct it in ORCID, PubMed or researchmap instead.'

/**
 * Same statement about the pins: they address records by `doi:` / `pmid:` /
 * `rm:` reference (`formatCategoryPinRef`), so a record with none of the three
 * has no handle a saved order or section override could name it by.
 */
export const UNPINNABLE_REASON =
  'This record has no DOI, PMID or researchmap id, so a saved position or ' +
  'section for it could not name it. Correct it in the source it came from ' +
  'instead.'

function RemoveControl({
  pub,
  onRemove,
}: {
  pub: Publication
  onRemove: (pub: Publication) => void
}) {
  const removable = formatIdRef(pub) != null
  const title = (pub.title ?? '').trim() || pub.key
  const label = removable
    ? `Remove “${title}” from the list`
    : `Cannot remove “${title}”. ${UNREMOVABLE_REASON}`

  /*
   * The design system's ghost button, not a hand-rolled one.
   *
   * It was a raw `<button>` at `text-[0.7rem]` (11.2px) in
   * `text-muted-foreground` under `opacity-60`. The opacity is what made it a
   * problem: 60% of `oklch(0.556 0 0)` composited on the card's white leaves
   * roughly `#ababab`, about 2.3:1 against that background — well under the
   * 4.5:1 WCAG AA needs for text this size, and 11.2px is not large text under
   * any reading of the rule.
   *
   * `variant="ghost"` keeps it quiet the honest way — no background until it is
   * hovered — and `size="sm"` brings it to 12.8px from the shared scale. The
   * colour stays `text-muted-foreground` with no opacity on top, which measures
   * 4.7:1 on the light card (`oklch(0.556)` against `oklch(1)`) and 6.9:1 on
   * the dark one (`oklch(0.708)` against `oklch(0.205)`). Both pass AA.
   */
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!removable}
      aria-label={label}
      title={removable ? label : undefined}
      onClick={() => onRemove(pub)}
      className="ms-1.5 inline-flex translate-y-px align-baseline text-muted-foreground hover:text-destructive disabled:cursor-not-allowed"
    >
      <XIcon aria-hidden="true" />
      Remove
    </Button>
  )

  // A disabled button fires no pointer events, so its own `title` never shows.
  // The wrapper is what carries the explanation to a mouse; `aria-label` above
  // carries it to a screen reader.
  return removable ? button : <span title={label}>{button}</span>
}

/**
 * The keyboard/screen-reader spelling of the cross-section drag: a native
 * `<select>` over all ten 業績集 sections. Choosing the record's natural
 * category deletes the pin rather than storing a no-op one — that logic lives
 * with the caller (`setCategoryPin` in `../lib/pins.ts`); this control only
 * reports the chosen category.
 */
function CategorySelect({
  pub,
  onCategoryPin,
}: {
  pub: Publication
  onCategoryPin: (pub: Publication, category: GyosekiCategory) => void
}) {
  const pinRef = formatCategoryPinRef(pub)
  const title = (pub.title ?? '').trim() || pub.key
  const value = pub.gyosekiCategory ?? categorizeGyoseki(pub)
  const label =
    pinRef != null
      ? `Section for “${title}”`
      : `Cannot re-file “${title}”. ${UNPINNABLE_REASON}`

  const select = (
    <select
      value={value}
      disabled={pinRef == null}
      aria-label={label}
      title={pinRef != null ? label : undefined}
      onChange={(e) =>
        onCategoryPin(pub, e.currentTarget.value as GyosekiCategory)
      }
      className="publist-category-select ms-1.5 h-6 max-w-44 truncate rounded border border-input bg-transparent px-1 align-baseline text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
    >
      {GYOSEKI_ORDER.map((category) => (
        <option key={category} value={category}>
          {GYOSEKI_LABELS[category]}
        </option>
      ))}
    </select>
  )

  // Same wrapper trick as RemoveControl: a disabled control shows no `title`
  // of its own, so the reason rides on a span around it.
  return pinRef != null ? select : <span title={label}>{select}</span>
}

/** Everything inside an item's `<li>` except the drag handle. */
function ItemContent({
  pub,
  style,
  boldNames,
  onRemove,
  onCategoryPin,
}: {
  pub: Publication
  style: Parameters<typeof formatCitation>[1]
  boldNames: readonly string[]
  onRemove?: (pub: Publication) => void
  /** Present only under the gyoseki taxonomy; renders the section select. */
  onCategoryPin?: (pub: Publication, category: GyosekiCategory) => void
}) {
  const pmid = pmidOf(pub)
  return (
    <>
      <span
        // Every field is escaped by `format.ts`; the only markup here is <b>,
        // <em> and one doi.org link — the same string `renderHtml` emits.
        dangerouslySetInnerHTML={{
          __html: formatCitation(pub, style, boldNames),
        }}
      />
      {pmid == null ? null : (
        <>
          {' '}
          <span className="publist-pmid">
            PMID:{' '}
            <a href={PUBMED_BASE + pmid} target="_blank" rel="noreferrer">
              {pmid}
            </a>
          </span>
        </>
      )}
      {onCategoryPin ? (
        <CategorySelect pub={pub} onCategoryPin={onCategoryPin} />
      ) : null}
      {onRemove ? <RemoveControl pub={pub} onRemove={onRemove} /> : null}
    </>
  )
}

function PreviewItem({
  pub,
  style,
  boldNames,
  onRemove,
  onCategoryPin,
}: {
  pub: Publication
  style: Parameters<typeof formatCitation>[1]
  boldNames: readonly string[]
  onRemove?: (pub: Publication) => void
  onCategoryPin?: (pub: Publication, category: GyosekiCategory) => void
}) {
  return (
    <li className="publist-item">
      <ItemContent
        pub={pub}
        style={style}
        boldNames={boldNames}
        onRemove={onRemove}
        onCategoryPin={onCategoryPin}
      />
    </li>
  )
}

/**
 * A `PreviewItem` that can be dragged.
 *
 * The listeners sit on a dedicated handle rather than on the `<li>`: the item
 * body holds a link, a select and a button, and a whole-row activator would
 * fight every one of them for the pointer and the keyboard. A record with no
 * pin reference keeps the handle — greyed out, with the reason in its tooltip
 * — because a row where the handle silently vanished would read as a bug, not
 * a rule.
 */
function SortablePreviewItem({
  pub,
  style,
  boldNames,
  onRemove,
  onCategoryPin,
}: {
  pub: Publication
  style: Parameters<typeof formatCitation>[1]
  boldNames: readonly string[]
  onRemove?: (pub: Publication) => void
  onCategoryPin?: (pub: Publication, category: GyosekiCategory) => void
}) {
  const pinRef = formatCategoryPinRef(pub)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    // Sortable ids are the pin refs, because a drag's outcome is written in
    // refs. The dedupe key stands in for an unpinnable record so the hook has
    // a unique id, but with `disabled` set it neither drags nor receives.
    id: pinRef ?? pub.key,
    disabled: pinRef == null,
  })
  const title = (pub.title ?? '').trim() || pub.key
  const handleLabel =
    pinRef != null
      ? `Drag to reorder “${title}”, or drop it on another section`
      : `Cannot move “${title}”. ${UNPINNABLE_REASON}`

  const handle = (
    <button
      type="button"
      disabled={pinRef == null}
      aria-label={handleLabel}
      title={pinRef != null ? handleLabel : undefined}
      className="me-1.5 inline-flex size-5 cursor-grab items-center justify-center rounded align-text-bottom text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon aria-hidden="true" className="size-3.5" />
    </button>
  )

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`publist-item${isDragging ? ' opacity-60' : ''}`}
    >
      {pinRef != null ? handle : <span title={handleLabel}>{handle}</span>}
      <ItemContent
        pub={pub}
        style={style}
        boldNames={boldNames}
        onRemove={onRemove}
        onCategoryPin={onCategoryPin}
      />
    </li>
  )
}

/** One innermost rendered list, with the 業績集 section it belongs to. */
interface FlatSection {
  key: string
  category: GyosekiCategory | null
  items: Publication[]
}

/** The gyoseki category a group key names, or `null` for every other group. */
function gyosekiCategoryOf(groupKey: string): GyosekiCategory | null {
  if (!groupKey.startsWith('gyoseki:')) return null
  const rest = groupKey.slice('gyoseki:'.length)
  return (GYOSEKI_ORDER as readonly string[]).includes(rest)
    ? (rest as GyosekiCategory)
    : null
}

const refsOf = (items: readonly Publication[]): string[] =>
  items
    .map(formatCategoryPinRef)
    .filter((ref): ref is string => ref != null)

export function PreviewList({
  model,
  onRemove,
  onCategoryPin,
  onOrderPins,
}: {
  model: ListModel
  /** Omit to render the list with no controls at all. */
  onRemove?: (pub: Publication) => void
  /**
   * Re-file one record under another 業績集 section (a category pin). Only
   * meaningful — and only rendered — when the model's taxonomy is `'gyoseki'`.
   */
  onCategoryPin?: (pub: Publication, category: GyosekiCategory) => void
  /**
   * Adopt a recomputed `orderPins` after a drag. Its presence is what switches
   * the drag-and-drop on, in either taxonomy.
   */
  onOrderPins?: (orderPins: string[]) => void
}) {
  const style = model.config.style ?? 'vancouver'
  const boldNames = model.config.boldNames ?? []
  const gyoseki = model.config.taxonomy === 'gyoseki'
  const groups = buildGroups(model)
  const editable = onOrderPins != null
  const categoryPin = gyoseki && onCategoryPin != null ? onCategoryPin : undefined

  const sensors = useSensors(
    // The activation distance is what keeps a plain click a click: without it
    // every press on the handle starts a zero-length drag and the browser
    // never sees the click at all.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /*
   * The same two levels the string renderers use, from the same function.
   *
   * `'auto'` resolves to the fallback here, and that is the honest answer
   * rather than a shortcoming: the preview sits inside this wizard, not inside
   * the page the list will be pasted into, so there is nothing to measure and
   * guessing would show a level the embed may not use. What the preview is
   * showing is the shape — headings above their years — which does not change
   * with the level.
   */
  const { heading, sub } = headingLevelsOf(model)
  const Heading = `h${heading}` as 'h3'
  const SubHeading = `h${sub}` as 'h4'

  // Every innermost list, flattened, in display order — the shape both drag
  // outcomes are computed against. Rebuilt per render; the preview renders a
  // few dozen rows and `buildGroups` above already did the heavy walk.
  const sections: FlatSection[] = []
  for (const group of groups) {
    const category = gyosekiCategoryOf(group.key)
    if (group.sections) {
      for (const section of group.sections) {
        if (section.items.length > 0) {
          sections.push({ key: section.key, category, items: section.items })
        }
      }
    } else if (group.items.length > 0) {
      sections.push({ key: group.key, category, items: group.items })
    }
  }

  const sectionOfRef = (ref: string): FlatSection | undefined =>
    sections.find((section) =>
      section.items.some((pub) => formatCategoryPinRef(pub) === ref),
    )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over == null || onOrderPins == null) return
    const activeRef = String(active.id)
    const overRef = String(over.id)
    const from = sectionOfRef(activeRef)
    const to = sectionOfRef(overRef)
    if (from == null || to == null) return

    if (from.key === to.key) {
      // A drop within the section: rewrite that section's explicit order.
      if (activeRef === overRef) return
      const refs = refsOf(from.items)
      const next = arrayMove(refs, refs.indexOf(activeRef), refs.indexOf(overRef))
      const sectionRefs: SectionRefs[] = sections.map((section) => ({
        key: section.key,
        refs: refsOf(section.items),
      }))
      onOrderPins(
        rebuildOrderPins(
          sectionRefs,
          model.config.orderPins ?? [],
          from.key,
          next,
        ),
      )
      return
    }

    // A drop on another section: under the gyoseki taxonomy that re-files the
    // record there (`setCategoryPin` in the caller deletes the pin when the
    // target is the record's natural category). In the standard taxonomy the
    // sections are computed from record metadata and cannot be assigned, so a
    // cross-section drop is a no-op — as is a drop on a different *year* of
    // the same gyoseki section, which no pin can express either.
    if (categoryPin != null && to.category != null && to.category !== from.category) {
      const pub = from.items.find((p) => formatCategoryPinRef(p) === activeRef)
      if (pub) categoryPin(pub, to.category)
    }
  }

  const list = (items: Publication[], key: string) => {
    const rows = items.map((pub) =>
      editable ? (
        <SortablePreviewItem
          key={pub.key}
          pub={pub}
          style={style}
          boldNames={boldNames}
          onRemove={onRemove}
          onCategoryPin={categoryPin}
        />
      ) : (
        <PreviewItem
          key={pub.key}
          pub={pub}
          style={style}
          boldNames={boldNames}
          onRemove={onRemove}
          onCategoryPin={categoryPin}
        />
      ),
    )
    const body = (
      <ol key={key} className="publist-list">
        {rows}
      </ol>
    )
    if (!editable) return body
    return (
      <SortableContext
        key={key}
        items={refsOf(items)}
        strategy={verticalListSortingStrategy}
      >
        {body}
      </SortableContext>
    )
  }

  // Fragments rather than wrapper `<div>`s: the headings and lists have to stay
  // flat siblings of `<section class="publist">`, exactly as `renderHtml` emits
  // them. A wrapper per group would make every group's heading a `:first-child`
  // and collapse the spacing the preview stylesheet puts between them.
  const content = (
    <section className="publist">
      {groups.map((group) => {
        if (group.items.length === 0) return null
        return (
          <Fragment key={group.key}>
            {group.label === '' ? null : (
              <Heading className="publist-heading">{group.label}</Heading>
            )}
            {group.sections
              ? group.sections
                  .filter((section) => section.items.length > 0)
                  .map((section) => (
                    <Fragment key={section.key}>
                      <SubHeading className="publist-subheading">
                        {section.label}
                      </SubHeading>
                      {list(section.items, section.key)}
                    </Fragment>
                  ))
              : list(group.items, group.key)}
          </Fragment>
        )
      })}
      {(model.config.disclaimer ?? DEFAULT_DISCLAIMER) === 'show' ? (
        // Same inline treatment the string renderers put on this line, from the
        // same constants, so the preview shows the size the user will paste
        // rather than a preview-only approximation of it.
        <p className="publist-disclaimer" style={TRAILER_STYLE_PROPS}>
          {DISCLAIMER_TEXT}
        </p>
      ) : null}
    </section>
  )

  if (!editable) return content
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {content}
    </DndContext>
  )
}
