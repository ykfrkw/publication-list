import { describe, expect, it } from 'vitest'
import {
  formatIdRef,
  isOrcidId,
  isResearchmapId,
  normalizeDoi,
  normalizeOrcid,
  normalizeResearchmapId,
  parseIdRef,
  pubKey,
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
