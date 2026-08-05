/**
 * The copy-and-paste snippets: JS embed, iframe fallback, and the `data-*`
 * projection of a `ListConfig` that both of them share.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CREDIT LINK
 *
 * This module never builds the credit anchor. It asks
 * `renderHtml(model, { credit })` for it, and `render.ts` owns the markup —
 * the anchor text and href are constants there, not parameters here, and
 * nothing in the UI may hand the user a way to edit them. Read the comment
 * above `CREDIT_HTML` in `src/core/render.ts` before changing anything below.
 *
 * The checkbox controls exactly one thing: the boolean passed to `renderHtml`.
 * Off means zero credit blocks in the emitted snippet and no other difference
 * whatsoever — no nag, no watermark, no reduced output.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { renderHtml } from '@/core/render'
import { escapeHtml } from '@/core/format'
import type { ListConfig, ListModel } from '@/core/types'

/** Where the built assets live once deployed. */
export const SITE_BASE = 'https://ykfrkw.github.io/publication-list/'
export const EMBED_SCRIPT_URL = `${SITE_BASE}embed.js`
export const WIDGET_URL = `${SITE_BASE}widget.html`

/** Suggested filename for the hosted-config download. */
export const CONFIG_FILENAME = 'pubs.json'

/**
 * Beyond this many characters of inline `data-*` attributes the snippet stops
 * being something a person can paste into a CMS field and read back. The UI
 * uses it to decide when to push the hosted-`pubs.json` route.
 */
export const INLINE_ATTR_BUDGET = 400

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
 */
export function configToDataAttributes(config: ListConfig): DataAttribute[] {
  const out: DataAttribute[] = []
  const push = (name: string, value: string | undefined) => {
    if (value != null && value !== '') out.push([name, value] as const)
  }

  push('data-orcid', config.seeds.orcid?.join(','))
  push('data-researchmap', config.seeds.researchmap?.join(','))
  push('data-pubmed', config.seeds.pubmed?.map((s) => s.query).join(','))
  push('data-include', config.include?.join(','))
  push('data-exclude', config.exclude?.join(','))
  push('data-bold-names', config.boldNames?.join(','))

  push('data-style', config.style ?? 'vancouver')
  if (config.groupBy && config.groupBy !== 'category') {
    push('data-group-by', config.groupBy)
  }
  if (config.japanese && config.japanese !== 'separate') {
    push('data-japanese', config.japanese)
  }
  if (config.reviewPolicy && config.reviewPolicy !== 'strict') {
    push('data-review-policy', config.reviewPolicy)
  }
  push('data-from', config.from)
  push('data-to', config.to)
  if (config.limit != null) push('data-limit', String(config.limit))

  return out
}

/**
 * A comma-joined attribute cannot carry a value containing a comma.
 *
 * PubMed queries are the realistic case (`Furukawa Y[au] AND (Tokyo, Japan[ad])`).
 * Rather than emit a snippet that silently splits one query into two, the UI
 * checks this and steers the user to the hosted-`pubs.json` route, where the
 * value is a JSON string and the problem does not exist.
 */
export function hasCommaHostileValues(config: ListConfig): boolean {
  const lists = [
    config.seeds.orcid,
    config.seeds.researchmap,
    config.include,
    config.exclude,
    config.boldNames,
    config.seeds.pubmed?.map((s) => s.query),
  ]
  return lists.some((list) => (list ?? []).some((v) => v.includes(',')))
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
   * When set, the config travels in a hosted `pubs.json` and the container
   * carries a single `data-config` attribute instead of the inline set.
   */
  configUrl?: string
}

/**
 * The JS embed snippet, with a pre-rendered snapshot of the current list.
 *
 * The snapshot is the point. It means the list is in the host page's HTML:
 * visible to crawlers, visible with JS disabled, and visible instantly on a
 * slow connection. `embed.js` replaces it with a freshly fetched list on load
 * and leaves any `.publist-credit` node alone while doing so.
 */
export function buildEmbedSnippet(
  model: ListModel,
  opts: EmbedSnippetOptions,
): string {
  const attrs: DataAttribute[] =
    opts.configUrl && opts.configUrl.trim() !== ''
      ? [['data-config', opts.configUrl.trim()] as const]
      : configToDataAttributes(model.config)

  const snapshot = renderHtml(model, { credit: opts.credit })
  const stamp = (model.generatedAt || '').slice(0, 10)

  return [
    `<div class="publist-embed"${renderAttributes(attrs)}>`,
    `  <!-- Snapshot${stamp ? ` generated ${stamp}` : ''}. embed.js replaces it with a live list on load. -->`,
    indent(snapshot),
    '</div>',
    `<script src="${EMBED_SCRIPT_URL}" defer></script>`,
  ].join('\n')
}

/** `data-*` names → the query-string names `widget.html` reads. */
function attributesToQuery(attrs: readonly DataAttribute[]): string {
  const params = new URLSearchParams()
  for (const [name, value] of attrs) params.set(name.replace(/^data-/, ''), value)
  return params.toString()
}

export interface IframeSnippetOptions {
  configUrl?: string
  /** CSS height before the frame reports its own, in px. */
  fallbackHeight?: number
}

/**
 * The iframe fallback, for CMSes that strip `<script src>`.
 *
 * The height listener follows the `embed:height` postMessage convention used
 * across yukifurukawa.jp: the frame posts its content height, and the parent
 * validates both the message source and its origin before resizing. There is
 * no credit link here — an iframe's content is not part of the host page's
 * markup, so a link inside it would be exactly the runtime-injected widget
 * link the static snapshot exists to avoid.
 */
export function buildIframeSnippet(
  config: ListConfig,
  opts: IframeSnippetOptions = {},
): string {
  const query =
    opts.configUrl && opts.configUrl.trim() !== ''
      ? attributesToQuery([['config', opts.configUrl.trim()] as const])
      : attributesToQuery(configToDataAttributes(config))
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

/** Total length of the inline attribute block, for the size hint in the UI. */
export function inlineAttributeLength(config: ListConfig): number {
  return configToDataAttributes(config).reduce(
    (n, [name, value]) => n + name.length + value.length + 4,
    0,
  )
}
