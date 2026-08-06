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
 * ──────────────────────────────────────────────────────────────────────────
 */

import { Fragment } from 'react'
import { XIcon } from 'lucide-react'
import { formatCitation } from '@/core/format'
import {
  DISCLAIMER_TEXT,
  PUBMED_BASE,
  buildGroups,
  pmidOf,
} from '@/core/render'
import { DEFAULT_DISCLAIMER } from '@/core/config'
import type { ListModel, Publication } from '@/core/types'
import { formatIdRef } from '@/core/ids'

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

  const button = (
    <button
      type="button"
      disabled={!removable}
      aria-label={label}
      title={removable ? label : undefined}
      onClick={() => onRemove(pub)}
      className="ms-1.5 inline-flex translate-y-px items-center gap-0.5 rounded-sm border border-transparent px-1 py-px align-baseline text-[0.7rem] text-muted-foreground opacity-60 transition-opacity hover:border-border hover:text-destructive hover:opacity-100 focus-visible:border-border focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:text-muted-foreground"
    >
      <XIcon className="size-3" aria-hidden="true" />
      Remove
    </button>
  )

  // A disabled button fires no pointer events, so its own `title` never shows.
  // The wrapper is what carries the explanation to a mouse; `aria-label` above
  // carries it to a screen reader.
  return removable ? button : <span title={label}>{button}</span>
}

function PreviewItem({
  pub,
  style,
  boldNames,
  onRemove,
}: {
  pub: Publication
  style: Parameters<typeof formatCitation>[1]
  boldNames: readonly string[]
  onRemove?: (pub: Publication) => void
}) {
  const pmid = pmidOf(pub)
  return (
    <li className="publist-item">
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
      {onRemove ? <RemoveControl pub={pub} onRemove={onRemove} /> : null}
    </li>
  )
}

export function PreviewList({
  model,
  onRemove,
}: {
  model: ListModel
  /** Omit to render the list with no controls at all. */
  onRemove?: (pub: Publication) => void
}) {
  const style = model.config.style ?? 'vancouver'
  const boldNames = model.config.boldNames ?? []
  const groups = buildGroups(model)

  const list = (items: Publication[], key: string) => (
    <ol key={key} className="publist-list">
      {items.map((pub) => (
        <PreviewItem
          key={pub.key}
          pub={pub}
          style={style}
          boldNames={boldNames}
          onRemove={onRemove}
        />
      ))}
    </ol>
  )

  // Fragments rather than wrapper `<div>`s: the headings and lists have to stay
  // flat siblings of `<section class="publist">`, exactly as `renderHtml` emits
  // them. A wrapper per group would make every group's heading a `:first-child`
  // and collapse the spacing the preview stylesheet puts between them.
  return (
    <section className="publist">
      {groups.map((group) => {
        if (group.items.length === 0) return null
        return (
          <Fragment key={group.key}>
            {group.label === '' ? null : (
              <h3 className="publist-heading">{group.label}</h3>
            )}
            {group.sections
              ? group.sections
                  .filter((section) => section.items.length > 0)
                  .map((section) => (
                    <Fragment key={section.key}>
                      <h4 className="publist-subheading">{section.label}</h4>
                      {list(section.items, section.key)}
                    </Fragment>
                  ))
              : list(group.items, group.key)}
          </Fragment>
        )
      })}
      {(model.config.disclaimer ?? DEFAULT_DISCLAIMER) === 'show' ? (
        <p className="publist-disclaimer">{DISCLAIMER_TEXT}</p>
      ) : null}
    </section>
  )
}
