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
  DEFAULT_HEADING_LEVEL,
  DEFAULT_JAPANESE,
  DEFAULT_PREPRINTS,
  DEFAULT_REVIEW_POLICY,
  DEFAULT_STYLE,
  LIST_ID_PATTERN,
  SNAPSHOT_HEADING_LEVEL,
  decodeListValue,
  headingLevelFor,
  encodeListValue,
  isListId,
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

  it('returns the registry pointer beside the config, not inside it', () => {
    const parsed = fromQuery('list=sleepi')
    expect(parsed.listId).toBe('sleepi')
    expect(parsed.config).not.toHaveProperty('listId')
  })

  it('has no parameter that names an arbitrary URL to fetch', () => {
    // `config=` used to be that parameter. Nothing reads it now, and a paste
    // that still carries one must not be able to point the widget anywhere.
    const parsed = fromQuery('config=https://evil.example/pubs.json&orcid=' + ORCID)
    expect(parsed).not.toHaveProperty('configUrl')
    expect(parsed.listId).toBeUndefined()
    expect(JSON.stringify(parsed)).not.toContain('evil.example')
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

/**
 * The one rule three modules share.
 *
 * A `data-list` / `?list=` value is interpolated into `lists/<id>.json` and
 * resolved with `new URL()`, which walks `..` like any path — so an unchecked
 * id addresses files outside the registry. `src/widget/main.ts`,
 * `src/embed/entry.ts` and `src/app/lib/restore.ts` all call this before
 * resolving, and each used to spell the pattern out for itself (`entry.ts` was
 * the copy that never got written). One definition, so a fourth consumer
 * cannot get it wrong.
 */
describe('isListId', () => {
  it('accepts a bare filename, which is what the registry holds', () => {
    for (const id of ['furukawa', 'sleepi', 'my-lab_2026', 'v1.list', 'a', 'A1']) {
      expect(isListId(id)).toBe(true)
    }
  })

  it('refuses anything that could climb out of lists/', () => {
    for (const id of [
      '..',
      '../secrets',
      '../../../etc/passwd',
      './list',
      '/absolute',
      'sub/dir/list',
      // A leading dot is refused outright rather than special-casing `..`.
      '.hidden',
    ]) {
      expect(isListId(id)).toBe(false)
    }
  })

  it('refuses a value that names somewhere else entirely', () => {
    for (const id of [
      'https://evil.example/pubs.json',
      '//evil.example/pubs.json',
      'javascript:alert(1)',
    ]) {
      expect(isListId(id)).toBe(false)
    }
  })

  it('refuses the escaped spellings, because nothing decodes them first', () => {
    // `attr()` and `URLSearchParams` hand the value over as-is at this point,
    // so an id is checked exactly as it will be interpolated.
    expect(isListId('%2e%2e%2fsecrets')).toBe(false)
    expect(isListId('..%2Fsecrets')).toBe(false)
  })

  it('refuses blank, whitespace and undefined', () => {
    expect(isListId('')).toBe(false)
    expect(isListId('  ')).toBe(false)
    expect(isListId(undefined)).toBe(false)
  })

  it('is stateless — the pattern carries no /g, so repeats agree', () => {
    // A shared regex with /g would keep `lastIndex` between calls and start
    // alternating. It is exported as a constant, so this is worth pinning.
    for (let i = 0; i < 4; i += 1) {
      expect(isListId('sleepi')).toBe(true)
      expect(isListId('../secrets')).toBe(false)
    }
    expect(LIST_ID_PATTERN.global).toBe(false)
  })
})

/**
 * The escape that lets a comma travel inside a comma-joined list.
 *
 * Read the long note above `encodeListValue` in `config.ts` for why the two
 * replacement orders are mirror images. What is asserted here is the property
 * that note claims: `decode(encode(v)) === v` for every value, including the
 * ones that look like an escape already.
 */
describe('encodeListValue / decodeListValue', () => {
  const VALUES = [
    'Furukawa Y[au] AND (Tokyo, Japan[ad])',
    'insomnia[ti] AND 50% response[tiab]',
    // A user who typed the escape sequence themselves. It must come back as
    // the literal text, not as a comma.
    '%2C',
    '%25',
    '%252C',
    ',,,',
    '100%,50%',
    '',
    'plain[au]',
  ]

  it('is a true inverse, escapes and all', () => {
    for (const value of VALUES) {
      expect(decodeListValue(encodeListValue(value))).toBe(value)
    }
  })

  it('leaves no bare comma in an encoded value', () => {
    for (const value of VALUES) {
      expect(encodeListValue(value)).not.toContain(',')
    }
  })

  it('survives the join and the split that the transports perform', () => {
    const joined = VALUES.filter((v) => v !== '').map(encodeListValue).join(',')
    const { config } = fromQuery(
      `include=${encodeURIComponent(joined)}`,
    )
    expect(config.include).toEqual(VALUES.filter((v) => v !== ''))
  })

  it('accepts a lowercase %2c from a hand-edited attribute', () => {
    expect(decodeListValue('Tokyo%2c Japan')).toBe('Tokyo, Japan')
  })

  it('touches nothing else — no other character is escaped', () => {
    expect(encodeListValue('a b&c=d"e<f>g[h]')).toBe('a b&c=d"e<f>g[h]')
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

/** A `lists/*.json` file reaches `normalizeConfig` as a plain object, unparsed. */
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

describe('headingLevel', () => {
  it('defaults to auto, on all three transports', () => {
    expect(DEFAULT_HEADING_LEVEL).toBe('auto')
    expect(
      normalizeConfig(fromAttributes({ 'data-orcid': ORCID }).config).headingLevel,
    ).toBe('auto')
    expect(normalizeConfig(fromQuery(`orcid=${ORCID}`).config).headingLevel).toBe(
      'auto',
    )
    expect(fromJson({ v: 1, seeds: { orcid: [ORCID] } }).headingLevel).toBe('auto')
  })

  it('reads an explicit level from either inline transport', () => {
    for (const level of [2, 3, 4, 5] as const) {
      expect(
        normalizeConfig(
          fromAttributes({ 'data-heading-level': String(level) }).config,
        ).headingLevel,
      ).toBe(level)
      expect(
        normalizeConfig(fromQuery(`heading-level=${level}`).config).headingLevel,
      ).toBe(level)
      // The camelCase alias a hand-written iframe URL is likely to use.
      expect(
        normalizeConfig(fromQuery(`headingLevel=${level}`).config).headingLevel,
      ).toBe(level)
    }
  })

  it('falls back to the default for anything it does not recognize', () => {
    // Same rule as `group-by` and `review-policy`: `1` and `6` are outside the
    // range the setting allows, and `h3` is somebody guessing the spelling.
    for (const bad of ['1', '6', 'h3', 'auto3', '']) {
      expect(
        normalizeConfig(fromAttributes({ 'data-heading-level': bad }).config)
          .headingLevel,
      ).toBe('auto')
      expect(
        normalizeConfig(fromQuery(`heading-level=${bad}`).config).headingLevel,
      ).toBe('auto')
    }
  })
})

/**
 * The snapshot-dependent default, at its single source.
 *
 * `normalizeConfig` and `buildEmbedSnippet` both go through `headingLevelFor`
 * rather than each deciding for themselves, so this is the only place the rule
 * is written and the only place it has to be tested.
 */
describe('headingLevelFor — the default depends on the snapshot', () => {
  it('is auto with no snapshot', () => {
    expect(headingLevelFor({})).toBe('auto')
    expect(headingLevelFor({}, false)).toBe('auto')
  })

  it('is an explicit 3 with a snapshot, because nothing can measure', () => {
    expect(headingLevelFor({}, true)).toBe(3)
    expect(SNAPSHOT_HEADING_LEVEL).toBe(3)
  })

  it('collapses an explicitly chosen auto too, for the same reason', () => {
    expect(headingLevelFor({ headingLevel: 'auto' }, true)).toBe(3)
  })

  it('never overrides a level the author chose', () => {
    for (const snapshot of [false, true]) {
      expect(headingLevelFor({ headingLevel: 2 }, snapshot)).toBe(2)
      expect(headingLevelFor({ headingLevel: 5 }, snapshot)).toBe(5)
    }
  })

  it('clamps a level from outside the range', () => {
    expect(headingLevelFor({ headingLevel: 1 as never })).toBe(2)
    expect(headingLevelFor({ headingLevel: 9 as never })).toBe(5)
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
        'list=sleepi',
      ].join('&'),
    },
    {
      name: 'escaped commas and percent signs inside list values',
      attrs: {
        'data-pubmed': 'Furukawa Y[au] AND (Tokyo%2C Japan[ad]),50%25 [tiab]',
      },
      query: 'pubmed=Furukawa Y%5Bau%5D AND (Tokyo%252C Japan%5Bad%5D),50%2525 %5Btiab%5D',
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
 * The third transport: a `lists/*.json` registry file, which reaches `normalizeConfig`
 * as a plain object rather than through either string parser.
 */
describe('normalizeConfig — preprints', () => {
  it('excludes preprints when a registry file says nothing about them', () => {
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

  it('serializes the setting, so a registry file is explicit about it', () => {
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
    // A registry-file round trip must be lossless — it is the transport windows
    // are documented as always working on.
    expect(normalizeConfig(JSON.parse(json) as ListConfig)).toEqual(config)
  })

  it('does not read a window out of a PubMed query', () => {
    // A query is free text; a date-looking tail in one is the user's syntax,
    // not ours. PubMed windows travel in a lists/*.json file only.
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

  it('survives a registry-file round trip', () => {
    const config = normalizeConfig(TRUSTED)
    expect(config.seeds.pubmed).toEqual([
      { query: '"SLEEPI"[cn]', label: 'SLEEPI', trust: 'confirmed' },
      { query: 'Furukawa Y[au]' },
    ])

    const json = serializeConfig(config)
    expect(JSON.parse(json).seeds.pubmed[0].trust).toBe('confirmed')
    // Lossless, as it is on the inline routes tested below — this one carries
    // the seed's `label` and window with it, which they cannot.
    expect(normalizeConfig(JSON.parse(json) as ListConfig)).toEqual(config)
  })

  it('is never read out of the query text itself', () => {
    // Both transports carry the query verbatim. The flag is not smuggled into
    // it — it rides in the companion parameter tested below — so a query
    // arriving on its own is untrusted, which is the safe direction.
    expect(fromAttributes({ 'data-pubmed': '"SLEEPI"[cn]' }).config.seeds?.pubmed)
      .toEqual([{ query: '"SLEEPI"[cn]' }])
    expect(fromQuery('pubmed=%22SLEEPI%22%5Bcn%5D').config.seeds?.pubmed).toEqual([
      { query: '"SLEEPI"[cn]' },
    ])
  })

  it('travels beside the query, as line numbers, on both transports', () => {
    const expected = [
      { query: 'a[au]', trust: 'confirmed' },
      { query: 'b[au]' },
      { query: 'c[au]', trust: 'confirmed' },
    ]
    expect(
      fromAttributes({
        'data-pubmed': 'a[au],b[au],c[au]',
        'data-pubmed-trusted': '0,2',
      }).config.seeds?.pubmed,
    ).toEqual(expected)
    expect(
      fromQuery('pubmed=a%5Bau%5D,b%5Bau%5D,c%5Bau%5D&pubmed-trusted=0,2').config
        .seeds?.pubmed,
    ).toEqual(expected)
    // camelCase too, the same courtesy every other hyphenated name gets.
    expect(
      fromQuery('pubmed=a%5Bau%5D&pubmedTrusted=0').config.seeds?.pubmed,
    ).toEqual([{ query: 'a[au]', trust: 'confirmed' }])
  })

  it('ignores an index that is out of range or not a number', () => {
    // A hand-edited snippet must fall back to "needs review" rather than throw
    // or, worse, tick the wrong query.
    const seeds = fromAttributes({
      'data-pubmed': 'a[au],b[au]',
      'data-pubmed-trusted': '1, 7, -1, x, 1.5, 01x, , 99999999999999999999',
    }).config.seeds?.pubmed
    expect(seeds).toEqual([{ query: 'a[au]' }, { query: 'b[au]', trust: 'confirmed' }])
  })

  it('does nothing at all with no queries to point at', () => {
    expect(
      fromAttributes({ 'data-pubmed-trusted': '0,1' }).config.seeds,
    ).toBeUndefined()
  })

  it('drops a trust value that is not exactly "confirmed"', () => {
    // A hand-edited lists/*.json is where this comes from, and an unrecognized
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
