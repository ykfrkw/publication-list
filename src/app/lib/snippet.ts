/**
 * The copy-and-paste snippets: JS embed, iframe fallback, and the `data-*`
 * projection of a `ListConfig` that both of them share.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CREDIT LINK
 *
 * This module never builds the credit anchor. `buildEmbedSnippet` writes out
 * `CREDIT_HTML` verbatim, and `render.ts` owns that markup — the anchor text
 * and href are constants there, not parameters here, and nothing in the UI may
 * hand the user a way to edit them. Read the comment above `CREDIT_HTML` in
 * `src/core/render.ts` before changing anything below.
 *
 * The line is written here rather than left to `renderHtml` because the
 * snapshot it used to live inside is optional — see the note on
 * `buildEmbedSnippet`. It is still static markup in the snippet the user
 * copies, which is the property that matters: `src/embed/entry.ts` neither
 * creates nor removes it at runtime.
 *
 * The checkbox controls exactly one thing, spelled two ways because the two
 * embed routes carry it differently: the script snippet gets the boolean
 * read here, and the iframe snippet gets `credit=0` in the frame's URL, which
 * `src/widget/main.ts` reads and honours. Off means zero credit blocks either
 * way, and no other difference whatsoever — no nag, no watermark, no reduced
 * output.
 *
 * THE SOURCE DISCLAIMER is a separate switch: it is an ordinary `ListConfig`
 * field, so it reaches the script snippet through `showsDisclaimer(model.config)`
 * beside the credit and through the `data-disclaimer` attribute below, and the
 * iframe snippet through the same attribute projected onto the query string.
 * Turning one off never affects the other.
 * ──────────────────────────────────────────────────────────────────────────
 */

import {
  CREDIT_HTML,
  DISCLAIMER_HTML,
  renderHtml,
  showsDisclaimer,
} from '@/core/render'
import {
  DEFAULT_DISCLAIMER,
  DEFAULT_GROUP_BY,
  DEFAULT_HEADING_LEVEL,
  encodeListValue,
  headingLevelFor,
} from '@/core/config'
import { encodeSeed } from '@/core/seeds'
import { escapeHtml } from '@/core/format'
import type { ListConfig, ListModel } from '@/core/types'

/** Where the built assets live once deployed. */
export const SITE_BASE = 'https://ykfrkw.github.io/publication-list/'
export const EMBED_SCRIPT_URL = `${SITE_BASE}embed.js`
export const WIDGET_URL = `${SITE_BASE}widget.html`

export type DataAttribute = readonly [name: string, value: string]

function attrEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * `ListConfig` → the `data-*` attributes `parseConfigFromDataset` reads back.
 *
 * Exact inverse of `config.ts`: comma-joined lists, the same attribute names,
 * the same value vocabulary. Only non-default values are emitted, except
 * `data-style`, which is always written out — the citation style is the thing
 * a site owner is most likely to want to change by hand later, and having it
 * present makes that obvious.
 *
 * Every element of a joined list goes through `encodeListValue` first, so a
 * value containing a comma survives the join instead of becoming two values.
 * `splitList` in `core/config.ts` is the other half; read the note above it.
 */
export function configToDataAttributes(config: ListConfig): DataAttribute[] {
  const out: DataAttribute[] = []
  const push = (name: string, value: string | undefined) => {
    if (value != null && value !== '') out.push([name, value] as const)
  }
  /** Join a list the way `splitList` reads one back. */
  const joinList = (values: readonly string[] | undefined) =>
    values?.map(encodeListValue).join(',')

  // `encodeSeed` writes a bare id unchanged and a time-bounded one as
  // `id@from:to:grace`, which `decodeSeed` reads back — so a member window
  // survives the inline-attribute route as well as the JSON one. What cannot
  // travel here is the `label` and the window hung on a *PubMed* seed, because
  // that seed's value is a free-text query with nowhere in it to write them.
  // See `readConfig` in `core/config.ts`.
  //
  // `trust` is the one whose loss would be silent and would matter, so it does
  // travel — beside the query rather than inside it. `data-pubmed-trusted`
  // holds the zero-based positions of the trusted queries within
  // `data-pubmed`, and the two attributes are written here together, in one
  // pass over one array, which is what makes the positions trustworthy.
  push('data-orcid', joinList(config.seeds.orcid?.map(encodeSeed)))
  push('data-researchmap', joinList(config.seeds.researchmap?.map(encodeSeed)))
  push('data-pubmed', joinList(config.seeds.pubmed?.map((s) => s.query)))
  push(
    'data-pubmed-trusted',
    (config.seeds.pubmed ?? [])
      .map((seed, index) => (seed.trust === 'confirmed' ? index : null))
      .filter((index): index is number => index != null)
      .join(','),
  )
  push('data-include', joinList(config.include))
  push('data-exclude', joinList(config.exclude))
  push('data-bold-names', joinList(config.boldNames))

  push('data-style', config.style ?? 'vancouver')
  if (config.groupBy && config.groupBy !== DEFAULT_GROUP_BY) {
    push('data-group-by', config.groupBy)
  }
  // Written out for every value except the default, exactly like `group-by`
  // above — and the default is `'auto'`, so a snippet that says nothing means
  // "match the page you are pasted into". `buildEmbedSnippet` resolves the
  // level *before* calling this when it is baking a snapshot, which is what
  // makes the attribute and the baked markup agree.
  const headingLevel = headingLevelFor(config)
  if (headingLevel !== DEFAULT_HEADING_LEVEL) {
    push('data-heading-level', String(headingLevel))
  }
  if (config.preprints && config.preprints !== 'exclude') {
    push('data-preprints', config.preprints)
  }
  if (config.japanese && config.japanese !== 'separate') {
    push('data-japanese', config.japanese)
  }
  if (config.reviewPolicy && config.reviewPolicy !== 'strict') {
    push('data-review-policy', config.reviewPolicy)
  }
  if (config.disclaimer && config.disclaimer !== DEFAULT_DISCLAIMER) {
    push('data-disclaimer', config.disclaimer)
  }
  push('data-from', config.from)
  push('data-to', config.to)
  if (config.limit != null) push('data-limit', String(config.limit))

  return out
}

function renderAttributes(attrs: readonly DataAttribute[]): string {
  return attrs.map(([name, value]) => `\n  ${name}="${attrEscape(value)}"`).join('')
}

function indent(html: string, pad = '  '): string {
  return html
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n')
}

export interface EmbedSnippetOptions {
  /** Emit the credit block. Default ON in the UI; nothing else depends on it. */
  credit: boolean
  /**
   * Include the pre-rendered list in the snippet.
   *
   * **Default false.** What the snapshot buys is real — the list is in the host
   * page's HTML, so crawlers read it, a visitor with JavaScript off sees it,
   * and the first paint does not wait on the fetch — but it is also the bulk of
   * the snippet, and a wall of markup is what stops someone pasting it at all.
   * So the wizard offers it as a recommended tick rather than imposing it, and
   * this default is the small snippet.
   *
   * Nothing else in the snippet depends on it: the container, its `data-*`
   * attributes, the two trailer lines and the `<script>` are emitted either
   * way. `embed.js` fills an empty container on load (see `hasContent` in
   * `src/embed/entry.ts`, which shows a spinner for exactly this case).
   */
  snapshot?: boolean
}

/**
 * The JS embed snippet: the container, the two trailer lines, the script tag,
 * and — when asked for — a pre-rendered snapshot of the current list.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TRAILER LINES ARE EMITTED HERE AND NOT BY `renderHtml`
 *
 * `renderHtml` puts the disclaimer and the credit *inside* its
 * `<section class="publist">`, which is exactly right for its other callers —
 * the static HTML export, the preview and the iframe widget all hand over that
 * section as the whole output, and the lines belong in it.
 *
 * For this snippet that section is the snapshot, and the snapshot is optional.
 * Emitting the credit inside it would mean an unticked snapshot box silently
 * deleted the attribution — and `src/embed/entry.ts` is forbidden from ever
 * creating either line, so nothing would put it back and nothing would report
 * it. So this function renders the list with both suppressed and writes the two
 * lines itself, as direct children of `.publist-embed` and outside the section.
 *
 * `entry.ts` preserves them by identity wherever in the container they sit —
 * `replaceListContent` treats a preserved node that *is* a direct child as the
 * simple case — and `restore.ts` reads them off the container, so both keep
 * working unchanged.
 * ──────────────────────────────────────────────────────────────────────────
 */
export function buildEmbedSnippet(
  model: ListModel,
  opts: EmbedSnippetOptions,
): string {
  /*
   * THE ONE SETTING THIS FUNCTION DECIDES RATHER THAN COPIES
   *
   * `headingLevel: 'auto'` asks whoever renders the list to measure the page it
   * is on. With a snapshot in the snippet there is a second renderer — this
   * one, running here, with no page to measure — and if the two disagree the
   * headings move on load and the snapshot's readers (crawlers, JavaScript off)
   * keep the wrong outline for good.
   *
   * So the level is resolved once, here, by `headingLevelFor` — the single
   * place the snapshot-dependent default lives, in `core/config.ts` — and the
   * resolved value is used for *both* halves of the snippet: the baked markup
   * below and the `data-heading-level` attribute that `embed.js` will read.
   * They cannot drift, because they are the same number.
   *
   * With no snapshot nothing is resolved: `'auto'` stays `'auto'`, no attribute
   * is written, and `embed.js` does the measuring it is there to do.
   */
  const config: ListConfig = {
    ...model.config,
    headingLevel: headingLevelFor(model.config, opts.snapshot === true),
  }
  const snapshotModel: ListModel = { ...model, config }
  const attrs = configToDataAttributes(config)

  const stamp = (model.generatedAt || '').slice(0, 10)
  const lines: string[] = [`<div class="publist-embed"${renderAttributes(attrs)}>`]

  if (opts.snapshot) {
    lines.push(
      `  <!-- Snapshot${stamp ? ` generated ${stamp}` : ''}. embed.js replaces it with a live list on load. -->`,
      // Both suppressed: the two lines below are the only ones in the snippet,
      // whether or not this branch ran.
      indent(renderHtml(snapshotModel, { credit: false, disclaimer: false })),
    )
  }

  // Same order as `renderHtml` puts them in, for the same reason: the note
  // about where the list came from reads before the note about what built it.
  if (showsDisclaimer(model.config)) lines.push(indent(DISCLAIMER_HTML))
  if (opts.credit) lines.push(indent(CREDIT_HTML))

  lines.push('</div>', `<script src="${EMBED_SCRIPT_URL}" defer></script>`)
  return lines.join('\n')
}

/** `data-*` names → the query-string names `widget.html` reads. */
function attributesToQuery(attrs: readonly DataAttribute[]): string {
  const params = new URLSearchParams()
  for (const [name, value] of attrs) params.set(name.replace(/^data-/, ''), value)
  return params.toString()
}

export interface IframeSnippetOptions {
  /** CSS height before the frame reports its own, in px. */
  fallbackHeight?: number
  /**
   * Same checkbox as `EmbedSnippetOptions.credit`, carried by the frame's URL
   * instead of by the markup. Omitted means on, which is the default the
   * widget applies to a URL that says nothing about it.
   */
  credit?: boolean
}

/**
 * The iframe fallback, for CMSes that strip `<script src>`.
 *
 * The height listener follows the `embed:height` postMessage convention used
 * across yukifurukawa.jp: the frame posts its content height, and the parent
 * validates both the message source and its origin before resizing.
 *
 * The snippet itself contains no credit markup, and cannot: the frame's
 * content is a separate document served from our own origin, so the credit
 * line is rendered *there*, by `src/widget/main.ts`. The checkbox still
 * reaches it — turning it off appends `credit=0` to the frame's `src`, which
 * is the iframe route's equivalent of dropping the `<p class="publist-credit">`
 * line from the script snippet. Neither route can put a runtime-injected link
 * into the host page's markup, which is the thing that must stay true.
 */
export function buildIframeSnippet(
  config: ListConfig,
  opts: IframeSnippetOptions = {},
): string {
  const attrs: DataAttribute[] = configToDataAttributes(config)
  // Only written when it is off: an absent parameter already means "on", and a
  // snippet should not carry a parameter that changes nothing.
  if (opts.credit === false) attrs.push(['credit', '0'] as const)

  const query = attributesToQuery(attrs)
  const src = query === '' ? WIDGET_URL : `${WIDGET_URL}?${query}`
  const height = opts.fallbackHeight ?? 900

  return [
    `<iframe class="publist-frame" title="Publication list" loading="lazy"`,
    `  src="${escapeHtml(src)}"`,
    `  style="display:block;width:100%;border:0;height:${height}px;"></iframe>`,
    '<script>',
    '(function () {',
    "  window.addEventListener('message', function (e) {",
    '    var d = e.data;',
    "    if (!d || d.type !== 'embed:height') return;",
    '    var h = parseInt(d.height, 10);',
    '    if (!(h > 200 && h < 20000)) return;',
    "    var frames = document.querySelectorAll('iframe.publist-frame');",
    '    for (var i = 0; i < frames.length; i++) {',
    '      var f = frames[i];',
    '      if (e.source !== f.contentWindow) continue;',
    '      try {',
    '        if (e.origin !== new URL(f.src, location.href).origin) continue;',
    '      } catch (err) { continue; }',
    "      f.style.height = h + 'px';",
    '    }',
    '  });',
    '})();',
    '</script>',
  ].join('\n')
}
