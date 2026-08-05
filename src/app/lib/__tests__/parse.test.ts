import { describe, expect, it } from 'vitest'
import {
  parseIdList,
  parseMemberLines,
  parseNameList,
  parsePubmedQueries,
  parseYearMonth,
} from '../parse'

describe('parseIdList', () => {
  it('accepts one identifier per line', () => {
    const { refs, invalid } = parseIdList('33782057\n10.1136/bmj.n71\n')
    expect(refs).toEqual(['pmid:33782057', 'doi:10.1136/bmj.n71'])
    expect(invalid).toEqual([])
  })

  it('accepts comma- and space-separated input on one line', () => {
    const { refs } = parseIdList('33782057, 34567890 10.1136/bmj.n71')
    expect(refs).toEqual([
      'pmid:33782057',
      'pmid:34567890',
      'doi:10.1136/bmj.n71',
    ])
  })

  it('normalizes doi.org URLs and prefixed forms', () => {
    const { refs } = parseIdList(
      'https://doi.org/10.1136/BMJ.N71\ndoi: 10.1001/jama.2024.1\npmid: 42',
    )
    expect(refs).toEqual([
      'doi:10.1136/bmj.n71',
      'doi:10.1001/jama.2024.1',
      'pmid:42',
    ])
  })

  it('de-duplicates while keeping first-seen order', () => {
    const { refs } = parseIdList('10.1136/bmj.n71\nhttps://doi.org/10.1136/bmj.n71')
    expect(refs).toEqual(['doi:10.1136/bmj.n71'])
  })

  it('reports what it could not parse instead of dropping it silently', () => {
    const { refs, invalid } = parseIdList('33782057\nnot-an-id\n')
    expect(refs).toEqual(['pmid:33782057'])
    expect(invalid).toEqual(['not-an-id'])
  })

  it('keeps a DOI that legitimately contains a comma in one piece', () => {
    const { refs, invalid } = parseIdList('10.1234/abc,def')
    expect(refs).toEqual(['doi:10.1234/abc,def'])
    expect(invalid).toEqual([])
  })
})

describe('parsePubmedQueries', () => {
  it('takes one query per line and skips blanks and comments', () => {
    const seeds = parsePubmedQueries(
      '0000-0003-1317-0220[auid]\n\n# a comment\nFurukawa Y[au] AND (Tokyo[ad])\n',
    )
    expect(seeds).toEqual([
      { query: '0000-0003-1317-0220[auid]' },
      { query: 'Furukawa Y[au] AND (Tokyo[ad])' },
    ])
  })

  it('de-duplicates identical queries', () => {
    expect(parsePubmedQueries('SLEEPI[au]\nSLEEPI[au]')).toHaveLength(1)
  })
})

describe('parseMemberLines', () => {
  it('reads a bare ORCID iD', () => {
    const { members } = parseMemberLines('0000-0003-1317-0220')
    expect(members).toEqual([
      { raw: '0000-0003-1317-0220', orcid: '0000-0003-1317-0220' },
    ])
  })

  it('reads an ORCID URL and drops the leftover prefix', () => {
    const { members } = parseMemberLines('https://orcid.org/0000-0003-1317-0220')
    expect(members[0].orcid).toBe('0000-0003-1317-0220')
    expect(members[0].name).toBeUndefined()
  })

  it('reads a TSV row pasted from a spreadsheet, in any column order', () => {
    const { members } = parseMemberLines(
      'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki\n' +
        '0000-0002-1825-0097\tJosiah Carberry',
    )
    expect(members[0]).toEqual({
      raw: 'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki',
      name: 'Yuki Furukawa',
      orcid: '0000-0003-1317-0220',
      researchmap: 'furukawayuki',
    })
    expect(members[1].name).toBe('Josiah Carberry')
    expect(members[1].orcid).toBe('0000-0002-1825-0097')
  })

  it('reads a name and an ORCID separated by a single space', () => {
    const { members } = parseMemberLines('Yuki Furukawa 0000-0003-1317-0220')
    expect(members[0]).toMatchObject({
      name: 'Yuki Furukawa',
      orcid: '0000-0003-1317-0220',
    })
  })

  it('reads a researchmap permalink, bare or as a URL', () => {
    const { members } = parseMemberLines(
      'furukawayuki\nhttps://researchmap.jp/someone/',
    )
    expect(members.map((m) => m.researchmap)).toEqual(['furukawayuki', 'someone'])
  })

  it('keeps Japanese names', () => {
    const { members } = parseMemberLines('古川由己,0000-0003-1317-0220')
    expect(members[0].name).toBe('古川由己')
    expect(members[0].orcid).toBe('0000-0003-1317-0220')
  })

  it('skips a header row', () => {
    const { members, invalid } = parseMemberLines(
      'Name\tORCID\nYuki Furukawa\t0000-0003-1317-0220',
    )
    expect(members).toHaveLength(1)
    expect(invalid).toEqual([])
  })

  it('reports lines with no identifier rather than inventing one', () => {
    const { members, invalid } = parseMemberLines(
      'Someone With No Id\n0000-0003-1317-0220',
    )
    expect(members).toHaveLength(1)
    expect(invalid).toEqual(['Someone With No Id'])
  })

  it('de-duplicates the same person listed twice', () => {
    const { members } = parseMemberLines(
      '0000-0003-1317-0220\n0000-0003-1317-0220',
    )
    expect(members).toHaveLength(1)
  })
})

describe('parseNameList', () => {
  it('splits on commas and newlines and de-duplicates', () => {
    expect(parseNameList('Yuki Furukawa, Toshi Furukawa\nYuki Furukawa')).toEqual([
      'Yuki Furukawa',
      'Toshi Furukawa',
    ])
  })
})

describe('parseYearMonth', () => {
  it('accepts YYYY and YYYY-MM', () => {
    expect(parseYearMonth('2020')).toBe('2020')
    expect(parseYearMonth('2020-04')).toBe('2020-04')
  })

  it('rejects anything else, including an impossible month', () => {
    expect(parseYearMonth('')).toBeUndefined()
    expect(parseYearMonth('2020-13')).toBeUndefined()
    expect(parseYearMonth('20-04')).toBeUndefined()
  })
})
