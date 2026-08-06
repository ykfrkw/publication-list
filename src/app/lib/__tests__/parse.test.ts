import { describe, expect, it } from 'vitest'
import {
  commentOutLine,
  detectPmidQueries,
  detectPmidQuery,
  formatMemberWindow,
  parseIdList,
  parseMemberLines,
  parseMemberWindow,
  parseNameList,
  parsePubmedQueries,
  parseYearMonth,
  setMemberWindow,
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
      { raw: '0000-0003-1317-0220', lineIndex: 0, orcid: '0000-0003-1317-0220' },
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
      lineIndex: 0,
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

describe('member time windows in the pasted list', () => {
  it('reads every shape of window token', () => {
    expect(parseMemberWindow('2019-04..2023-03')).toEqual({
      from: '2019-04',
      to: '2023-03',
    })
    expect(parseMemberWindow('2019-04..')).toEqual({ from: '2019-04' })
    expect(parseMemberWindow('..2023-03')).toEqual({ to: '2023-03' })
    expect(parseMemberWindow('2019..2023+36')).toEqual({
      from: '2019',
      to: '2023',
      grace: 36,
    })
  })

  it('is not fooled by anything that is not a window', () => {
    for (const token of ['furukawayuki', 'Yuki', '..', '2019-04', 'a..b']) {
      expect(parseMemberWindow(token)).toBeNull()
    }
  })

  it('round-trips through formatMemberWindow', () => {
    for (const token of ['2019-04..2023-03', '2019-04..', '..2023-03', '2019..2023+36']) {
      expect(formatMemberWindow(parseMemberWindow(token))).toBe(token)
    }
    expect(formatMemberWindow(null)).toBe('')
  })

  it('picks the window out of a pasted row without disturbing the rest', () => {
    const { members } = parseMemberLines(
      'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki\t2019-04..2023-03',
    )
    expect(members[0]).toEqual({
      raw: 'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki\t2019-04..2023-03',
      lineIndex: 0,
      name: 'Yuki Furukawa',
      orcid: '0000-0003-1317-0220',
      researchmap: 'furukawayuki',
      from: '2019-04',
      to: '2023-03',
    })
  })

  it('leaves a line without dates exactly as it was', () => {
    const { members } = parseMemberLines('0000-0003-1317-0220')
    expect(members[0].from).toBeUndefined()
    expect(members[0].to).toBeUndefined()
    expect(members[0].grace).toBeUndefined()
  })

  it('numbers lines as they appear, blank and commented ones included', () => {
    const { members } = parseMemberLines(
      '# a comment\n\n0000-0003-1317-0220\n\n0000-0002-1825-0097',
    )
    expect(members.map((m) => m.lineIndex)).toEqual([2, 4])
  })
})

describe('setMemberWindow', () => {
  const text = '0000-0003-1317-0220\n0000-0002-1825-0097'

  it('appends a window to the right line and leaves the others alone', () => {
    expect(setMemberWindow(text, 1, { to: '2023-03' })).toBe(
      '0000-0003-1317-0220\n0000-0002-1825-0097\t..2023-03',
    )
  })

  it('replaces a window rather than stacking a second one', () => {
    const once = setMemberWindow(text, 0, { from: '2019-04' })
    const twice = setMemberWindow(once, 0, { from: '2019-04', to: '2023-03' })
    expect(twice.split('\n')[0]).toBe('0000-0003-1317-0220\t2019-04..2023-03')
  })

  it('clears the window when given null', () => {
    const once = setMemberWindow(text, 0, { from: '2019-04', to: '2023-03' })
    expect(setMemberWindow(once, 0, null)).toBe(text)
  })

  it('ignores an out-of-range line', () => {
    expect(setMemberWindow(text, 9, { to: '2023-03' })).toBe(text)
  })
})

describe('commentOutLine', () => {
  it('takes a member out of the seed list while keeping the line readable', () => {
    const text = 'Yuki Furukawa\t0000-0003-1317-0220\n0000-0002-1825-0097'
    const next = commentOutLine(text, 1, 'frozen 2026-08-06')
    expect(next.split('\n')[1]).toBe('# frozen 2026-08-06\t0000-0002-1825-0097')
    // The seed is gone — that is the point — and the other member is not.
    const { members } = parseMemberLines(next)
    expect(members.map((m) => m.orcid)).toEqual(['0000-0003-1317-0220'])
  })

  it('does not comment a line twice', () => {
    const text = '# already\t0000-0002-1825-0097'
    expect(commentOutLine(text, 0, 'again')).toBe(text)
  })
})

/**
 * PMIDs typed into the PubMed-query box.
 *
 * The query this fires on is the one the SLEEPI list was built with, verbatim.
 * It returned exactly the five wanted papers and still produced an empty list,
 * because a query that is not an `[auid]` search yields candidates and a
 * candidate is not published — whereas the same five identifiers in the pinned
 * box are confirmed outright. Detecting the shape is what lets the wizard say
 * so before ten minutes are spent on a snippet that renders nothing.
 */
describe('detectPmidQuery', () => {
  /** The owner's actual configuration, character for character. */
  const OWNER =
    '("SLEEPI"[author]) OR (38231522 [pmid] OR 39242039 [pmid] OR 39188094 [pmid] OR 41061442 [pmid] OR 40703853 [pmid])'

  it('fires on the owner’s query and recovers all five identifiers', () => {
    const hint = detectPmidQuery(OWNER)
    expect(hint).not.toBeNull()
    expect(hint?.refs).toEqual([
      'pmid:38231522',
      'pmid:39242039',
      'pmid:39188094',
      'pmid:41061442',
      'pmid:40703853',
    ])
    // Five of the six field-tagged terms; `[author]` is the sixth.
    expect(hint?.pmidTerms).toBe(5)
    expect(hint?.terms).toBe(6)
  })

  it('fires on a query that is nothing but PMIDs', () => {
    expect(detectPmidQuery('38231522[pmid] OR 39242039[pmid]')?.refs).toHaveLength(2)
    expect(detectPmidQuery('38231522[uid]')?.refs).toEqual(['pmid:38231522'])
  })

  it('does not fire on an ordinary author query', () => {
    expect(detectPmidQuery('Furukawa Y[au] AND (Tokyo[ad])')).toBeNull()
    expect(detectPmidQuery('Tanaka H[au] AND ("Univ Tokyo"[ad]) AND 2019:2026[dp]')).toBeNull()
  })

  it('does not mistake an [auid] search for a [uid] one', () => {
    expect(detectPmidQuery('0000-0003-1317-0220[auid]')).toBeNull()
  })

  it('leaves a real search alone when one PMID is OR-ed onto it', () => {
    // Two field-tagged terms, one of them a PMID: a pin bolted onto a search,
    // not a list of pins. "Mostly" means a strict majority.
    expect(detectPmidQuery('Furukawa Y[au] OR 38231522[pmid]')).toBeNull()
  })

  it('reads the whole textarea, one hint per offending line', () => {
    const hints = detectPmidQueries(
      `Furukawa Y[au] AND (Tokyo[ad])\n# a comment\n${OWNER}\n38231522[pmid]`,
    )
    expect(hints).toHaveLength(2)
    expect(hints[0].refs).toHaveLength(5)
    expect(hints[1].refs).toEqual(['pmid:38231522'])
  })
})
