import { describe, expect, it } from 'vitest'
import {
  appendMemberLine,
  commentOutLine,
  detectCollectiveAuthorQueries,
  detectCollectiveAuthorQuery,
  detectPmidQueries,
  detectPmidQuery,
  formatMemberLine,
  formatMemberWindow,
  nextMemberLineIndex,
  parseIdList,
  parseMemberLines,
  parseMemberWindow,
  parseMemberWindowToken,
  parseNameList,
  parsePubmedQueries,
  parseYearMonth,
  removeMemberLine,
  setMemberField,
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

  /**
   * The `id@from:to:grace` spelling is what the `data-*` attributes carry, so it
   * is the one a user reads out of their own snippet. Accepted here as well —
   * read, not rewritten: the line keeps the spelling it was typed in until the
   * user edits that member's dates.
   */
  it('reads the @ spelling the snippet attributes use', () => {
    const { members } = parseMemberLines(
      'Yuki Furukawa\t0000-0003-1317-0220@2019-04:2023-03:36',
    )
    expect(members[0]).toEqual({
      raw: 'Yuki Furukawa\t0000-0003-1317-0220@2019-04:2023-03:36',
      lineIndex: 0,
      name: 'Yuki Furukawa',
      orcid: '0000-0003-1317-0220',
      from: '2019-04',
      to: '2023-03',
      grace: 36,
    })
  })

  it('takes only the dates off an @ token, never the identifier', () => {
    expect(parseMemberWindowToken('0000-0003-1317-0220@2019-04')).toEqual({
      rest: '0000-0003-1317-0220',
      window: { from: '2019-04' },
    })
    expect(parseMemberWindowToken('2019-04..2023-03')).toEqual({
      rest: '',
      window: { from: '2019-04', to: '2023-03' },
    })
  })

  it('does not mistake an email address for a window', () => {
    for (const token of [
      'someone@example.com',
      'yuki.furukawa@example.co.jp',
      'someone@',
      '@2019-04',
      'a@b@2019',
    ]) {
      expect(parseMemberWindowToken(token)).toBeNull()
    }
  })

  it('leaves an email in a pasted column exactly where it was', () => {
    const line = 'Yuki Furukawa\tsomeone@example.com\t0000-0003-1317-0220'
    const { members } = parseMemberLines(line)
    expect(members[0].from).toBeUndefined()
    expect(members[0].to).toBeUndefined()
    expect(members[0].orcid).toBe('0000-0003-1317-0220')
    // Whatever the address is taken for, it is what it was taken for before.
    expect(members[0].researchmap).toBe('someone@example.com')
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

/**
 * The window half of `setMemberField`, which is where the member rows' Joined
 * and Left fields land. These were `setMemberWindow`'s tests; that function was
 * a second, narrower editor of the same line and has been folded in, so a row
 * writes every field through one path and cannot produce a line that no single
 * editor would have written.
 */
describe('setMemberField — the time window', () => {
  const text = '0000-0003-1317-0220\n0000-0002-1825-0097'

  it('appends a window to the right line and leaves the others alone', () => {
    expect(setMemberField(text, 1, { to: '2023-03' })).toBe(
      '0000-0003-1317-0220\n0000-0002-1825-0097\t..2023-03',
    )
  })

  it('replaces a window rather than stacking a second one', () => {
    const once = setMemberField(text, 0, { from: '2019-04' })
    const twice = setMemberField(once, 0, { from: '2019-04', to: '2023-03' })
    expect(twice.split('\n')[0]).toBe('0000-0003-1317-0220\t2019-04..2023-03')
  })

  it('replaces an @ window with the canonical form, keeping the identifier', () => {
    const text = '0000-0003-1317-0220@2019-04:2023-03'
    expect(setMemberField(text, 0, { from: '2019-04', to: '2024-03' })).toBe(
      '0000-0003-1317-0220\t2019-04..2024-03',
    )
    expect(setMemberField(text, 0, { from: '', to: '' })).toBe(
      '0000-0003-1317-0220',
    )
  })

  it('clears the window when both dates are emptied', () => {
    const once = setMemberField(text, 0, { from: '2019-04', to: '2023-03' })
    expect(setMemberField(once, 0, { from: '', to: '' })).toBe(text)
  })

  it('keeps a non-default grace period through a date edit', () => {
    const text = '0000-0003-1317-0220\t2019-04..2023-03+36'
    expect(setMemberField(text, 0, { to: '2024-03' })).toBe(
      '0000-0003-1317-0220\t2019-04..2024-03+36',
    )
  })

  it('ignores an out-of-range line', () => {
    expect(setMemberField(text, 9, { to: '2023-03' })).toBe(text)
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
 * The line editors the member rows are built on.
 *
 * Every field of every row writes through one of these, so the invariant they
 * all have to hold is the same one: **one line changes and the rest of the box
 * comes out byte-identical**. A lab list is somebody's hand-written file, and a
 * tool that reflows it while a date is being typed is a tool they stop trusting.
 */
describe('the member-line editors', () => {
  const A = '0000-0003-1317-0220'
  const B = '0000-0002-1825-0097'

  describe('formatMemberLine', () => {
    it('writes the canonical column order', () => {
      expect(
        formatMemberLine({
          name: 'Yuki Furukawa',
          orcid: A,
          researchmap: 'furukawayuki',
          from: '2019-04',
          to: '2023-03',
          grace: 36,
        }),
      ).toBe(`Yuki Furukawa\t${A}\tfurukawayuki\t2019-04..2023-03+36`)
    })

    it('drops the cells there is nothing to put in', () => {
      // A member with only an iD stays the bare line a pasted list has always
      // been, so `draftToConfig` still projects it onto a bare-string seed.
      expect(formatMemberLine({ orcid: A })).toBe(A)
      expect(formatMemberLine({})).toBe('')
      expect(formatMemberLine({ name: '  ', orcid: '' })).toBe('')
    })

    it('round-trips through the parser', () => {
      const line = formatMemberLine({
        name: 'Yuki Furukawa',
        orcid: A,
        researchmap: 'furukawayuki',
        from: '2019-04',
        to: '2023-03',
      })
      const { members } = parseMemberLines(line)
      expect(members[0]).toMatchObject({
        name: 'Yuki Furukawa',
        orcid: A,
        researchmap: 'furukawayuki',
        from: '2019-04',
        to: '2023-03',
      })
    })
  })

  describe('setMemberField', () => {
    it('sets a name without disturbing the member’s window token', () => {
      const text = `${B}\t2019-04..2023-03+36`
      expect(setMemberField(text, 0, { name: 'Yuki Furukawa' })).toBe(
        `Yuki Furukawa\t${B}\t2019-04..2023-03+36`,
      )
    })

    it('leaves every other line byte-identical', () => {
      const text = `${A}\n${B}\t2019-04..\nhttps://researchmap.jp/someone`
      const next = setMemberField(text, 1, { orcid: '0000-0002-9999-0000' })
      const before = text.split('\n')
      const after = next.split('\n')
      expect(after[0]).toBe(before[0])
      expect(after[2]).toBe(before[2])
      expect(after[1]).toBe('0000-0002-9999-0000\t2019-04..')
    })

    it('clears a field when given an empty string', () => {
      const text = `Yuki Furukawa\t${A}`
      expect(setMemberField(text, 0, { name: '' })).toBe(A)
    })

    it('keeps the fields the patch does not mention', () => {
      const text = `Yuki Furukawa\t${A}\tfurukawayuki`
      expect(setMemberField(text, 0, { researchmap: 'someone' })).toBe(
        `Yuki Furukawa\t${A}\tsomeone`,
      )
    })

    it('ignores an out-of-range line', () => {
      expect(setMemberField(A, 9, { name: 'x' })).toBe(A)
    })
  })

  describe('appendMemberLine', () => {
    it('adds exactly one line at the end', () => {
      const text = `${A}\n${B}`
      const next = appendMemberLine(text, { name: 'New Person', orcid: A })
      expect(next.split('\n')).toEqual([A, B, `New Person\t${A}`])
      expect(next.startsWith(`${text}\n`)).toBe(true)
    })

    it('fills a trailing blank line rather than leaving a gap', () => {
      expect(appendMemberLine(`${A}\n`, { orcid: B })).toBe(`${A}\n${B}`)
      expect(appendMemberLine('', { orcid: B })).toBe(B)
    })

    it('adds nothing when there is nothing to add', () => {
      expect(appendMemberLine(A, {})).toBe(A)
      expect(appendMemberLine(A, { name: '   ' })).toBe(A)
    })

    /**
     * The rows key the not-yet-created row by the line it is about to become,
     * so that typing the first character does not change the React key and
     * remount the input. That only holds while these two agree.
     */
    it('lands on the index nextMemberLineIndex promised', () => {
      for (const text of ['', A, `${A}\n`, `${A}\n${B}`, '# frozen\n']) {
        const index = nextMemberLineIndex(text)
        const next = appendMemberLine(text, { orcid: B })
        expect(next.split('\n')[index]).toBe(B)
      }
    })
  })

  describe('removeMemberLine', () => {
    it('takes one line out and leaves the others byte-identical', () => {
      const text = `Yuki Furukawa\t${A}\n${B}\t2019-04..2023-03\nsomeone`
      expect(removeMemberLine(text, 1)).toBe(
        `Yuki Furukawa\t${A}\nsomeone`,
      )
    })

    it('empties the box when the last member goes', () => {
      expect(removeMemberLine(A, 0)).toBe('')
    })

    it('ignores an out-of-range line', () => {
      expect(removeMemberLine(A, 9)).toBe(A)
    })
  })

  /**
   * A frozen member's line is the record of the freeze *and* the means of
   * undoing it — "delete the `#` and the seed is back", which `docs/lab-setup.md`
   * promises. None of the editors may rewrite one, and editing anybody else must
   * leave it byte-identical.
   */
  describe('a frozen line', () => {
    const frozen = `# frozen 2026-08-06 — 11 paper(s) pinned\t${B}`
    const text = `${frozen}\n${A}`

    it('is not rewritten by setMemberField', () => {
      expect(setMemberField(text, 0, { name: 'Yuki Furukawa' })).toBe(text)
    })

    it('is not deleted by removeMemberLine', () => {
      expect(removeMemberLine(text, 0)).toBe(text)
    })

    it('survives byte-identical when another member is edited', () => {
      expect(setMemberField(text, 1, { name: 'Yuki Furukawa' })).toBe(
        `${frozen}\nYuki Furukawa\t${A}`,
      )
      expect(removeMemberLine(text, 1)).toBe(frozen)
      expect(appendMemberLine(text, { orcid: '0000-0002-9999-0000' })).toBe(
        `${text}\n0000-0002-9999-0000`,
      )
    })
  })
})

/**
 * `rows` is the editing surface; `members` is the seed list. They differ on the
 * states a list passes *through* — a member named before their iD is typed, an
 * iD halfway through being corrected — which is exactly when a row must not
 * disappear out from under the cursor.
 */
describe('parseMemberLines rows', () => {
  it('keeps a line that carries no identifier yet', () => {
    const { members, invalid, rows } = parseMemberLines(
      '0000-0003-1317-0220\nYuki Furukawa',
    )
    expect(members).toHaveLength(1)
    expect(invalid).toEqual(['Yuki Furukawa'])
    expect(rows.map((r) => r.lineIndex)).toEqual([0, 1])
    expect(rows[1].orcid).toBeUndefined()
  })

  it('has no row for a blank, a comment or a header', () => {
    const { rows } = parseMemberLines(
      'Name\tORCID\n\n# frozen 2026-08-06\t0000-0002-1825-0097\n0000-0003-1317-0220',
    )
    expect(rows.map((r) => r.lineIndex)).toEqual([3])
  })

  it('shows a repeated member as its own row, though it seeds once', () => {
    const text = '0000-0003-1317-0220\n0000-0003-1317-0220'
    const { members, rows } = parseMemberLines(text)
    expect(members).toHaveLength(1)
    expect(rows).toHaveLength(2)
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

/**
 * A group name searched in the personal-author field.
 *
 * Measured against the live E-utilities API on 2026-08-06:
 * `"RECOVERY Collaborative Group"[au]` returns 0 records, and the identical
 * phrase against `[cn]` returns 18, which PubMed translates as
 * `[Author - Corporate]`. So `[au]` returning nothing is not evidence that a
 * group is absent from PubMed — it is evidence that the wrong field was
 * searched, and the hint exists to stop that inference.
 *
 * The rule leans towards firing: a false hint costs a sentence of reading, a
 * missed one costs a list that stays empty for a reason nobody can see. What it
 * must not do is fire on ordinary personal-name searches, which is what the
 * second block below pins.
 */
describe('detectCollectiveAuthorQuery', () => {
  it('fires on a quoted multi-word group name against [au]', () => {
    const hint = detectCollectiveAuthorQuery('"RECOVERY Collaborative Group"[au]')
    expect(hint).not.toBeNull()
    expect(hint?.names).toEqual(['RECOVERY Collaborative Group'])
    expect(hint?.reason).toBe('collective-word')
  })

  it('fires on a bare acronym against [au]', () => {
    expect(detectCollectiveAuthorQuery('SLEEPI[au]')?.reason).toBe('acronym')
    expect(detectCollectiveAuthorQuery('SLEEP-I[au]')?.reason).toBe('acronym')
    // The owner's own query, verbatim: quoted acronym, long-form field name.
    expect(detectCollectiveAuthorQuery('("SLEEPI"[author])')?.names).toEqual([
      'SLEEPI',
    ])
  })

  it('fires on a three-word quoted phrase that is not a personal name', () => {
    const hint = detectCollectiveAuthorQuery('"Tokyo Sleep Initiative"[au]')
    expect(hint?.reason).toBe('collective-word')
    expect(detectCollectiveAuthorQuery('"Kanto Regional Sleep Board"[au]')?.reason)
      .toBe('phrase')
  })

  it('does not fire on Furukawa Y[au]', () => {
    // The single most common shape in this tool, and the one a false positive
    // would nag every user of the wizard about.
    expect(detectCollectiveAuthorQuery('Furukawa Y[au]')).toBeNull()
    expect(detectCollectiveAuthorQuery('Furukawa Y[au] AND (Tokyo[ad])')).toBeNull()
    expect(
      detectCollectiveAuthorQuery('Tanaka H[au] AND ("Univ Tokyo"[ad]) AND 2019:2026[dp]'),
    ).toBeNull()
  })

  it('does not fire on other personal-name spellings', () => {
    expect(detectCollectiveAuthorQuery('"Yuki Furukawa"[au]')).toBeNull()
    // Three words, but ending in initials: a surname with particles.
    expect(detectCollectiveAuthorQuery('"van der Berg AB"[au]')).toBeNull()
    expect(detectCollectiveAuthorQuery('0000-0003-1317-0220[auid]')).toBeNull()
    expect(detectCollectiveAuthorQuery('"Univ Tokyo"[ad]')).toBeNull()
  })

  it('leaves a query that already uses [cn] alone', () => {
    expect(detectCollectiveAuthorQuery('"RECOVERY Collaborative Group"[cn]')).toBeNull()
    // Someone covering both fields has understood the distinction already.
    expect(
      detectCollectiveAuthorQuery('"SLEEPI"[au] OR "SLEEPI"[cn]'),
    ).toBeNull()
  })

  it('reads the whole textarea, one hint per offending line', () => {
    const hints = detectCollectiveAuthorQueries(
      'Furukawa Y[au] AND (Tokyo[ad])\n# a comment\nSLEEPI[au]\n"RECOVERY Collaborative Group"[cn]',
    )
    expect(hints).toHaveLength(1)
    expect(hints[0].names).toEqual(['SLEEPI'])
  })
})
