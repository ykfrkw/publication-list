import { describe, expect, it } from 'vitest'
import {
  formatCategoryPinRef,
  formatIdRef,
  isOrcidId,
  isResearchmapId,
  matchesIdRef,
  normalizeDoi,
  normalizeOrcid,
  normalizeResearchmapId,
  parseIdRef,
  pubKey,
  sameIdRef,
  stripDoiVersion,
  titleSlug,
  VERSIONED_DOI_PREFIXES,
} from '../ids'

describe('normalizeDoi', () => {
  it('lowercases and trims', () => {
    expect(normalizeDoi('  10.1136/BMJ.N71 ')).toBe('10.1136/bmj.n71')
  })

  it('strips doi.org prefixes', () => {
    expect(normalizeDoi('https://doi.org/10.1136/bmj.n71')).toBe(
      '10.1136/bmj.n71',
    )
    expect(normalizeDoi('http://dx.doi.org/10.1136/bmj.n71')).toBe(
      '10.1136/bmj.n71',
    )
  })

  it('strips a trailing slash', () => {
    expect(normalizeDoi('10.1136/bmj.n71/')).toBe('10.1136/bmj.n71')
  })
})

describe('normalizeOrcid / normalizeResearchmapId', () => {
  it('strips the orcid.org prefix and uppercases the checksum', () => {
    expect(normalizeOrcid('https://orcid.org/0000-0003-1317-022x')).toBe(
      '0000-0003-1317-022X',
    )
  })

  it('keeps only the first researchmap path segment', () => {
    expect(normalizeResearchmapId('https://researchmap.jp/yfurukawa/works')).toBe(
      'yfurukawa',
    )
    expect(normalizeResearchmapId(' yfurukawa/ ')).toBe('yfurukawa')
  })
})

describe('id type detection', () => {
  it('recognizes ORCID ids', () => {
    expect(isOrcidId('0000-0003-1317-0220')).toBe(true)
    expect(isOrcidId('yfurukawa')).toBe(false)
  })

  it('recognizes researchmap ids but not ORCID ids', () => {
    expect(isResearchmapId('yfurukawa')).toBe(true)
    expect(isResearchmapId('0000-0003-1317-0220')).toBe(false)
    expect(isResearchmapId('Yuki Furukawa')).toBe(false)
  })
})

describe('stripDoiVersion', () => {
  it('splits an F1000-style versioned DOI', () => {
    expect(stripDoiVersion('10.12688/f1000research.12345.3')).toEqual({
      doi: '10.12688/f1000research.12345',
      version: 3,
    })
  })

  it('handles two-digit versions', () => {
    expect(stripDoiVersion('10.12688/wellcomeopenres.23033.12')).toEqual({
      doi: '10.12688/wellcomeopenres.23033',
      version: 12,
    })
  })

  it('leaves an unversioned DOI alone', () => {
    expect(stripDoiVersion('10.1136/bmj.n71')).toEqual({ doi: '10.1136/bmj.n71' })
  })

  it('does not treat a ".0" suffix as a version', () => {
    expect(stripDoiVersion('10.1000/xyz.0')).toEqual({ doi: '10.1000/xyz.0' })
  })

  it('only strips versions for publishers that actually version', () => {
    // 10.7717/peerj.55 is an early PeerJ article, not "peerj version 55".
    expect(stripDoiVersion('10.7717/peerj.55')).toEqual({
      doi: '10.7717/peerj.55',
    })
    expect(stripDoiVersion('10.7717/peerj.55').version).toBeUndefined()
    expect(stripDoiVersion('10.1371/journal.pone.7')).toEqual({
      doi: '10.1371/journal.pone.7',
    })
  })

  it('lists the versioning prefixes it knows about', () => {
    expect(VERSIONED_DOI_PREFIXES).toContain('10.12688/')
  })

  it('normalizes before splitting', () => {
    expect(stripDoiVersion('https://doi.org/10.12688/F1000Research.12345.2')).toEqual(
      { doi: '10.12688/f1000research.12345', version: 2 },
    )
  })
})

describe('pubKey', () => {
  it('prefers DOI over PMID and title', () => {
    expect(
      pubKey({ title: 'A trial', doi: 'https://doi.org/10.1136/BMJ.n71', pmid: '33782057' }),
    ).toBe('doi:10.1136/bmj.n71')
  })

  it('falls back to PMID when there is no DOI', () => {
    expect(pubKey({ title: 'A trial', pmid: '33782057' })).toBe('pmid:33782057')
    expect(pubKey({ title: 'A trial', doi: '  ', pmid: '33782057' })).toBe(
      'pmid:33782057',
    )
  })

  it('falls back to a title slug when there is no identifier', () => {
    expect(pubKey({ title: '  Sleep, CBT-I:  a Review! ' })).toBe(
      'title:sleepcbtiareview',
    )
  })

  it('collapses versioned DOIs onto one key', () => {
    const v1 = pubKey({ title: 'x', doi: '10.12688/f1000research.12345.1' })
    const v3 = pubKey({ title: 'x', doi: '10.12688/f1000research.12345.3' })
    expect(v1).toBe(v3)
  })

  it('keeps unrelated short-numbered DOIs on separate keys', () => {
    const a = pubKey({ title: 'x', doi: '10.7717/peerj.55' })
    const b = pubKey({ title: 'y', doi: '10.7717/peerj.56' })
    expect(a).toBe('doi:10.7717/peerj.55')
    expect(a).not.toBe(b)
  })
})

describe('titleSlug', () => {
  it('truncates to 80 characters', () => {
    expect(titleSlug('a'.repeat(200))).toHaveLength(80)
  })

  it('keeps non-latin letters', () => {
    expect(titleSlug('不眠症の認知行動療法')).toBe('不眠症の認知行動療法')
  })
})

describe('parseIdRef', () => {
  it('parses the canonical prefixed forms', () => {
    expect(parseIdRef('pmid:33782057')).toEqual({ kind: 'pmid', value: '33782057' })
    expect(parseIdRef('doi:10.1136/BMJ.n71')).toEqual({
      kind: 'doi',
      value: '10.1136/bmj.n71',
    })
  })

  it('accepts bare identifiers', () => {
    expect(parseIdRef(' 33782057 ')).toEqual({ kind: 'pmid', value: '33782057' })
    expect(parseIdRef('https://doi.org/10.1136/bmj.n71')).toEqual({
      kind: 'doi',
      value: '10.1136/bmj.n71',
    })
  })

  it('rejects junk', () => {
    expect(parseIdRef('')).toBeNull()
    expect(parseIdRef('pmid:not-a-number')).toBeNull()
    expect(parseIdRef('doi:nope')).toBeNull()
    expect(parseIdRef('Furukawa Y')).toBeNull()
  })
})

describe('formatIdRef', () => {
  it('mirrors pubKey precedence', () => {
    expect(formatIdRef({ title: 'x', doi: '10.1136/bmj.n71', pmid: '1' })).toBe(
      'doi:10.1136/bmj.n71',
    )
    expect(formatIdRef({ title: 'x', pmid: '33782057' })).toBe('pmid:33782057')
    expect(formatIdRef({ title: 'x' })).toBeNull()
  })

  it('round-trips through parseIdRef', () => {
    const ref = formatIdRef({ title: 'x', doi: '10.12688/f1000research.12345.4' })
    expect(ref).toBe('doi:10.12688/f1000research.12345')
    expect(parseIdRef(ref!)).toEqual({
      kind: 'doi',
      value: '10.12688/f1000research.12345',
    })
  })
})

describe('rm: references', () => {
  it('parses the prefixed form, digits only', () => {
    expect(parseIdRef('rm:123456789')).toEqual({ kind: 'rm', value: '123456789' })
    expect(parseIdRef(' RM: 42 ')).toEqual({ kind: 'rm', value: '42' })
    expect(parseIdRef('rm:abc')).toBeNull()
    expect(parseIdRef('rm:')).toBeNull()
  })

  it('has no bare form — bare digits already mean a PMID', () => {
    expect(parseIdRef('123456789')).toEqual({ kind: 'pmid', value: '123456789' })
  })

  it('matches a record by its rmId and nothing else', () => {
    const ref = parseIdRef('rm:42')!
    expect(matchesIdRef({ rmId: '42' }, ref)).toBe(true)
    expect(matchesIdRef({ rmId: '43' }, ref)).toBe(false)
    // A record without an rmId — every record today — never matches.
    expect(matchesIdRef({ doi: '10.1136/bmj.n71', pmid: '42' }, ref)).toBe(false)
  })

  it('compares two rm refs by exact value in sameIdRef', () => {
    expect(sameIdRef({ kind: 'rm', value: '42' }, { kind: 'rm', value: '42' })).toBe(
      true,
    )
    expect(sameIdRef({ kind: 'rm', value: '42' }, { kind: 'rm', value: '43' })).toBe(
      false,
    )
    // Kinds never cross: rm:42 is not pmid:42.
    expect(sameIdRef({ kind: 'rm', value: '42' }, { kind: 'pmid', value: '42' })).toBe(
      false,
    )
  })

  it('stays outside formatIdRef, which include/exclude must be able to fetch', () => {
    expect(formatIdRef({ title: 'x', rmId: '42' } as never)).toBeNull()
  })
})

describe('formatCategoryPinRef', () => {
  it('falls back doi → pmid → rm → undefined', () => {
    expect(
      formatCategoryPinRef({ title: 'x', doi: '10.1136/bmj.n71', pmid: '1', rmId: '2' }),
    ).toBe('doi:10.1136/bmj.n71')
    expect(formatCategoryPinRef({ title: 'x', pmid: '1', rmId: '2' })).toBe('pmid:1')
    expect(formatCategoryPinRef({ title: 'x', rmId: '2' })).toBe('rm:2')
    expect(formatCategoryPinRef({ title: 'x' })).toBeUndefined()
    expect(formatCategoryPinRef({ title: 'x', doi: ' ', pmid: '', rmId: ' 2 ' })).toBe(
      'rm:2',
    )
  })

  it('round-trips through parseIdRef and matchesIdRef', () => {
    const ref = formatCategoryPinRef({ title: 'x', rmId: '123456789' })!
    const parsed = parseIdRef(ref)!
    expect(parsed).toEqual({ kind: 'rm', value: '123456789' })
    expect(matchesIdRef({ rmId: '123456789' }, parsed)).toBe(true)
  })

  it('strips a DOI version, agreeing with formatIdRef', () => {
    expect(
      formatCategoryPinRef({ title: 'x', doi: '10.12688/f1000research.12345.4' }),
    ).toBe('doi:10.12688/f1000research.12345')
  })
})
