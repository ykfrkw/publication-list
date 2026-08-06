import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import { CREDIT_HTML } from '@/core/render'
import type { ListConfig, ListModel, Publication } from '@/core/types'
import {
  EMBED_SCRIPT_URL,
  buildEmbedSnippet,
  buildIframeSnippet,
  configToDataAttributes,
  hasCommaHostileValues,
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
  it('carries a pre-rendered snapshot of the list', () => {
    const snippet = buildEmbedSnippet(model(), { credit: false })
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

  it('collapses to a single data-config attribute when a hosted URL is given', () => {
    const snippet = buildEmbedSnippet(model(), {
      credit: true,
      configUrl: 'https://example.org/pubs.json',
    })
    expect(snippet).toContain('data-config="https://example.org/pubs.json"')
    expect(snippet).not.toContain('data-orcid=')
    // The snapshot is still there — that is the whole point of it.
    expect(snippet).toContain('The PRISMA 2020 statement')
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

describe('hasCommaHostileValues', () => {
  it('flags a PubMed query containing a comma, which comma-joined attributes cannot carry', () => {
    const config = normalizeConfig({
      seeds: { pubmed: [{ query: 'Furukawa Y[au] AND (Tokyo, Japan[ad])' }] },
    })
    expect(hasCommaHostileValues(config)).toBe(true)
  })

  it('is quiet about an ordinary config', () => {
    expect(hasCommaHostileValues(model().config)).toBe(false)
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

  it('carries credit=0 on the hosted-config variant too', () => {
    const snippet = buildIframeSnippet(model().config, {
      configUrl: 'https://example.org/pubs.json',
      credit: false,
    })
    expect(snippet).toContain('credit=0')
    expect(snippet).toContain('config=https%3A%2F%2Fexample.org%2Fpubs.json')
    expect(snippet).not.toContain('orcid=')
  })

  it('changes nothing else about the snippet', () => {
    const on = buildIframeSnippet(model().config, { credit: true })
    const off = buildIframeSnippet(model().config, { credit: false })
    expect(off.replace('&amp;credit=0', '')).toBe(on)
  })
})
