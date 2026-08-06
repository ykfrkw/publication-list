/**
 * @vitest-environment jsdom
 *
 * `parseConfigFromSearchParams` — the iframe widget's transport.
 *
 * The point of most of these tests is not that the query parser works in
 * isolation, but that it *agrees* with `parseConfigFromDataset`. The two feed
 * the same pipeline from two embed paths, so any divergence would mean the JS
 * tag and the iframe render different lists from the same logical config. The
 * agreement suite at the bottom pins that directly; jsdom is here only so the
 * dataset parser has an element to read.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISCLAIMER,
  DEFAULT_GROUP_BY,
  DEFAULT_JAPANESE,
  DEFAULT_PREPRINTS,
  DEFAULT_REVIEW_POLICY,
  DEFAULT_STYLE,
  normalizeConfig,
  parseConfigFromDataset,
  parseConfigFromSearchParams,
  serializeConfig,
  type DatasetConfig,
} from '../config'
import type { ListConfig } from '../types'

const ORCID = '0000-0003-1317-0220'

function fromQuery(query: string): DatasetConfig {
  return parseConfigFromSearchParams(new URLSearchParams(query))
}

/** Build a container carrying the given `data-*` attributes and read it back. */
function fromAttributes(attrs: Record<string, string>): DatasetConfig {
  const el = document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  return parseConfigFromDataset(el)
}

describe('parseConfigFromSearchParams — every parameter', () => {
  it('reads the three seed kinds', () => {
    const { config } = fromQuery(
      'orcid=0000-0003-1317-0220&researchmap=furukawayuki&pubmed=SLEEPI%5Bau%5D',
    )
    expect(config.seeds).toEqual({
      orcid: ['0000-0003-1317-0220'],
      researchmap: ['furukawayuki'],
      pubmed: [{ query: 'SLEEPI[au]' }],
    })
  })

  it('leaves seeds undefined when no seed parameter is present', () => {
    expect(fromQuery('style=apa').config.seeds).toBeUndefined()
  })

  it('reads include, exclude and bold-names', () => {
    const { config } = fromQuery(
      'include=pmid:12345678&exclude=doi:10.1136/bmj.n71&bold-names=Furukawa%20Y',
    )
    expect(config.include).toEqual(['pmid:12345678'])
    expect(config.exclude).toEqual(['doi:10.1136/bmj.n71'])
    expect(config.boldNames).toEqual(['Furukawa Y'])
  })

  it('reads every citation style', () => {
    for (const style of ['vancouver', 'apa', 'harvard', 'chicago', 'nature']) {
      expect(fromQuery(`style=${style}`).config.style).toBe(style)
    }
  })

  it('reads from, to and limit', () => {
    const { config } = fromQuery('from=2020-01&to=2024&limit=25')
    expect(config.from).toBe('2020-01')
    expect(config.to).toBe('2024')
    expect(config.limit).toBe(25)
  })

  it('reads group-by, japanese and review-policy', () => {
    const { config } = fromQuery(
      'group-by=year&japanese=merge&review-policy=auto',
    )
    expect(config.groupBy).toBe('year')
    expect(config.japanese).toBe('merge')
    expect(config.reviewPolicy).toBe('auto')
  })

  it('reads preprints', () => {
    expect(fromQuery('preprints=include').config.preprints).toBe('include')
    expect(fromQuery('preprints=exclude').config.preprints).toBe('exclude')
  })

  it('accepts the camelCase spellings of the hyphenated names', () => {
    const { config } = fromQuery(
      'groupBy=none&reviewPolicy=auto&boldNames=Furukawa%20Y',
    )
    expect(config.groupBy).toBe('none')
    expect(config.reviewPolicy).toBe('auto')
    expect(config.boldNames).toEqual(['Furukawa Y'])
  })

  it('returns the remote-config pointers beside the config, not inside it', () => {
    const parsed = fromQuery('config=https://example.org/pubs.json&list=sleepi')
    expect(parsed.configUrl).toBe('https://example.org/pubs.json')
    expect(parsed.listId).toBe('sleepi')
    expect(parsed.config).not.toHaveProperty('configUrl')
    expect(parsed.config).not.toHaveProperty('listId')
  })

  it('normalizes ORCID and researchmap ids the way the dataset parser does', () => {
    const { config } = fromQuery(
      'orcid=https%3A%2F%2Forcid.org%2F0000-0003-1317-0220&researchmap=https%3A%2F%2Fresearchmap.jp%2Ffurukawayuki',
    )
    expect(config.seeds?.orcid).toEqual(['0000-0003-1317-0220'])
    expect(config.seeds?.researchmap).toEqual(['furukawayuki'])
  })
})

describe('parseConfigFromSearchParams — multi-values', () => {
  it('splits a comma-separated list and trims the parts', () => {
    const { config } = fromQuery(
      'orcid=0000-0003-1317-0220%2C%200000-0002-1825-0097',
    )
    expect(config.seeds?.orcid).toEqual([
      '0000-0003-1317-0220',
      '0000-0002-1825-0097',
    ])
  })

  it('treats a repeated name as one list, same as the comma form', () => {
    const repeated = fromQuery('orcid=0000-0003-1317-0220&orcid=0000-0002-1825-0097')
    const commas = fromQuery('orcid=0000-0003-1317-0220%2C0000-0002-1825-0097')
    expect(repeated.config).toEqual(commas.config)
  })

  it('keeps every include reference when the name repeats', () => {
    const { config } = fromQuery('include=pmid:1&include=pmid:2,pmid:3')
    expect(config.include).toEqual(['pmid:1', 'pmid:2', 'pmid:3'])
  })

  it('takes the first occurrence of a single-valued parameter', () => {
    expect(fromQuery('style=apa&style=nature').config.style).toBe('apa')
    expect(fromQuery('limit=10&limit=99').config.limit).toBe(10)
  })

  it('drops empty and whitespace-only values', () => {
    expect(fromQuery('orcid=&style=').config).toEqual({})
    expect(fromQuery('orcid=%20%20&exclude=%20,%20').config).toEqual({})
  })

  it('skips an empty repeat and uses the one that has a value', () => {
    expect(fromQuery('style=&style=nature').config.style).toBe('nature')
  })
})

describe('parseConfigFromSearchParams — unusable values', () => {
  it('ignores a style outside the vocabulary', () => {
    expect(fromQuery('style=mla').config.style).toBeUndefined()
  })

  it('ignores an unrecognized review policy so the strict default survives', () => {
    const { config } = fromQuery('review-policy=lenient')
    expect(config.reviewPolicy).toBeUndefined()
    expect(normalizeConfig(config).reviewPolicy).toBe(DEFAULT_REVIEW_POLICY)
  })

  it('ignores an unrecognized preprints value so the exclude default survives', () => {
    const { config } = fromQuery('preprints=maybe')
    expect(config.preprints).toBeUndefined()
    expect(normalizeConfig(config).preprints).toBe(DEFAULT_PREPRINTS)
  })

  it('ignores a malformed date and a non-positive limit', () => {
    const { config } = fromQuery('from=January%202020&to=2020-1&limit=0')
    expect(config.from).toBeUndefined()
    expect(config.to).toBeUndefined()
    expect(config.limit).toBeUndefined()
  })

  it('falls back to every default when the query string is empty', () => {
    const config = normalizeConfig(fromQuery('').config)
    expect(config.style).toBe(DEFAULT_STYLE)
    expect(config.groupBy).toBe(DEFAULT_GROUP_BY)
    expect(config.japanese).toBe(DEFAULT_JAPANESE)
    expect(config.reviewPolicy).toBe(DEFAULT_REVIEW_POLICY)
    expect(config.disclaimer).toBe(DEFAULT_DISCLAIMER)
    // Preprints are opt-in: absent means excluded, on every transport.
    expect(config.preprints).toBe('exclude')
    expect(config.seeds).toEqual({})
  })
})

/** A `pubs.json` reaches `normalizeConfig` as a plain object, unparsed. */
const fromJson = (json: Partial<ListConfig>) => normalizeConfig(json)

describe('groupBy defaults to category-year', () => {
  it('is what the shared constant says', () => {
    expect(DEFAULT_GROUP_BY).toBe('category-year')
  })

  it('applies on all three transports when none of them says otherwise', () => {
    expect(
      normalizeConfig(fromAttributes({ 'data-orcid': ORCID }).config).groupBy,
    ).toBe('category-year')
    expect(normalizeConfig(fromQuery(`orcid=${ORCID}`).config).groupBy).toBe(
      'category-year',
    )
    expect(fromJson({ v: 1, seeds: { orcid: [ORCID] } }).groupBy).toBe('category-year')
  })

  it('still lets all three transports select any of the four groupings', () => {
    for (const value of ['category-year', 'category', 'year', 'none'] as const) {
      expect(
        normalizeConfig(fromAttributes({ 'data-group-by': value }).config).groupBy,
      ).toBe(value)
      expect(normalizeConfig(fromQuery(`group-by=${value}`).config).groupBy).toBe(value)
      // The camelCase spelling a hand-written iframe URL reaches for.
      expect(normalizeConfig(fromQuery(`groupBy=${value}`).config).groupBy).toBe(value)
      expect(fromJson({ v: 1, seeds: {}, groupBy: value }).groupBy).toBe(value)
    }
  })

  it('falls back to the default when a transport carries an unrecognized value', () => {
    expect(normalizeConfig(fromQuery('group-by=decade').config).groupBy).toBe(
      'category-year',
    )
    expect(
      normalizeConfig(fromAttributes({ 'data-group-by': 'decade' }).config).groupBy,
    ).toBe('category-year')
  })
})

describe('disclaimer defaults to show', () => {
  it('is what the shared constant says', () => {
    expect(DEFAULT_DISCLAIMER).toBe('show')
  })

  it('applies on all three transports when none of them says otherwise', () => {
    expect(
      normalizeConfig(fromAttributes({ 'data-orcid': ORCID }).config).disclaimer,
    ).toBe('show')
    expect(normalizeConfig(fromQuery(`orcid=${ORCID}`).config).disclaimer).toBe('show')
    expect(fromJson({ v: 1, seeds: { orcid: [ORCID] } }).disclaimer).toBe('show')
  })

  it('is turned off by any of the three transports', () => {
    expect(
      normalizeConfig(fromAttributes({ 'data-disclaimer': 'hide' }).config).disclaimer,
    ).toBe('hide')
    expect(normalizeConfig(fromQuery('disclaimer=hide').config).disclaimer).toBe('hide')
    expect(fromJson({ v: 1, seeds: {}, disclaimer: 'hide' }).disclaimer).toBe('hide')
  })

  it('falls back to show when a transport carries an unrecognized value', () => {
    // Same rule as `review-policy`: a typo must not quietly remove something.
    expect(normalizeConfig(fromQuery('disclaimer=maybe').config).disclaimer).toBe('show')
    expect(
      normalizeConfig(fromAttributes({ 'data-disclaimer': '' }).config).disclaimer,
    ).toBe('show')
  })

  it('is independent of the credit, which is not a config field at all', () => {
    // `?credit=0` is read by `src/widget/main.ts`, never by the config parser:
    // it must not appear in a `ListConfig` and must not disturb the disclaimer.
    const config = normalizeConfig(fromQuery(`orcid=${ORCID}&credit=0`).config)
    expect(config.disclaimer).toBe('show')
    expect(config).not.toHaveProperty('credit')
  })
})

describe('parseConfigFromSearchParams agrees with parseConfigFromDataset', () => {
  /** The same logical config, spelled for each transport. */
  const CASES: { name: string; attrs: Record<string, string>; query: string }[] = [
    {
      name: 'a full config',
      attrs: {
        'data-orcid': '0000-0003-1317-0220,0000-0002-1825-0097',
        'data-researchmap': 'furukawayuki',
        'data-pubmed': 'SLEEPI[au]',
        'data-include': 'pmid:12345678',
        'data-exclude': 'doi:10.1136/bmj.n71',
        'data-bold-names': 'Furukawa Y,Furukawa TA',
        'data-style': 'apa',
        'data-group-by': 'year',
        'data-preprints': 'include',
        'data-japanese': 'merge',
        'data-review-policy': 'auto',
        'data-disclaimer': 'hide',
        'data-from': '2015-04',
        'data-to': '2026-12',
        'data-limit': '50',
        'data-config': 'https://example.org/pubs.json',
        'data-list': 'sleepi',
      },
      query: [
        'orcid=0000-0003-1317-0220,0000-0002-1825-0097',
        'researchmap=furukawayuki',
        'pubmed=SLEEPI%5Bau%5D',
        'include=pmid:12345678',
        'exclude=doi:10.1136/bmj.n71',
        'bold-names=Furukawa Y,Furukawa TA',
        'style=apa',
        'group-by=year',
        'preprints=include',
        'japanese=merge',
        'review-policy=auto',
        'disclaimer=hide',
        'from=2015-04',
        'to=2026-12',
        'limit=50',
        'config=https://example.org/pubs.json',
        'list=sleepi',
      ].join('&'),
    },
    {
      name: 'seeds only',
      attrs: { 'data-orcid': '0000-0003-1317-0220' },
      query: 'orcid=0000-0003-1317-0220',
    },
    {
      name: 'nothing at all',
      attrs: {},
      query: '',
    },
    {
      name: 'values that survive coercion only if both parsers apply it',
      attrs: {
        'data-orcid': ' https://orcid.org/0000-0003-1317-0220 ',
        'data-style': 'VANCOUVER',
        'data-limit': '007',
      },
      query: 'orcid=%20https://orcid.org/0000-0003-1317-0220%20&style=VANCOUVER&limit=007',
    },
    {
      name: 'unusable values, which both parsers must drop identically',
      attrs: {
        'data-style': 'mla',
        'data-group-by': 'month',
        'data-from': 'yesterday',
        'data-limit': '-3',
      },
      query: 'style=mla&group-by=month&from=yesterday&limit=-3',
    },
  ]

  for (const { name, attrs, query } of CASES) {
    it(`matches the dataset parser for ${name}`, () => {
      expect(fromQuery(query)).toEqual(fromAttributes(attrs))
    })

    it(`normalizes to the same ListConfig for ${name}`, () => {
      expect(normalizeConfig(fromQuery(query).config)).toEqual(
        normalizeConfig(fromAttributes(attrs).config),
      )
    })
  }
})

/**
 * The third transport: a hosted `pubs.json`, which reaches `normalizeConfig`
 * as a plain object rather than through either string parser.
 */
describe('normalizeConfig — preprints', () => {
  it('excludes preprints when a pubs.json says nothing about them', () => {
    const config = normalizeConfig({
      v: 1,
      seeds: { orcid: ['0000-0003-1317-0220'] },
    })
    expect(config.preprints).toBe('exclude')
    expect(DEFAULT_PREPRINTS).toBe('exclude')
  })

  it('keeps an explicit include', () => {
    expect(normalizeConfig({ preprints: 'include' }).preprints).toBe('include')
  })

  it('serializes the setting, so a downloaded pubs.json is explicit about it', () => {
    expect(serializeConfig(normalizeConfig({}))).toContain('"preprints": "exclude"')
  })
})

/**
 * Seed time windows across the three transports.
 *
 * The requirement is asymmetric and worth stating: a **bare string must keep
 * meaning exactly what it meant**, and a window must not disappear on the way
 * into a snippet. Both are checked here; the `data-*` side of the round trip is
 * checked against `configToDataAttributes` in `app/lib/__tests__/snippet.test.ts`.
 */
describe('seed time windows', () => {
  it('reads a windowed seed from a query string and from an attribute', () => {
    const expected = {
      orcid: [{ id: ORCID, from: '2019-04', to: '2023-03' }],
    }
    expect(fromQuery(`orcid=${ORCID}%402019-04%3A2023-03`).config.seeds).toEqual(
      expected,
    )
    expect(
      fromAttributes({ 'data-orcid': `${ORCID}@2019-04:2023-03` }).config.seeds,
    ).toEqual(expected)
  })

  it('mixes windowed and bare seeds in one comma-separated attribute', () => {
    const { config } = fromAttributes({
      'data-orcid': `${ORCID},0000-0002-1825-0097@:2023-03`,
    })
    expect(config.seeds?.orcid).toEqual([
      ORCID,
      { id: '0000-0002-1825-0097', to: '2023-03' },
    ])
  })

  it('leaves a plain seed as the bare string it has always been', () => {
    expect(fromAttributes({ 'data-orcid': ORCID }).config.seeds?.orcid).toEqual([
      ORCID,
    ])
    expect(
      normalizeConfig({ v: 1, seeds: { orcid: [ORCID] } }).seeds.orcid,
    ).toEqual([ORCID])
  })

  it('normalizes the id inside a window, and survives serialization', () => {
    const config = normalizeConfig({
      v: 1,
      seeds: {
        orcid: [{ id: `https://orcid.org/${ORCID}`, to: '2023-03', grace: 36 }],
      },
    })
    expect(config.seeds.orcid).toEqual([{ id: ORCID, to: '2023-03', grace: 36 }])
    const json = serializeConfig(config)
    expect(JSON.parse(json).seeds.orcid).toEqual([
      { grace: 36, id: ORCID, to: '2023-03' },
    ])
    // A pubs.json round trip must be lossless — it is the transport windows
    // are documented as always working on.
    expect(normalizeConfig(JSON.parse(json) as ListConfig)).toEqual(config)
  })

  it('does not read a window out of a PubMed query', () => {
    // A query is free text; a date-looking tail in one is the user's syntax,
    // not ours. PubMed windows travel in a pubs.json only.
    const { config } = fromAttributes({ 'data-pubmed': 'Tanaka H[au]@2019:2023' })
    expect(config.seeds?.pubmed).toEqual([{ query: 'Tanaka H[au]@2019:2023' }])
  })
})

describe('a PubMed seed marked trusted', () => {
  const TRUSTED: Partial<ListConfig> = {
    seeds: {
      pubmed: [
        { query: '"SLEEPI"[cn]', label: 'SLEEPI', trust: 'confirmed' },
        { query: 'Furukawa Y[au]' },
      ],
    },
  }

  it('survives a pubs.json round trip', () => {
    const config = normalizeConfig(TRUSTED)
    expect(config.seeds.pubmed).toEqual([
      { query: '"SLEEPI"[cn]', label: 'SLEEPI', trust: 'confirmed' },
      { query: 'Furukawa Y[au]' },
    ])

    const json = serializeConfig(config)
    expect(JSON.parse(json).seeds.pubmed[0].trust).toBe('confirmed')
    // Lossless, because the JSON route is the *only* route this flag has.
    expect(normalizeConfig(JSON.parse(json) as ListConfig)).toEqual(config)
  })

  it('cannot travel in data-pubmed or in a query string', () => {
    // Both transports carry the query alone. The flag is not smuggled into the
    // query text, so a seed read back from either is untrusted — the safe
    // direction. The wizard refuses to emit these snippets at all for a config
    // that has one; see `hasTrustedPubmedSeeds` in app/lib/snippet.ts.
    expect(fromAttributes({ 'data-pubmed': '"SLEEPI"[cn]' }).config.seeds?.pubmed)
      .toEqual([{ query: '"SLEEPI"[cn]' }])
    expect(fromQuery('pubmed=%22SLEEPI%22%5Bcn%5D').config.seeds?.pubmed).toEqual([
      { query: '"SLEEPI"[cn]' },
    ])
  })

  it('drops a trust value that is not exactly "confirmed"', () => {
    // A hand-edited pubs.json is where this comes from, and an unrecognized
    // value must fall back to reviewing rather than to publishing.
    const config = normalizeConfig({
      seeds: {
        pubmed: [
          { query: 'a[au]', trust: 'candidate' },
          { query: 'b[au]', trust: 'yes' as unknown as 'confirmed' },
        ],
      },
    })
    expect(config.seeds.pubmed).toEqual([{ query: 'a[au]' }, { query: 'b[au]' }])
  })

  it('keeps the seed window and label alongside it', () => {
    const config = normalizeConfig({
      seeds: {
        pubmed: [
          {
            query: '"SLEEPI"[cn]',
            label: 'SLEEPI',
            trust: 'confirmed',
            from: '2023-04',
            to: '2026-03',
            grace: 12,
          },
        ],
      },
    })
    expect(config.seeds.pubmed).toEqual([
      {
        query: '"SLEEPI"[cn]',
        label: 'SLEEPI',
        trust: 'confirmed',
        from: '2023-04',
        to: '2026-03',
        grace: 12,
      },
    ])
  })
})
