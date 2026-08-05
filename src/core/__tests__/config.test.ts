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
  DEFAULT_GROUP_BY,
  DEFAULT_JAPANESE,
  DEFAULT_REVIEW_POLICY,
  DEFAULT_STYLE,
  normalizeConfig,
  parseConfigFromDataset,
  parseConfigFromSearchParams,
  type DatasetConfig,
} from '../config'

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
    expect(config.seeds).toEqual({})
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
        'data-japanese': 'merge',
        'data-review-policy': 'auto',
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
        'japanese=merge',
        'review-policy=auto',
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
