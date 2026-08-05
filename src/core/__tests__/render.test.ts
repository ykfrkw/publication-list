import { describe, expect, it } from 'vitest'
import {
  CREDIT_HTML,
  CREDIT_SELECTOR,
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

  it('puts undated records last under groupBy year', () => {
    const m = model([pub({ year: 0 }), pub({ year: 2024 })], {
      groupBy: 'year',
    })
    expect(buildGroups(m).map((g) => g.label)).toEqual(['2024', 'Undated'])
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
    const html = renderHtml(model([pub({ category: 'original' })]), {
      credit: false,
    })
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

  it('leads with the red disclaimer', () => {
    expect(html).toContain(
      '<p style="color:red;font-weight:bold;">[Disclaimer] This list is generated from a combination of ORCID, OpenAlex, and researchmap.',
    )
    expect(plain.startsWith('[Disclaimer] This list is generated')).toBe(true)
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
