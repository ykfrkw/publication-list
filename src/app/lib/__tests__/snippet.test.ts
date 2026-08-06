import { describe, expect, it } from 'vitest'
import { normalizeConfig, parseConfigFromSearchParams } from '@/core/config'
import { CREDIT_HTML, DISCLAIMER_HTML } from '@/core/render'
import type { ListConfig, ListModel, Publication } from '@/core/types'
import {
  EMBED_SCRIPT_URL,
  buildEmbedSnippet,
  buildIframeSnippet,
  configToDataAttributes,
} from '../snippet'

const publication: Publication = {
  key: 'doi:10.1136/bmj.n71',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ', 'McKenzie JE'],
  authorsFull: ['Matthew J Page', 'Joanne E McKenzie'],
  journal: 'BMJ',
  year: 2021,
  month: 3,
  doi: '10.1136/bmj.n71',
  pmid: '33782057',
  sources: ['orcid'],
  seedIds: ['0000-0003-1317-0220'],
  trust: 'confirmed',
  category: 'original',
}

function model(overrides: Partial<ListModel> = {}): ListModel {
  return {
    config: normalizeConfig({
      seeds: { orcid: ['0000-0003-1317-0220'] },
      style: 'vancouver',
    }),
    members: [],
    publications: [publication],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  }
}

/** How many credit blocks does this markup contain? */
function creditCount(html: string): number {
  return html.split('class="publist-credit"').length - 1
}

describe('the credit link', () => {
  it('emits exactly one credit block when the checkbox is on', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true })
    expect(creditCount(snippet)).toBe(1)
  })

  it('emits none at all when the checkbox is off', () => {
    const snippet = buildEmbedSnippet(model(), { credit: false })
    expect(creditCount(snippet)).toBe(0)
    expect(snippet).not.toContain('yukifurukawa.jp')
  })

  it('uses the markup from core/render verbatim — the UI never builds an anchor', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true })
    expect(snippet).toContain(CREDIT_HTML.trim())
  })

  it('stays at one credit block when the list has several sections', () => {
    const second: Publication = {
      ...publication,
      key: 'doi:10.1/second',
      doi: '10.1/second',
      pmid: '2',
      category: 'letter',
      title: 'A letter',
    }
    const snippet = buildEmbedSnippet(
      model({ publications: [publication, second] }),
      { credit: true },
    )
    expect(creditCount(snippet)).toBe(1)
  })

  it('turning the credit off changes nothing else about the snippet', () => {
    const on = buildEmbedSnippet(model(), { credit: true })
    const off = buildEmbedSnippet(model(), { credit: false })
    const stripped = on
      .split('\n')
      .filter((line) => !line.includes('publist-credit'))
      .join('\n')
    expect(stripped).toBe(off)
  })

  it('never puts a credit link in the iframe snippet', () => {
    const snippet = buildIframeSnippet(model().config)
    expect(creditCount(snippet)).toBe(0)
  })
})

describe('buildEmbedSnippet', () => {
  it('carries a pre-rendered snapshot of the list when asked for one', () => {
    const snippet = buildEmbedSnippet(model(), { credit: false, snapshot: true })
    expect(snippet).toContain('<section class="publist">')
    expect(snippet).toContain('The PRISMA 2020 statement')
    expect(snippet).toContain('PMID: <a href="https://pubmed.ncbi.nlm.nih.gov/33782057"')
  })

  it('emits the container, the data attributes and the script tag', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true })
    expect(snippet).toContain('<div class="publist-embed"')
    expect(snippet).toContain('data-orcid="0000-0003-1317-0220"')
    expect(snippet).toContain('data-style="vancouver"')
    expect(snippet).toContain(`<script src="${EMBED_SCRIPT_URL}" defer></script>`)
  })

  it('always writes the settings inline — there is no other transport', () => {
    // The snippet is the only thing a user has to keep, so every setting has
    // to be in it. Nothing here ever collapses to a pointer at a file.
    const snippet = buildEmbedSnippet(model(), { credit: true, snapshot: true })
    expect(snippet).toContain('data-orcid="0000-0003-1317-0220"')
    expect(snippet).not.toContain('data-config')
    // The snapshot is still there — that is the whole point of it.
    expect(snippet).toContain('The PRISMA 2020 statement')
  })
})

/**
 * The snapshot is optional, and the two trailer lines are not part of it.
 *
 * That separation is the load-bearing thing here. The lines used to be emitted
 * by `renderHtml` *inside* the `<section>` that is the snapshot, so leaving the
 * snapshot out would have deleted the credit link — permanently and without an
 * error, since `src/embed/entry.ts` may never create one.
 */
describe('the optional snapshot', () => {
  const hasSnapshot = (snippet: string) =>
    snippet.includes('<section class="publist">')

  it('is left out by default', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true })
    expect(hasSnapshot(snippet)).toBe(false)
    expect(snippet).not.toContain('The PRISMA 2020 statement')
    expect(snippet).not.toContain('<!-- Snapshot')
    // Everything else the snippet is for is still there.
    expect(snippet).toContain('<div class="publist-embed"')
    expect(snippet).toContain('data-orcid="0000-0003-1317-0220"')
    expect(snippet).toContain(`<script src="${EMBED_SCRIPT_URL}" defer></script>`)
  })

  it('is added, comment and all, when the box is ticked', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true, snapshot: true })
    expect(hasSnapshot(snippet)).toBe(true)
    expect(snippet).toContain('The PRISMA 2020 statement')
    expect(snippet).toContain('<!-- Snapshot generated 2026-08-05.')
  })

  it('keeps exactly one credit and one disclaimer either way', () => {
    for (const snapshot of [false, true]) {
      const snippet = buildEmbedSnippet(model(), { credit: true, snapshot })
      expect(creditCount(snippet)).toBe(1)
      expect(snippet.split('class="publist-disclaimer"').length - 1).toBe(1)
      expect(snippet).toContain(CREDIT_HTML)
      expect(snippet).toContain(DISCLAIMER_HTML)
    }
  })

  it('puts both lines outside the snapshot section, so dropping it drops neither', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true, snapshot: true })
    const sectionEnd = snippet.indexOf('</section>')
    expect(sectionEnd).toBeGreaterThan(-1)
    expect(snippet.indexOf(DISCLAIMER_HTML)).toBeGreaterThan(sectionEnd)
    expect(snippet.indexOf(CREDIT_HTML)).toBeGreaterThan(sectionEnd)
  })

  it('honours the disclaimer switch with no snapshot to carry it', () => {
    const hidden = model({
      config: { ...model().config, disclaimer: 'hide' as const },
    })
    const snippet = buildEmbedSnippet(hidden, { credit: true })
    expect(snippet).not.toContain('publist-disclaimer')
    expect(creditCount(snippet)).toBe(1)
  })

  /*
   * Exactly one thing other than the list changes, and it has to.
   *
   * A snapshot is markup baked here, so it is baked at a fixed heading level;
   * the snippet therefore pins that level for the live render too. Without the
   * pin `embed.js` would measure the host page and re-render at a different
   * level, and the headings would move on load. See `buildEmbedSnippet`.
   *
   * Written as "remove the attribute and the two are identical" rather than
   * dropped, so the assertion still catches anything *else* the snapshot
   * changes.
   */
  it('adds the list and pins the heading level — nothing else changes', () => {
    const off = buildEmbedSnippet(model(), { credit: true })
    const on = buildEmbedSnippet(model(), { credit: true, snapshot: true })

    expect(off).not.toContain('data-heading-level')
    expect(on).toContain('data-heading-level="3"')

    // Cut from the snapshot comment to the end of the section it introduces.
    const start = on.indexOf('  <!-- Snapshot')
    const closing = '  </section>\n'
    const end = on.indexOf(closing) + closing.length
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const withoutList = on.slice(0, start) + on.slice(end)
    expect(withoutList.replace('\n  data-heading-level="3"', '')).toBe(off)
  })
})

describe('configToDataAttributes', () => {
  it('is the inverse of the data-* vocabulary config.ts parses', () => {
    const config = normalizeConfig({
      seeds: {
        orcid: ['0000-0003-1317-0220', '0000-0002-1825-0097'],
        researchmap: ['furukawayuki'],
        pubmed: [{ query: 'SLEEPI[au]' }],
      },
      include: ['pmid:1'],
      exclude: ['pmid:2'],
      boldNames: ['Yuki Furukawa'],
      style: 'apa',
      // Not the default (`category-year`), so it has to be written out.
      groupBy: 'category',
      japanese: 'hide',
      reviewPolicy: 'auto',
      disclaimer: 'hide',
      from: '2020',
      to: '2026-12',
      limit: 20,
    })
    expect(Object.fromEntries(configToDataAttributes(config))).toEqual({
      'data-orcid': '0000-0003-1317-0220,0000-0002-1825-0097',
      'data-researchmap': 'furukawayuki',
      'data-pubmed': 'SLEEPI[au]',
      'data-include': 'pmid:1',
      'data-exclude': 'pmid:2',
      'data-bold-names': 'Yuki Furukawa',
      'data-style': 'apa',
      'data-group-by': 'category',
      'data-japanese': 'hide',
      'data-review-policy': 'auto',
      'data-disclaimer': 'hide',
      'data-from': '2020',
      'data-to': '2026-12',
      'data-limit': '20',
    })
  })

  it('omits defaults but always writes the style out', () => {
    const attrs = Object.fromEntries(
      configToDataAttributes(
        normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] } }),
      ),
    )
    expect(attrs).toEqual({
      'data-orcid': '0000-0003-1317-0220',
      'data-style': 'vancouver',
    })
  })

  it('writes data-group-by only when the grouping is not the default', () => {
    // The trap this pins: the omission is compared against `DEFAULT_GROUP_BY`,
    // so when the default changes a user who picked the *old* default must get
    // it written out. Comparing against a hardcoded literal here would silently
    // hand them a snippet that reverts to something else.
    const attrs = (groupBy: NonNullable<ListConfig['groupBy']>) =>
      Object.fromEntries(
        configToDataAttributes(
          normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] }, groupBy }),
        ),
      )
    expect(attrs('category-year')['data-group-by']).toBeUndefined()
    expect(attrs('category')['data-group-by']).toBe('category')
    expect(attrs('year')['data-group-by']).toBe('year')
    expect(attrs('none')['data-group-by']).toBe('none')
  })

  it('writes data-disclaimer only when the disclaimer is turned off', () => {
    const attrs = (disclaimer: 'show' | 'hide') =>
      Object.fromEntries(
        configToDataAttributes(
          normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] }, disclaimer }),
        ),
      )
    // Shown is the default, so the attribute would say nothing.
    expect(attrs('show')['data-disclaimer']).toBeUndefined()
    expect(attrs('hide')['data-disclaimer']).toBe('hide')
  })

  it('writes data-preprints only when preprints are opted in', () => {
    const attrs = (preprints: 'include' | 'exclude') =>
      Object.fromEntries(
        configToDataAttributes(
          normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] }, preprints }),
        ),
      )
    // Excluded is the default, so the attribute would say nothing.
    expect(attrs('exclude')['data-preprints']).toBeUndefined()
    expect(attrs('include')['data-preprints']).toBe('include')
  })

  it('escapes quotes and angle brackets so a value cannot break out', () => {
    const config = normalizeConfig({
      seeds: { pubmed: [{ query: 'x" onload="alert(1)' }] },
    })
    const snippet = buildEmbedSnippet(model({ config }), { credit: false })
    expect(snippet).toContain('data-pubmed="x&quot; onload=&quot;alert(1)"')
    expect(snippet).not.toContain('onload="alert')
  })
})

/**
 * A comma inside a value, in the transport that joins values with commas.
 *
 * This replaces `hasCommaHostileValues`, which detected the problem and steered
 * the user to a hosted file rather than solving it. The values are now
 * percent-escaped on the way out and unescaped on the way in
 * (`encodeListValue` / `decodeListValue` in `core/config.ts`), so the comma is
 * carried rather than routed around. The failure being pinned is the silent
 * one: one query arriving as two seeds, with no error anywhere.
 */
describe('a value containing a comma or a percent sign', () => {
  const COMMA = 'Furukawa Y[au] AND (Tokyo, Japan[ad])'
  const PERCENT = 'insomnia[ti] AND 50% response[tiab]'

  const configWith = (...queries: string[]) =>
    normalizeConfig({ seeds: { pubmed: queries.map((query) => ({ query })) } })

  it('escapes the comma in the data attribute instead of splitting on it', () => {
    const attrs = new Map(configToDataAttributes(configWith(COMMA)))
    expect(attrs.get('data-pubmed')).toBe(
      'Furukawa Y[au] AND (Tokyo%2C Japan[ad])',
    )
  })

  it('escapes a literal percent sign so the escape cannot be forged', () => {
    const attrs = new Map(configToDataAttributes(configWith(PERCENT)))
    expect(attrs.get('data-pubmed')).toBe(
      'insomnia[ti] AND 50%25 response[tiab]',
    )
  })

  it('comes back off the iframe URL as one seed per query, verbatim', () => {
    const config = configWith(COMMA, PERCENT, 'plain[au]')
    const url = buildIframeSnippet(config).match(/src="([^"]+)"/)?.[1] ?? ''
    const query = new URLSearchParams(
      (url.split('?')[1] ?? '').replace(/&amp;/g, '&'),
    )
    expect(parseConfigFromSearchParams(query).config.seeds?.pubmed).toEqual([
      { query: COMMA },
      { query: PERCENT },
      { query: 'plain[au]' },
    ])
  })

  it('keeps the ticks on the right queries when one of them holds a comma', () => {
    // The ticks travel as positions within `data-pubmed`, so a query that split
    // in two would move every tick after it onto the wrong query.
    const config = normalizeConfig({
      seeds: {
        pubmed: [
          { query: COMMA },
          { query: 'b[au]', trust: 'confirmed' as const },
        ],
      },
    })
    const url = buildIframeSnippet(config).match(/src="([^"]+)"/)?.[1] ?? ''
    const query = new URLSearchParams(
      (url.split('?')[1] ?? '').replace(/&amp;/g, '&'),
    )
    expect(parseConfigFromSearchParams(query).config.seeds?.pubmed).toEqual([
      { query: COMMA },
      { query: 'b[au]', trust: 'confirmed' },
    ])
  })

  it('leaves a value with neither character exactly as it was', () => {
    const attrs = new Map(configToDataAttributes(model().config))
    expect(attrs.get('data-orcid')).toBe('0000-0003-1317-0220')
  })
})

/**
 * `trust` is the one PubMed-seed field whose loss would not be cosmetic: a seed
 * that comes back untrusted publishes a *shorter* list on the next page load,
 * silently. It therefore travels — beside the query, never inside it.
 */
describe('a trusted PubMed seed in the inline transports', () => {
  const TRUSTED = normalizeConfig({
    seeds: {
      pubmed: [
        { query: '"SLEEPI"[cn]', trust: 'confirmed' },
        { query: 'Furukawa Y[au]' },
        { query: 'insomnia[ti]', trust: 'confirmed' },
      ],
    },
  })

  it('rides in a second attribute as line numbers, leaving the query untouched', () => {
    const attrs = Object.fromEntries(configToDataAttributes(TRUSTED))
    // The query text is exactly what the user typed — no marker smuggled in,
    // which is the constraint that made a separate attribute necessary.
    expect(attrs['data-pubmed']).toBe(
      '"SLEEPI"[cn],Furukawa Y[au],insomnia[ti]',
    )
    expect(attrs['data-pubmed-trusted']).toBe('0,2')
  })

  it('says nothing at all when no query is trusted', () => {
    const attrs = Object.fromEntries(
      configToDataAttributes(
        normalizeConfig({ seeds: { pubmed: [{ query: '"SLEEPI"[cn]' }] } }),
      ),
    )
    expect(attrs['data-pubmed-trusted']).toBeUndefined()
  })

  it('comes back off the query string with the ticks on the same queries', () => {
    const attrs = Object.fromEntries(configToDataAttributes(TRUSTED))
    const read = parseConfigFromSearchParams(
      new URLSearchParams({
        pubmed: attrs['data-pubmed'],
        'pubmed-trusted': attrs['data-pubmed-trusted'],
      }),
    )
    expect(read.config.seeds?.pubmed).toEqual([
      { query: '"SLEEPI"[cn]', trust: 'confirmed' },
      { query: 'Furukawa Y[au]' },
      { query: 'insomnia[ti]', trust: 'confirmed' },
    ])
  })

  it('produces both snippets rather than withholding them', () => {
    // The regression this exists to stop: ticking the box used to leave the
    // user with no snippet at all and a demand to host a pubs.json.
    const m = model({ config: TRUSTED })
    const script = buildEmbedSnippet(m, { credit: true })
    expect(script).toContain('data-pubmed-trusted="0,2"')
    expect(script).toContain(EMBED_SCRIPT_URL)

    const iframe = buildIframeSnippet(TRUSTED)
    expect(iframe).toContain('pubmed-trusted=0%2C2')
  })

  it('survives the iframe URL as a whole config', () => {
    const url = buildIframeSnippet(TRUSTED).match(/src="([^"]+)"/)?.[1] ?? ''
    const query = new URLSearchParams(
      (url.split('?')[1] ?? '').replace(/&amp;/g, '&'),
    )
    expect(normalizeConfig(parseConfigFromSearchParams(query).config).seeds).toEqual(
      TRUSTED.seeds,
    )
  })
})

describe('buildIframeSnippet', () => {
  it('points at widget.html with the config in the query string', () => {
    const snippet = buildIframeSnippet(model().config)
    expect(snippet).toContain('widget.html?')
    expect(snippet).toContain('orcid=0000-0003-1317-0220')
    expect(snippet).toContain('embed:height')
  })

  it('validates the message origin before resizing', () => {
    const snippet = buildIframeSnippet(model().config)
    expect(snippet).toContain('e.source !== f.contentWindow')
    expect(snippet).toContain('e.origin !== new URL(f.src, location.href).origin')
  })
})

/**
 * The iframe route carries the checkbox in the frame's URL, because the credit
 * is rendered by `widget.html` rather than by this snippet. `credit=0` is the
 * parameter `src/widget/main.ts` reads; these tests pin that it is emitted
 * when, and only when, the checkbox is off.
 */
describe('the credit checkbox reaches the iframe snippet', () => {
  it('appends credit=0 when the checkbox is off', () => {
    const snippet = buildIframeSnippet(model().config, { credit: false })
    expect(snippet).toContain('credit=0')
  })

  it('says nothing about the credit when the checkbox is on', () => {
    const snippet = buildIframeSnippet(model().config, { credit: true })
    expect(snippet).not.toContain('credit=')
  })

  it('says nothing about the credit when the option is omitted', () => {
    const snippet = buildIframeSnippet(model().config)
    expect(snippet).not.toContain('credit=')
  })

  it('changes nothing else about the snippet', () => {
    const on = buildIframeSnippet(model().config, { credit: true })
    const off = buildIframeSnippet(model().config, { credit: false })
    expect(off.replace('&amp;credit=0', '')).toBe(on)
  })
})

describe('seed time windows in the emitted snippet', () => {
  const windowed = normalizeConfig({
    v: 1,
    seeds: {
      orcid: [
        '0000-0003-1317-0220',
        { id: '0000-0002-1825-0097', from: '2019-04', to: '2023-03' },
      ],
    },
  })

  it('carries a window in the inline attribute instead of dropping it', () => {
    // The alternative — silently emitting a snippet whose seeds have lost
    // their end dates — is the failure this encoding exists to prevent.
    const attrs = new Map(configToDataAttributes(windowed))
    expect(attrs.get('data-orcid')).toBe(
      '0000-0003-1317-0220,0000-0002-1825-0097@2019-04:2023-03',
    )
  })

  it('carries it in the iframe URL too', () => {
    const url = buildIframeSnippet(windowed).match(/src="([^"]+)"/)?.[1] ?? ''
    const query = new URLSearchParams(url.split('?')[1] ?? '')
    expect(
      normalizeConfig(parseConfigFromSearchParams(query).config).seeds,
    ).toEqual(windowed.seeds)
  })

  it('leaves a windowless seed spelled exactly as before', () => {
    const plain = normalizeConfig({
      v: 1,
      seeds: { orcid: ['0000-0003-1317-0220'] },
    })
    expect(new Map(configToDataAttributes(plain)).get('data-orcid')).toBe(
      '0000-0003-1317-0220',
    )
  })
})

/**
 * The heading level, and the one place its default depends on the snapshot.
 *
 * `headingLevelFor` in `core/config.ts` is where that rule lives; this suite is
 * about the snippet builder honouring it and — the part that matters — writing
 * the resolved level into the attribute as well as into the baked markup, so
 * the two halves of the snippet agree.
 */
describe('the heading level', () => {
  const withLevel = (headingLevel: NonNullable<ListConfig['headingLevel']>) =>
    model({ config: { ...model().config, headingLevel } })

  it('stays automatic, and unwritten, with no snapshot', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true })
    expect(snippet).not.toContain('data-heading-level')
    // Nothing in the attributes means `'auto'` to `parseConfigFromDataset`,
    // and `embed.js` does the measuring.
    expect(normalizeConfig({}).headingLevel).toBe('auto')
  })

  it('becomes an explicit 3 with a snapshot, in the markup and the attribute', () => {
    const snippet = buildEmbedSnippet(model(), { credit: true, snapshot: true })
    expect(snippet).toContain('data-heading-level="3"')
    expect(snippet).toContain('<h3 class="publist-heading">')
    expect(snippet).toContain('<h4 class="publist-subheading">')
  })

  it('writes a chosen level out either way, and bakes the snapshot at it', () => {
    const light = buildEmbedSnippet(withLevel(2), { credit: true })
    expect(light).toContain('data-heading-level="2"')

    const heavy = buildEmbedSnippet(withLevel(2), {
      credit: true,
      snapshot: true,
    })
    expect(heavy).toContain('data-heading-level="2"')
    expect(heavy).toContain('<h2 class="publist-heading">')
    expect(heavy).toContain('<h3 class="publist-subheading">')
    expect(heavy).not.toContain('<h4')
  })

  it('never bakes a snapshot at a level the attribute does not name', () => {
    // The failure this guards: a snapshot at one level plus an attribute
    // saying `auto` means the headings move on load, and the readers the
    // snapshot exists for — crawlers, JavaScript off — keep the wrong outline.
    for (const headingLevel of ['auto', 2, 3, 4, 5] as const) {
      const snippet = buildEmbedSnippet(withLevel(headingLevel), {
        credit: true,
        snapshot: true,
      })
      const attr = /data-heading-level="(\d)"/.exec(snippet)?.[1]
      expect(attr).toBeDefined()
      expect(snippet).toContain(`<h${attr} class="publist-heading">`)
    }
  })

  it('projects onto the iframe URL like every other setting', () => {
    const frame = buildIframeSnippet(withLevel(4).config)
    expect(frame).toContain('heading-level=4')
    const query = new URLSearchParams(
      /src="[^?]+\?([^"]*)"/.exec(frame)?.[1]?.replace(/&amp;/g, '&') ?? '',
    )
    expect(parseConfigFromSearchParams(query).config.headingLevel).toBe(4)
  })
})
