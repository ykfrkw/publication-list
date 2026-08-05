/**
 * `ListModel` → output strings.
 *
 * Every renderer here is a pure function of the model: no DOM, no framework,
 * no network. The embed bundle and the wizard's export buttons both call into
 * this module, which is why it cannot depend on either.
 *
 * All renderers honour `model.config`:
 *   - `groupBy`  — 'category' (default) | 'year' | 'none'
 *   - `japanese` — 'separate' (default, a trailing Japanese-language section)
 *                | 'merge' (inline with everything else) | 'hide' (dropped)
 *   - `limit`    — cap on the number of publications, applied after sorting
 *                  and before grouping
 *
 * Upstream metadata is untrusted; every renderer that emits markup routes it
 * through `escapeHtml` / `escapeUrl` from `./format`.
 */

import type { ListModel, Publication } from './types'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './types'
import {
  escapeHtml,
  escapeUrl,
  formatCitation,
  formatCitationPlain,
} from './format'

// ───────────────────────────────────────────────────────── credit link ──

/*
 * THE CREDIT LINK — READ BEFORE TOUCHING
 *
 * Google's link-spam policy names "creating links from widgets that are
 * distributed across various sites". The pattern it describes is a *runtime*
 * one: a script that a site owner pastes in, which then injects a link into
 * their page on every load. So this project deliberately splits the two:
 *
 *   - The credit link lives ONLY in the static HTML snippet the user copies
 *     out of the wizard. It sits in their own markup, where they can see it,
 *     edit it and delete it. `renderHtml(model, { credit: true })` is the one
 *     and only place that emits it, and it emits it at most once per list.
 *   - `src/embed/entry.ts` — the script that runs on other people's pages —
 *     must never create, modify or remove a `.publist-credit` node. Not even
 *     to "preserve" it across a re-render. It does not touch it at all.
 *
 * That separation is the whole point. If the runtime script ever starts
 * emitting the link, this stops being a static attribution the site owner
 * chose to keep and becomes exactly the distributed-widget link pattern.
 *
 * Consequences for anyone editing this file:
 *   - `CREDIT_HTML` is a constant. The anchor text ("Publication List
 *     Generator") and the href are hardcoded and must never become
 *     parameters — a caller-supplied anchor is keyword-stuffing waiting to
 *     happen.
 *   - No `rel` attribute. The link is intentionally dofollow.
 *   - `CREDIT_SELECTOR` is exported so the embed bundle can assert, in tests,
 *     that it never went near it.
 */

/** The exact credit markup. Never build this string anywhere else. */
export const CREDIT_HTML =
  '<p class="publist-credit">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>'

/** Selector the embed bundle must treat as untouchable. */
export const CREDIT_SELECTOR = '.publist-credit'

// ───────────────────────────────────────────────────────────── grouping ──

/** Heading for the trailing section produced by `japanese: 'separate'`. */
export const JAPANESE_GROUP_LABEL = 'Japanese-language publications'

/** Heading used when a publication carries no usable year under `groupBy: 'year'`. */
const UNDATED_LABEL = 'Undated'

const PUBMED_BASE = 'https://pubmed.ncbi.nlm.nih.gov/'

export interface RenderGroup {
  /** stable identifier, e.g. "category:original", "year:2024", "japanese" */
  key: string
  /** heading text; empty string means "render no heading" */
  label: string
  items: Publication[]
}

function isJapanese(pub: Publication): boolean {
  return pub.language === 'ja'
}

/** Newest first; ties broken by month, then title, so output is stable. */
function comparePublications(a: Publication, b: Publication): number {
  const ay = typeof a.year === 'number' ? a.year : 0
  const by = typeof b.year === 'number' ? b.year : 0
  if (ay !== by) return by - ay
  const am = a.month ?? 0
  const bm = b.month ?? 0
  if (am !== bm) return bm - am
  return (a.title ?? '').localeCompare(b.title ?? '')
}

function groupByCategory(pubs: Publication[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const category of CATEGORY_ORDER) {
    const items = pubs.filter((p) => (p.category ?? 'other') === category)
    if (items.length === 0) continue
    groups.push({
      key: `category:${category}`,
      label: CATEGORY_LABELS[category],
      items,
    })
  }
  return groups
}

function groupByYear(pubs: Publication[]): RenderGroup[] {
  const years: number[] = []
  for (const pub of pubs) {
    const year = typeof pub.year === 'number' && pub.year > 0 ? pub.year : 0
    if (!years.includes(year)) years.push(year)
  }
  // Descending, with the undated bucket (0) last.
  years.sort((a, b) => {
    if (a === 0) return 1
    if (b === 0) return -1
    return b - a
  })
  return years.map((year) => ({
    key: `year:${year === 0 ? 'undated' : year}`,
    label: year === 0 ? UNDATED_LABEL : String(year),
    items: pubs.filter(
      (p) => (typeof p.year === 'number' && p.year > 0 ? p.year : 0) === year,
    ),
  }))
}

/**
 * Turn a model into the ordered sections every renderer shares.
 *
 * Order of operations matters: `japanese: 'hide'` removes records before the
 * `limit` is applied, so a limit of 10 yields 10 visible entries rather than
 * 10 minus however many Japanese-language records happened to sort in first.
 * Under `japanese: 'separate'` the Japanese records are pulled out *after* the
 * limit and always land in a single trailing section.
 */
export function buildGroups(model: ListModel): RenderGroup[] {
  const japanese = model.config.japanese ?? 'separate'
  const groupBy = model.config.groupBy ?? 'category'

  let pubs = [...(model.publications ?? [])]
  if (japanese === 'hide') pubs = pubs.filter((p) => !isJapanese(p))
  pubs.sort(comparePublications)

  const limit = model.config.limit
  if (typeof limit === 'number' && limit > 0) pubs = pubs.slice(0, limit)

  const main = japanese === 'separate' ? pubs.filter((p) => !isJapanese(p)) : pubs
  const jp = japanese === 'separate' ? pubs.filter(isJapanese) : []

  let groups: RenderGroup[]
  switch (groupBy) {
    case 'year':
      groups = groupByYear(main)
      break
    case 'none':
      groups = main.length > 0 ? [{ key: 'all', label: '', items: main }] : []
      break
    case 'category':
    default:
      groups = groupByCategory(main)
      break
  }

  if (jp.length > 0) {
    groups.push({ key: 'japanese', label: JAPANESE_GROUP_LABEL, items: jp })
  }
  return groups
}

function styleOf(model: ListModel) {
  return model.config.style ?? 'vancouver'
}

function boldNamesOf(model: ListModel): readonly string[] {
  return model.config.boldNames ?? []
}

/** PubMed ids are numeric; anything else is not linked. */
function pmidOf(pub: Publication): string | null {
  const pmid = (pub.pmid ?? '').trim()
  return /^\d+$/.test(pmid) ? pmid : null
}

// ────────────────────────────────────────────────────────────── HTML ──

export interface RenderHtmlOptions {
  /**
   * Emit the credit block. This is the only switch that can produce it, and
   * only the static snippet the user copies should ever be rendered with it.
   */
  credit: boolean
}

function pmidHtml(pub: Publication): string {
  const pmid = pmidOf(pub)
  if (pmid == null) return ''
  return ` <span class="publist-pmid">PMID: <a href="${escapeUrl(PUBMED_BASE + pmid)}" target="_blank">${escapeHtml(pmid)}</a></span>`
}

/**
 * Semantic HTML for injection into a host page.
 *
 * Deliberately unstyled: `<section>` / `<h3>` / `<ol>` / `<li>` inherit the
 * host's typography, and every class is namespaced `publist-` so a host
 * stylesheet can target the list without colliding with anything.
 */
export function renderHtml(model: ListModel, opts: RenderHtmlOptions): string {
  const style = styleOf(model)
  const bold = boldNamesOf(model)
  const out: string[] = ['<section class="publist">']

  for (const group of buildGroups(model)) {
    if (group.items.length === 0) continue
    if (group.label !== '') {
      out.push(`<h3 class="publist-heading">${escapeHtml(group.label)}</h3>`)
    }
    out.push('<ol class="publist-list">')
    for (const pub of group.items) {
      out.push(
        `<li class="publist-item">${formatCitation(pub, style, bold)}${pmidHtml(pub)}</li>`,
      )
    }
    out.push('</ol>')
  }

  // One credit block per rendered list, last child of the section, never more.
  if (opts.credit) out.push(CREDIT_HTML)

  out.push('</section>')
  return out.join('\n')
}

// ────────────────────────────────────────────── WordPress block markup ──

/**
 * Gutenberg block markup, not raw HTML.
 *
 * Hard requirement: a post whose body is raw HTML shows up in the WordPress
 * admin as a single unfixable "Classic"/HTML blob, so the owner can no longer
 * edit it in the block editor. Every element below is wrapped in its
 * `<!-- wp:… -->` / `<!-- /wp:… -->` delimiters for that reason.
 *
 * Never emits the credit block — see the comment on `CREDIT_HTML`.
 */
export function renderWordpressBlocks(model: ListModel): string {
  const style = styleOf(model)
  const bold = boldNamesOf(model)
  const blocks: string[] = []

  for (const group of buildGroups(model)) {
    if (group.items.length === 0) continue

    if (group.label !== '') {
      blocks.push(
        [
          '<!-- wp:heading {"level":3} -->',
          `<h3 class="wp-block-heading">${escapeHtml(group.label)}</h3>`,
          '<!-- /wp:heading -->',
        ].join('\n'),
      )
    }

    const items = group.items
      .map(
        (pub) =>
          `<!-- wp:list-item -->\n<li>${formatCitation(pub, style, bold)}${pmidHtml(pub)}</li>\n<!-- /wp:list-item -->`,
      )
      .join('\n')

    blocks.push(
      [
        '<!-- wp:list {"ordered":true} -->',
        '<ol class="wp-block-list">',
        items,
        '</ol>',
        '<!-- /wp:list -->',
      ].join('\n'),
    )
  }

  return blocks.join('\n\n')
}

// ────────────────────────────────────────────────────────── Markdown ──

/** README / note flavoured output. Uses the unmarked-up citation builder. */
export function renderMarkdown(model: ListModel): string {
  const style = styleOf(model)
  const bold = boldNamesOf(model)
  const chunks: string[] = []

  for (const group of buildGroups(model)) {
    if (group.items.length === 0) continue
    const lines: string[] = []
    if (group.label !== '') lines.push(`### ${group.label}`, '')
    group.items.forEach((pub, i) => {
      const pmid = pmidOf(pub)
      const suffix = pmid == null ? '' : ` PMID: [${pmid}](${PUBMED_BASE}${pmid})`
      lines.push(`${i + 1}. ${formatCitationPlain(pub, style, bold)}${suffix}`)
    })
    chunks.push(lines.join('\n'))
  }

  return chunks.join('\n\n')
}

// ──────────────────────────────────────────────────────────── BibTeX ──

const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  '%': '\\%',
}

function bibtexEscape(value: string): string {
  return value.replace(/[\\~^{}$&#_%]/g, (ch) => BIBTEX_ESCAPES[ch])
}

const MONTH_ABBREVIATIONS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

/** `furukawa2024digital`, uniquified with a/b/c… when two entries collide. */
function bibtexKey(pub: Publication, taken: Set<string>): string {
  // `authors` holds the short form "Furukawa Y", so the family name is the
  // first token; taking the whole string would yield "furukaway".
  const surname = ((pub.authors?.[0] ?? '').trim().split(/\s+/)[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 20)
  const year = typeof pub.year === 'number' && pub.year > 0 ? String(pub.year) : ''
  const word = (pub.title ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .find((w) => w.length > 3)
  const base = `${surname}${year}${word ?? ''}` || 'ref'

  let key = base
  let suffix = 0
  while (taken.has(key)) {
    key = `${base}${String.fromCharCode(97 + (suffix % 26))}`
    suffix++
  }
  taken.add(key)
  return key
}

export function renderBibtex(model: ListModel): string {
  const taken = new Set<string>()
  const entries: string[] = []

  for (const group of buildGroups(model)) {
    for (const pub of group.items) {
      const type = pub.category === 'preprint' ? 'misc' : 'article'
      const fields: string[] = []

      const authors = (pub.authorsFull?.length ? pub.authorsFull : pub.authors) ?? []
      if (authors.length > 0) {
        fields.push(`  author = {${authors.map(bibtexEscape).join(' and ')}}`)
      }
      if (pub.title) fields.push(`  title = {{${bibtexEscape(pub.title)}}}`)
      if (pub.journal) fields.push(`  journal = {${bibtexEscape(pub.journal)}}`)
      if (typeof pub.year === 'number' && pub.year > 0) {
        fields.push(`  year = {${pub.year}}`)
      }
      if (pub.month != null && pub.month >= 1 && pub.month <= 12) {
        fields.push(`  month = {${MONTH_ABBREVIATIONS[pub.month - 1]}}`)
      }
      if (pub.doi) fields.push(`  doi = {${bibtexEscape(pub.doi)}}`)
      const pmid = pmidOf(pub)
      if (pmid != null) fields.push(`  pmid = {${pmid}}`)

      entries.push(
        `@${type}{${bibtexKey(pub, taken)},\n${fields.join(',\n')}\n}`,
      )
    }
  }

  return entries.join('\n\n')
}

// ─────────────────────────────────────────────────────────────── RIS ──

/** RIS is line-oriented; a stray newline in upstream text would corrupt it. */
function risValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function renderRis(model: ListModel): string {
  const records: string[] = []

  for (const group of buildGroups(model)) {
    for (const pub of group.items) {
      const lines: string[] = []
      lines.push(`TY  - ${pub.category === 'preprint' ? 'UNPB' : 'JOUR'}`)

      const authors = (pub.authorsFull?.length ? pub.authorsFull : pub.authors) ?? []
      for (const author of authors) lines.push(`AU  - ${risValue(author)}`)

      if (pub.title) lines.push(`TI  - ${risValue(pub.title)}`)
      if (pub.journal) lines.push(`JO  - ${risValue(pub.journal)}`)
      if (typeof pub.year === 'number' && pub.year > 0) {
        lines.push(`PY  - ${pub.year}`)
        const month =
          pub.month != null && pub.month >= 1 && pub.month <= 12
            ? String(pub.month).padStart(2, '0')
            : ''
        lines.push(`DA  - ${pub.year}/${month}//`)
      }
      if (pub.doi) lines.push(`DO  - ${risValue(pub.doi)}`)
      const pmid = pmidOf(pub)
      if (pmid != null) {
        lines.push(`AN  - ${pmid}`)
        lines.push(`UR  - ${PUBMED_BASE}${pmid}`)
      } else if (pub.doi) {
        lines.push(`UR  - https://doi.org/${risValue(pub.doi)}`)
      }
      lines.push('ER  - ')
      records.push(lines.join('\n'))
    }
  }

  return records.join('\n\n')
}

// ───────────────────────────────────────────────────────── clipboard ──

/**
 * Verbatim from `app.R:379`. Kept word-for-word so the Word output of this
 * version is diffable against the R Shiny version during the parity check.
 */
const CLIPBOARD_DISCLAIMER =
  '[Disclaimer] This list is generated from a combination of ORCID, OpenAlex, and researchmap. If any of these sources contain errors, relevant publications may be missing or unrelated publications may be included. Please verify the final list.'

const CLIPBOARD_TRAILER_PLAIN =
  'Generated with Publication List Generator (https://yukifurukawa.jp/publication-list-generator/)'

export interface ClipboardPayload {
  /** `text/html` flavour of the `ClipboardItem` */
  html: string
  /** `text/plain` flavour of the `ClipboardItem` */
  plain: string
}

/**
 * The Word-paste payload, ported from `app.R:375-412`.
 *
 * The inline `font-family:serif;font-size:12pt` on the wrapper and the
 * `font-size:16px;font-weight:bold` on each section heading are not
 * decoration: pasting a `<div>` with no explicit sizing into Word makes Word
 * guess, and it guesses wrong (headings come out at body size, body text at
 * heading size). Do not replace them with classes — the clipboard has no
 * stylesheet to resolve them against.
 *
 * This is NOT the credit block: it carries no `publist-credit` class, it is
 * pasted into a document rather than published on a page, and it comes
 * straight from the R version being replaced.
 */
export function renderClipboard(model: ListModel): ClipboardPayload {
  const style = styleOf(model)
  const bold = boldNamesOf(model)
  const groups = buildGroups(model)

  const htmlParts: string[] = []
  const plainParts: string[] = []

  for (const group of groups) {
    if (group.items.length === 0) continue
    const heading =
      group.label === ''
        ? `Publications (${group.items.length})`
        : `${group.label} (${group.items.length})`

    htmlParts.push(
      `<p style="font-size:16px;font-weight:bold;margin-bottom:8px;">${escapeHtml(heading)}</p>`,
    )
    plainParts.push(heading, '')

    htmlParts.push('<ol>')
    group.items.forEach((pub, i) => {
      htmlParts.push(
        `<li>${formatCitation(pub, style, bold)}${pmidHtml(pub)}</li>`,
      )
      const pmid = pmidOf(pub)
      const suffix = pmid == null ? '' : ` PMID: ${pmid}`
      plainParts.push(
        `${i + 1}. ${formatCitationPlain(pub, style, bold)}${suffix}`,
      )
    })
    htmlParts.push('</ol>')
    plainParts.push('')
  }

  const html =
    `<div style="font-family:serif;font-size:12pt;">` +
    `<p style="color:red;font-weight:bold;">${escapeHtml(CLIPBOARD_DISCLAIMER)}</p>` +
    htmlParts.join('') +
    `</div>` +
    `<p style="font-size:9pt;color:gray;">Generated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>`

  const plain =
    `${CLIPBOARD_DISCLAIMER}\n\n` +
    `${plainParts.join('\n').trimEnd()}\n` +
    `${CLIPBOARD_TRAILER_PLAIN}`

  return { html, plain }
}
