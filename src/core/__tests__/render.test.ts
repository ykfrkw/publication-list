import { describe, expect, it } from 'vitest'
import {
  CREDIT_HTML,
  CREDIT_SELECTOR,
  DISCLAIMER_HTML,
  DISCLAIMER_SELECTOR,
  buildGroups,
  renderBibtex,
  renderClipboard,
  renderHtml,
  renderMarkdown,
  renderRis,
  renderWordpressBlocks,
} from '../render'
import type { ListConfig, ListModel, Publication } from '../types'

// ─────────────────────────────────────────────────────────────── fixtures ──

let seq = 0

function pub(overrides: Partial<Publication> = {}): Publication {
  seq++
  return {
    key: `pmid:${1000 + seq}`,
    title: `Publication ${seq}`,
    authors: ['Furukawa Y', 'Sakata M'],
    authorsFull: ['Yuki Furukawa', 'Masatsugu Sakata'],
    journal: 'JAMA Psychiatry',
    year: 2024,
    month: 3,
    doi: `10.1000/test.${1000 + seq}`,
    pmid: String(1000 + seq),
    sources: ['pubmed'],
    seedIds: ['orcid:0000-0003-1317-0220'],
    trust: 'confirmed',
    category: 'original',
    ...overrides,
  }
}

function model(
  publications: Publication[],
  config: Partial<ListConfig> = {},
): ListModel {
  return {
    config: { v: 1, seeds: {}, style: 'vancouver', ...config },
    members: [],
    publications,
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// ───────────────────────────────────────────────────────────── grouping ──

describe('buildGroups', () => {
  it('orders category groups by CATEGORY_ORDER and skips empty ones', () => {
    const m = model(
      [
        pub({ category: 'editorial' }),
        pub({ category: 'original' }),
        pub({ category: 'preprint' }),
      ],
      { groupBy: 'category' },
    )
    expect(buildGroups(m).map((g) => g.key)).toEqual([
      'category:original',
      'category:preprint',
      'category:editorial',
    ])
  })

  it('treats a missing category as "other"', () => {
    const m = model([pub({ category: undefined })], { groupBy: 'category' })
    expect(buildGroups(m).map((g) => g.label)).toEqual([
      'Other Publication Types',
    ])
  })

  it('groups by descending year', () => {
    const m = model(
      [pub({ year: 2021 }), pub({ year: 2024 }), pub({ year: 2022 })],
      { groupBy: 'year' },
    )
    expect(buildGroups(m).map((g) => g.label)).toEqual(['2024', '2022', '2021'])
  })

  it('groups by category, then by descending year, when the config says nothing', () => {
    const m = model([pub({ year: 2021 }), pub({ year: 2024 }), pub({ year: 2022 })])
    const groups = buildGroups(m)
    expect(groups.map((g) => g.key)).toEqual(['category:original'])
    expect(groups[0].sections?.map((s) => s.key)).toEqual([
      'category:original:year:2024',
      'category:original:year:2022',
      'category:original:year:2021',
    ])
    expect(groups[0].sections?.map((s) => s.label)).toEqual(['2024', '2022', '2021'])
  })

  it('puts undated records last under groupBy year', () => {
    const m = model([pub({ year: 0 }), pub({ year: 2024 })], {
      groupBy: 'year',
    })
    expect(buildGroups(m).map((g) => g.label)).toEqual(['2024', 'Undated'])
  })

  it('labels an unusable year "Undated" rather than undefined or NaN', () => {
    // What a source that omits the date, or supplies an unparseable one,
    // leaves behind. `year` is typed `number`, so both arrive by way of a cast.
    const m = model(
      [
        pub({ year: undefined as unknown as number }),
        pub({ year: Number.NaN }),
        pub({ year: 2024 }),
      ],
      { groupBy: 'year' },
    )
    const groups = buildGroups(m)
    expect(groups.map((g) => g.label)).toEqual(['2024', 'Undated'])
    expect(groups.map((g) => g.key)).toEqual(['year:2024', 'year:undated'])
    // Both unusable records land in the one bucket, not in two of their own.
    expect(groups[1].items).toHaveLength(2)

    const html = renderHtml(m, { credit: false })
    expect(html).toContain('<h3 class="publist-heading">Undated</h3>')
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  })

  it('emits a single unlabelled group under groupBy none', () => {
    const m = model([pub(), pub()], { groupBy: 'none' })
    const groups = buildGroups(m)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('')
    expect(groups[0].items).toHaveLength(2)
  })

  it('puts the Japanese-language section last under japanese: separate', () => {
    const m = model(
      [
        pub({ language: 'ja', year: 2025 }),
        pub({ year: 2024 }),
        pub({ year: 2023, category: 'preprint' }),
      ],
      { groupBy: 'category', japanese: 'separate' },
    )
    expect(buildGroups(m).map((g) => g.label)).toEqual([
      'Original Articles & Reviews',
      'Preprints',
      'Japanese-language publications',
    ])
  })

  it('keeps the Japanese-language section last under groupBy year too', () => {
    const m = model(
      [pub({ language: 'ja', year: 2019 }), pub({ year: 2024 }), pub({ year: 2020 })],
      { groupBy: 'year', japanese: 'separate' },
    )
    expect(buildGroups(m).map((g) => g.label)).toEqual([
      '2024',
      '2020',
      'Japanese-language publications',
    ])
  })

  it('keeps Japanese records in one trailing section, undivided, under the default', () => {
    // Under the default grouping, with Japanese records whose categories and
    // years both interleave with the English ones. The failure mode this pins
    // is the Japanese section being sliced up like everything else — a 2024
    // Japanese letter filed under "Letters → 2024" instead of its own section.
    const m = model(
      [
        pub({ language: 'ja', year: 2024, category: 'letter' }),
        pub({ language: 'ja', year: 2020 }),
        pub({ year: 2024 }),
        pub({ year: 2020, category: 'letter' }),
      ],
      { japanese: 'separate' },
    )
    const groups = buildGroups(m)
    expect(groups.map((g) => g.label)).toEqual([
      'Original Articles & Reviews',
      'Letters',
      'Japanese-language publications',
    ])
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 2])
    // The trailing section is one flat block: no year dividers inside it.
    expect(groups[2].sections).toBeUndefined()
    // Newest first inside the trailing section as well.
    expect(groups[2].items.map((p) => p.year)).toEqual([2024, 2020])
  })

  it('keeps the Japanese section last under every grouping, category-year included', () => {
    for (const groupBy of ['category-year', 'category', 'year', 'none'] as const) {
      const m = model(
        [pub({ language: 'ja', year: 2019 }), pub({ year: 2024 }), pub({ year: 2020 })],
        { groupBy, japanese: 'separate' },
      )
      const groups = buildGroups(m)
      expect(groups[groups.length - 1].key).toBe('japanese')
      expect(groups[groups.length - 1].sections).toBeUndefined()
    }
  })

  it('inlines Japanese records under japanese: merge', () => {
    const m = model([pub({ language: 'ja' }), pub()], {
      groupBy: 'category',
      japanese: 'merge',
    })
    const groups = buildGroups(m)
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
  })

  it('drops Japanese records under japanese: hide', () => {
    const m = model([pub({ language: 'ja' }), pub()], {
      groupBy: 'none',
      japanese: 'hide',
    })
    expect(buildGroups(m)[0].items).toHaveLength(1)
  })

  it('applies limit after hiding, so the visible count is the limit', () => {
    const m = model(
      [pub({ language: 'ja' }), pub(), pub(), pub()],
      { groupBy: 'none', japanese: 'hide', limit: 2 },
    )
    expect(buildGroups(m)[0].items).toHaveLength(2)
  })

  it('divides each category into its own descending years', () => {
    const m = model(
      [
        pub({ category: 'original', year: 2024 }),
        pub({ category: 'original', year: 2021 }),
        pub({ category: 'original', year: 2024 }),
        pub({ category: 'letter', year: 2023 }),
      ],
      { groupBy: 'category-year' },
    )
    const groups = buildGroups(m)
    expect(groups.map((g) => g.label)).toEqual([
      'Original Articles & Reviews',
      'Letters',
    ])
    expect(groups[0].sections?.map((s) => s.label)).toEqual(['2024', '2021'])
    expect(groups[0].sections?.map((s) => s.items.length)).toEqual([2, 1])
    // A single-year category still gets its divider, so the page's shape does
    // not change with the data.
    expect(groups[1].sections?.map((s) => s.label)).toEqual(['2023'])
  })

  it('keeps group.items equal to the sections concatenated, in order', () => {
    // BibTeX, RIS and the Word clipboard read `items` and ignore `sections`.
    // If the two ever disagreed those outputs would drop or duplicate records.
    const m = model(
      [pub({ year: 2020 }), pub({ year: 2024 }), pub({ year: 2022 })],
      { groupBy: 'category-year' },
    )
    const group = buildGroups(m)[0]
    expect(group.items).toEqual(group.sections?.flatMap((s) => s.items))
    expect(group.items.map((p) => p.year)).toEqual([2024, 2022, 2020])
  })

  it('puts Undated last within its own category, not last overall', () => {
    const m = model(
      [
        pub({ category: 'original', year: 0 }),
        pub({ category: 'original', year: 2024 }),
        pub({ category: 'letter', year: 2019 }),
      ],
      { groupBy: 'category-year' },
    )
    const groups = buildGroups(m)
    expect(groups[0].sections?.map((s) => s.label)).toEqual(['2024', 'Undated'])
    expect(groups[0].sections?.map((s) => s.key)).toEqual([
      'category:original:year:2024',
      'category:original:year:undated',
    ])
    // The undated original article stays inside Original Articles, above the
    // Letters heading — it does not sink to the bottom of the whole list.
    expect(groups[1].label).toBe('Letters')
  })

  it('applies limit before splitting the Japanese section out', () => {
    const m = model(
      [
        pub({ year: 2025 }),
        pub({ year: 2024 }),
        pub({ language: 'ja', year: 2023 }),
        pub({ year: 2022 }),
      ],
      { groupBy: 'none', japanese: 'separate', limit: 3 },
    )
    const groups = buildGroups(m)
    expect(groups.map((g) => g.items.length)).toEqual([2, 1])
  })
})

// ───────────────────────────────────────────────────────────── renderHtml ──

describe('renderHtml', () => {
  it('wraps the list in section.publist with h3 headings and ol/li items', () => {
    const html = renderHtml(model([pub()], { groupBy: 'category' }), {
      credit: false,
    })
    expect(html.startsWith('<section class="publist">')).toBe(true)
    expect(html.endsWith('</section>')).toBe(true)
    expect(html).toContain(
      '<h3 class="publist-heading">Original Articles &amp; Reviews</h3>',
    )
    expect(html).toContain('<ol class="publist-list">')
    expect(html).toContain('<li class="publist-item">')
  })

  it('omits the heading when there is no group label', () => {
    const html = renderHtml(model([pub()], { groupBy: 'none' }), {
      credit: false,
    })
    expect(html).not.toContain('<h3')
    expect(html).not.toContain('<h4')
  })

  it('nests descending year subheadings inside each category heading', () => {
    const html = renderHtml(
      model(
        [
          pub({ category: 'original', year: 2026 }),
          pub({ category: 'original', year: 2024 }),
          pub({ category: 'letter', year: 2025 }),
        ],
        { groupBy: 'category-year' },
      ),
      { credit: false, disclaimer: false },
    )

    // The exact two-level shape, in order: h3, then its years, then the next h3.
    expect(html.match(/<h[34][^>]*>[^<]*<\/h[34]>/g)).toEqual([
      '<h3 class="publist-heading">Original Articles &amp; Reviews</h3>',
      '<h4 class="publist-subheading">2026</h4>',
      '<h4 class="publist-subheading">2024</h4>',
      '<h3 class="publist-heading">Letters</h3>',
      '<h4 class="publist-subheading">2025</h4>',
    ])
    // One <ol> per year, not one per category.
    expect(occurrences(html, '<ol class="publist-list">')).toBe(3)
    // The year level sits below the category level in the document outline.
    expect(html.indexOf('<h3')).toBeLessThan(html.indexOf('<h4'))
  })

  it('restarts numbering in each year, because each year is its own <ol>', () => {
    // The numbers are ordinals inside a visible section, not citation numbers.
    // A list continued across years would open "3." under a heading showing no
    // 1 or 2. `groupBy: 'none'` — where the numbers *are* cited — stays one
    // unbroken <ol>, which the assertion at the bottom pins.
    const html = renderHtml(
      model([pub({ year: 2026 }), pub({ year: 2024 }), pub({ year: 2024 })]),
      { credit: false, disclaimer: false },
    )
    expect(html).not.toContain('start=')
    expect(occurrences(html, '<ol class="publist-list">')).toBe(2)

    const flat = renderHtml(
      model([pub({ year: 2026 }), pub({ year: 2024 }), pub({ year: 2024 })], {
        groupBy: 'none',
      }),
      { credit: false, disclaimer: false },
    )
    expect(occurrences(flat, '<ol class="publist-list">')).toBe(1)
    expect(occurrences(flat, '<li class="publist-item">')).toBe(3)
  })

  it('renders the other three groupings flat, with no subheadings', () => {
    for (const groupBy of ['category', 'year', 'none'] as const) {
      const html = renderHtml(
        model([pub({ year: 2026 }), pub({ year: 2024 })], { groupBy }),
        { credit: false, disclaimer: false },
      )
      expect(html).not.toContain('publist-subheading')
      expect(occurrences(html, '<ol class="publist-list">')).toBe(
        groupBy === 'year' ? 2 : 1,
      )
    }
  })

  it('links the PubMed record when a pmid is present', () => {
    const html = renderHtml(model([pub({ pmid: '38809561' })]), {
      credit: false,
    })
    expect(html).toContain(
      'PMID: <a href="https://pubmed.ncbi.nlm.nih.gov/38809561" target="_blank">38809561</a>',
    )
  })

  it('emits no PubMed link for a non-numeric pmid', () => {
    const html = renderHtml(model([pub({ pmid: 'not-a-pmid' })]), {
      credit: false,
    })
    expect(html).not.toContain('pubmed.ncbi.nlm.nih.gov')
  })

  it('scopes every class under publist-', () => {
    const html = renderHtml(model([pub()]), { credit: true })
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) =>
      m[1].split(/\s+/),
    )
    expect(classes.length).toBeGreaterThan(0)
    for (const cls of classes) {
      expect(cls === 'publist' || cls.startsWith('publist-')).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────── credit link ──

describe('the credit link', () => {
  it('is exactly the agreed markup, dofollow, with a hardcoded anchor', () => {
    expect(CREDIT_HTML).toBe(
      '<p class="publist-credit">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>',
    )
    expect(CREDIT_HTML).not.toContain('rel=')
    expect(CREDIT_SELECTOR).toBe('.publist-credit')
  })

  it('is absent entirely with credit: false', () => {
    const html = renderHtml(model([pub(), pub()]), { credit: false })
    expect(html).not.toContain('publist-credit')
    expect(html).not.toContain('yukifurukawa.jp')
  })

  it('appears exactly once with credit: true', () => {
    const m = model(
      [
        pub({ category: 'original' }),
        pub({ category: 'preprint' }),
        pub({ language: 'ja' }),
      ],
      { groupBy: 'category', japanese: 'separate' },
    )
    const html = renderHtml(m, { credit: true })
    expect(occurrences(html, 'publist-credit')).toBe(1)
    expect(occurrences(html, 'yukifurukawa.jp')).toBe(1)
    expect(occurrences(html, CREDIT_HTML)).toBe(1)
  })

  it('is the last thing inside the section', () => {
    const html = renderHtml(model([pub()]), { credit: true })
    expect(html.endsWith(`${CREDIT_HTML}\n</section>`)).toBe(true)
  })

  it('is never emitted by any other renderer', () => {
    const m = model([pub()])
    for (const out of [
      renderWordpressBlocks(m),
      renderMarkdown(m),
      renderBibtex(m),
      renderRis(m),
      renderClipboard(m).html,
      renderClipboard(m).plain,
    ]) {
      expect(out).not.toContain('publist-credit')
    }
  })
})

// ────────────────────────────────────────────────────── source disclaimer ──

describe('the source disclaimer', () => {
  const count = (html: string) => occurrences(html, 'class="publist-disclaimer"')

  it('is one short line naming the sources, in a publist- class', () => {
    expect(DISCLAIMER_SELECTOR).toBe('.publist-disclaimer')
    expect(DISCLAIMER_HTML).toBe(
      '<p class="publist-disclaimer">Compiled automatically from ORCID, PubMed and researchmap; errors or omissions in those records appear here too.</p>',
    )
    // One sentence: this lands on every embedded page, and small print nobody
    // reads is worse than none.
    const text = DISCLAIMER_HTML.replace(/<[^>]+>/g, '')
    expect(text.match(/\./g)).toHaveLength(1)
    // Carries no link, so it can never be mistaken for a second credit.
    expect(DISCLAIMER_HTML).not.toContain('<a ')
  })

  it('is on when nothing says otherwise, and appears exactly once', () => {
    const m = model([pub({ category: 'original' }), pub({ category: 'letter' })])
    const html = renderHtml(m, { credit: false })
    expect(count(html)).toBe(1)
    expect(html).toContain(DISCLAIMER_HTML)
  })

  it('is off when the config says hide', () => {
    const html = renderHtml(model([pub()], { disclaimer: 'hide' }), {
      credit: false,
    })
    expect(count(html)).toBe(0)
  })

  it('is suppressed by the render option regardless of the config', () => {
    // How `src/embed/entry.ts` avoids injecting it into a host page.
    const html = renderHtml(model([pub()], { disclaimer: 'show' }), {
      credit: false,
      disclaimer: false,
    })
    expect(count(html)).toBe(0)
  })

  it('survives the credit being turned off, and vice versa', () => {
    const m = model([pub()])
    const off = model([pub()], { disclaimer: 'hide' })

    // Credit off, disclaimer on.
    const noCredit = renderHtml(m, { credit: false })
    expect(noCredit).not.toContain('publist-credit')
    expect(count(noCredit)).toBe(1)

    // Credit on, disclaimer off.
    const noDisclaimer = renderHtml(off, { credit: true })
    expect(noDisclaimer).toContain(CREDIT_HTML)
    expect(count(noDisclaimer)).toBe(0)

    // Both, and neither.
    expect(count(renderHtml(m, { credit: true }))).toBe(1)
    expect(renderHtml(m, { credit: true })).toContain(CREDIT_HTML)
    const neither = renderHtml(off, { credit: false })
    expect(count(neither)).toBe(0)
    expect(neither).not.toContain('publist-credit')
  })

  it('sits with the credit at the end of the list, disclaimer first', () => {
    const html = renderHtml(model([pub()]), { credit: true })
    expect(html.endsWith(`${DISCLAIMER_HTML}\n${CREDIT_HTML}\n</section>`)).toBe(true)
  })

  it('is never emitted by any renderer other than renderHtml', () => {
    // The Word clipboard carries its own, longer disclaimer; the rest carry
    // none. None of them carries this markup.
    const m = model([pub()])
    for (const out of [
      renderWordpressBlocks(m),
      renderMarkdown(m),
      renderBibtex(m),
      renderRis(m),
      renderClipboard(m).html,
      renderClipboard(m).plain,
    ]) {
      expect(out).not.toContain('publist-disclaimer')
    }
  })
})

// ─────────────────────────────────────────────── WordPress block markup ──

/**
 * Walk the `<!-- wp:… -->` / `<!-- /wp:… -->` delimiters and assert they nest
 * correctly, and that no markup sits outside a block.
 */
function assertBalancedBlocks(markup: string): void {
  const stack: string[] = []
  const re = /<!--\s*(\/?)wp:([a-z-]+)[^>]*-->/g
  let match: RegExpExecArray | null
  let sawBlock = false

  while ((match = re.exec(markup)) !== null) {
    const [, closing, name] = match
    if (closing === '') {
      stack.push(name)
      sawBlock = true
    } else {
      expect(stack.pop()).toBe(name)
    }
  }
  expect(sawBlock).toBe(true)
  expect(stack).toEqual([])

  // Nothing but whitespace may live between top-level blocks.
  const outside = markup.replace(
    /<!--\s*wp:([a-z-]+)[^>]*-->[\s\S]*?<!--\s*\/wp:\1\s*-->/g,
    '',
  )
  expect(outside.trim()).toBe('')
}

describe('renderWordpressBlocks', () => {
  it('emits block markup, not raw HTML', () => {
    const markup = renderWordpressBlocks(
      model([pub({ category: 'original' }), pub({ category: 'preprint' })], {
        groupBy: 'category',
      }),
    )
    expect(markup).toContain('<!-- wp:heading {"level":3} -->')
    expect(markup).toContain('<!-- /wp:heading -->')
    expect(markup).toContain('<!-- wp:list {"ordered":true} -->')
    expect(markup).toContain('<!-- wp:list-item -->')
    expect(markup).toContain('<ol class="wp-block-list">')
    assertBalancedBlocks(markup)
  })

  it('stays balanced with no headings (groupBy none)', () => {
    assertBalancedBlocks(
      renderWordpressBlocks(model([pub(), pub()], { groupBy: 'none' })),
    )
  })

  it('nests level-4 year headings under the level-3 category headings', () => {
    const markup = renderWordpressBlocks(
      model([pub({ year: 2026 }), pub({ year: 2024 })], {
        groupBy: 'category-year',
      }),
    )
    expect(markup).toContain('<!-- wp:heading {"level":4} -->')
    expect(markup).toContain('<h4 class="wp-block-heading">2026</h4>')
    assertBalancedBlocks(markup)
  })

  it('stays balanced under the default grouping', () => {
    assertBalancedBlocks(
      renderWordpressBlocks(
        model([pub({ year: 2026 }), pub({ year: 2024, category: 'letter' })]),
      ),
    )
  })

  it('stays balanced with a Japanese-language section', () => {
    assertBalancedBlocks(
      renderWordpressBlocks(
        model([pub(), pub({ language: 'ja' })], {
          groupBy: 'year',
          japanese: 'separate',
        }),
      ),
    )
  })
})

// ──────────────────────────────────────────────────────────── escaping ──

describe('HTML escaping across renderers', () => {
  const nasty = pub({
    title: '<script>alert(1)</script> Sleep & Wake',
    journal: 'Journal of Sleep & <b>Rhythms</b>',
  })

  it('escapes in renderHtml', () => {
    const html = renderHtml(model([nasty]), { credit: true })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Sleep &amp; Wake')
  })

  it('escapes in renderWordpressBlocks', () => {
    const markup = renderWordpressBlocks(model([nasty]))
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).toContain('&amp;')
  })

  it('escapes in renderClipboard().html', () => {
    const { html, plain } = renderClipboard(model([nasty]))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // The plain flavour is not markup, so it carries the raw text.
    expect(plain).toContain('<script>alert(1)</script> Sleep & Wake')
    expect(plain).not.toContain('&amp;')
  })

  it('escapes a category label containing an ampersand', () => {
    // `groupBy` is explicit because the default is `year`, which emits no
    // category label at all — this test is about the escaping, not the default.
    const html = renderHtml(
      model([pub({ category: 'original' })], { groupBy: 'category' }),
      { credit: false },
    )
    expect(html).toContain('Original Articles &amp; Reviews')
    expect(html).not.toContain('Original Articles & Reviews')
  })
})

// ──────────────────────────────────────────────────────────── Markdown ──

describe('renderMarkdown', () => {
  it('writes h3 headings and a numbered list with no HTML', () => {
    const md = renderMarkdown(
      model([pub({ pmid: '38809561' })], { groupBy: 'category' }),
    )
    expect(md).toContain('### Original Articles & Reviews')
    expect(md).toContain('1. Furukawa Y, Sakata M.')
    expect(md).toContain('PMID: [38809561](https://pubmed.ncbi.nlm.nih.gov/38809561)')
    expect(md).not.toContain('<em>')
    expect(md).not.toContain('<a href')
  })

  it('restarts numbering in each group', () => {
    const md = renderMarkdown(
      model([pub({ category: 'original' }), pub({ category: 'preprint' })], {
        groupBy: 'category',
      }),
    )
    // Each group numbers from 1 again.
    expect(md.match(/^1\. /gm)).toHaveLength(2)
    expect(md.match(/^2\. /gm)).toBeNull()
    expect(md.startsWith('### Original Articles & Reviews')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────── BibTeX / RIS ──

describe('renderBibtex', () => {
  it('emits one @article entry per publication with the expected fields', () => {
    const bib = renderBibtex(
      model([
        pub({
          authors: ['Furukawa Y'],
          authorsFull: ['Yuki Furukawa'],
          title: 'Sleep restriction therapy',
          journal: 'Sleep',
          year: 2024,
          month: 3,
          doi: '10.1000/abc',
          pmid: '38809561',
        }),
      ]),
    )
    expect(bib).toContain('@article{furukawa2024sleep,')
    expect(bib).toContain('author = {Yuki Furukawa}')
    expect(bib).toContain('title = {{Sleep restriction therapy}}')
    expect(bib).toContain('journal = {Sleep}')
    expect(bib).toContain('year = {2024}')
    expect(bib).toContain('month = {mar}')
    expect(bib).toContain('doi = {10.1000/abc}')
    expect(bib).toContain('pmid = {38809561}')
  })

  it('uses @misc for preprints', () => {
    expect(renderBibtex(model([pub({ category: 'preprint' })]))).toContain(
      '@misc{',
    )
  })

  it('escapes TeX special characters', () => {
    const bib = renderBibtex(
      model([pub({ title: 'Cost & benefit: 50% of #1 {trial}' })]),
    )
    expect(bib).toContain('Cost \\& benefit: 50\\% of \\#1 \\{trial\\}')
  })

  it('uniquifies colliding keys', () => {
    const same = {
      authors: ['Furukawa Y'],
      title: 'Insomnia treatment overview',
      year: 2024,
    }
    const bib = renderBibtex(model([pub(same), pub(same)]))
    const keys = [...bib.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1])
    expect(new Set(keys).size).toBe(2)
  })
})

describe('renderRis', () => {
  it('emits a well-formed record', () => {
    const ris = renderRis(
      model([
        pub({
          authors: ['Furukawa Y'],
          authorsFull: ['Yuki Furukawa'],
          title: 'Sleep restriction therapy',
          journal: 'Sleep',
          year: 2024,
          month: 3,
          doi: '10.1000/abc',
          pmid: '38809561',
        }),
      ]),
    )
    expect(ris.split('\n')).toEqual([
      'TY  - JOUR',
      'AU  - Yuki Furukawa',
      'TI  - Sleep restriction therapy',
      'JO  - Sleep',
      'PY  - 2024',
      'DA  - 2024/03//',
      'DO  - 10.1000/abc',
      'AN  - 38809561',
      'UR  - https://pubmed.ncbi.nlm.nih.gov/38809561',
      'ER  - ',
    ])
  })

  it('uses UNPB for preprints', () => {
    expect(renderRis(model([pub({ category: 'preprint' })]))).toContain(
      'TY  - UNPB',
    )
  })
})

// ──────────────────────────────────────────────────────────── clipboard ──

describe('renderClipboard', () => {
  const { html, plain } = renderClipboard(
    model([pub({ category: 'original' })], { groupBy: 'category' }),
  )

  it('wraps in the serif 12pt div that Word needs', () => {
    expect(
      html.startsWith('<div style="font-family:serif;font-size:12pt;">'),
    ).toBe(true)
  })

  it('leads with the red disclaimer, naming the sources a list is built from', () => {
    // The R original said "ORCID, OpenAlex, and researchmap": it predates
    // PubMed being a source, and OpenAlex is now enrichment only, never a seed.
    expect(html).toContain(
      '<p style="color:red;font-weight:bold;">[Disclaimer] This list is generated from a combination of ORCID, PubMed, and researchmap.',
    )
    expect(html).not.toContain('OpenAlex')
    expect(plain.startsWith('[Disclaimer] This list is generated')).toBe(true)
    expect(plain).toContain('ORCID, PubMed, and researchmap')
    expect(plain).not.toContain('OpenAlex')
  })

  it('keeps the explicit heading font size', () => {
    expect(html).toContain(
      '<p style="font-size:16px;font-weight:bold;margin-bottom:8px;">Original Articles &amp; Reviews (1)</p>',
    )
  })

  it('ends with the Generated with line in both flavours', () => {
    expect(
      html.endsWith(
        '<p style="font-size:9pt;color:gray;">Generated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>',
      ),
    ).toBe(true)
    expect(
      plain.endsWith(
        'Generated with Publication List Generator (https://yukifurukawa.jp/publication-list-generator/)',
      ),
    ).toBe(true)
  })

  it('carries the citations in both flavours', () => {
    expect(html).toContain('<em>JAMA Psychiatry</em>')
    expect(plain).toContain('JAMA Psychiatry')
    expect(plain).not.toContain('<em>')
  })
})
