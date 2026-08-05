import { describe, expect, it } from 'vitest'
import { dedupePublications } from '../dedupe'
import { pubKey, stripDoiVersion } from '../ids'
import type { Publication } from '../types'

/**
 * Hand-written fixture. `key` is derived the way the sources do it, so a test
 * never has to keep a key and a DOI in sync by hand.
 */
function pub(overrides: Partial<Publication> & { title: string }): Publication {
  const base: Publication = {
    key: '',
    authors: [],
    authorsFull: [],
    journal: '',
    year: 2024,
    sources: ['orcid'],
    seedIds: ['seed-a'],
    trust: 'confirmed',
    ...overrides,
  }
  if (base.doi) {
    const stripped = stripDoiVersion(base.doi)
    if (stripped.version !== undefined && base.doiVersion === undefined) {
      base.doiVersion = stripped.version
    }
  }
  if (base.key === '') base.key = pubKey(base)
  return base
}

describe('dedupePublications', () => {
  it('returns an empty result for empty input', () => {
    expect(dedupePublications([])).toEqual({ publications: [], warnings: [] })
  })

  it('leaves distinct publications alone', () => {
    const input = [
      pub({ title: 'A', doi: '10.1136/bmj.n71' }),
      pub({ title: 'B', pmid: '33782057' }),
    ]
    const { publications, warnings } = dedupePublications(input)
    expect(publications).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  it('collapses F1000 v1/v2/v3 and keeps the latest version metadata', () => {
    // Deliberately out of order: v3 arrives last.
    const input = [
      pub({
        title: 'An open trial (version 1; peer review: 1 not approved)',
        doi: '10.12688/f1000research.12345.1',
        journal: 'F1000Research',
        peerReviewApproved: false,
        sources: ['orcid'],
        seedIds: ['orcid-a'],
      }),
      pub({
        title: 'An open trial (version 2; peer review: 1 approved)',
        doi: '10.12688/f1000research.12345.2',
        journal: 'F1000Research',
        peerReviewApproved: false,
        sources: ['orcid'],
        seedIds: ['orcid-a'],
      }),
      pub({
        title: 'An open trial (version 3; peer review: 2 approved)',
        doi: '10.12688/f1000research.12345.3',
        journal: 'F1000Research',
        peerReviewApproved: true,
        month: 7,
        sources: ['pubmed'],
        seedIds: ['pubmed-a'],
      }),
    ]

    const { publications } = dedupePublications(input)

    expect(publications).toHaveLength(1)
    const [merged] = publications
    // v3's metadata wins, not the first-arrived record's.
    expect(merged.title).toBe(
      'An open trial (version 3; peer review: 2 approved)',
    )
    expect(merged.doi).toBe('10.12688/f1000research.12345.3')
    expect(merged.doiVersion).toBe(3)
    expect(merged.peerReviewApproved).toBe(true)
    expect(merged.month).toBe(7)
    expect(merged.key).toBe('doi:10.12688/f1000research.12345')
    expect(merged.sources).toEqual(['pubmed', 'orcid'])
    expect(merged.seedIds).toEqual(['pubmed-a', 'orcid-a'])
  })

  it('keeps the latest version even when the versions arrive in order', () => {
    const input = [
      pub({ title: 'v3', doi: '10.12688/wellcomeopenres.23033.3' }),
      pub({ title: 'v1', doi: '10.12688/wellcomeopenres.23033.1' }),
    ]
    const { publications } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(publications[0].title).toBe('v3')
    expect(publications[0].doiVersion).toBe(3)
  })

  it('does NOT merge short-numbered DOIs from a non-versioning publisher', () => {
    // 10.7717/peerj.55 and .56 are two unrelated PeerJ articles.
    const input = [
      pub({ title: 'PeerJ article 55', doi: '10.7717/peerj.55' }),
      pub({ title: 'PeerJ article 56', doi: '10.7717/peerj.56' }),
    ]
    const { publications, warnings } = dedupePublications(input)
    expect(publications).toHaveLength(2)
    expect(publications.map((p) => p.key)).toEqual([
      'doi:10.7717/peerj.55',
      'doi:10.7717/peerj.56',
    ])
    expect(publications[0].doiVersion).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('merges sources and seedIds for records sharing a key', () => {
    const input = [
      pub({
        title: 'Shared work',
        doi: '10.1136/bmj.n71',
        sources: ['orcid'],
        seedIds: ['orcid-0000'],
      }),
      pub({
        title: 'Shared work',
        doi: '10.1136/bmj.n71',
        sources: ['researchmap'],
        seedIds: ['rm-yfurukawa'],
      }),
    ]
    const { publications } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(publications[0].sources).toEqual(['orcid', 'researchmap'])
    expect(publications[0].seedIds).toEqual(['orcid-0000', 'rm-yfurukawa'])
  })

  it('merges a DOI-keyed and a PMID-keyed record of the same work', () => {
    const input = [
      pub({
        title: 'Cognitive behavioural therapy for insomnia',
        doi: '10.1001/jamapsychiatry.2024.0001',
        journal: 'JAMA Psychiatry',
        year: 2024,
        sources: ['orcid'],
        seedIds: ['orcid-0000'],
        authors: ['Furukawa Y'],
      }),
      pub({
        // Same work, no DOI on this record: keyed by PMID.
        title: 'Cognitive Behavioural Therapy for Insomnia',
        pmid: '38123456',
        journal: 'JAMA Psychiatry',
        year: 2024,
        sources: ['pubmed'],
        seedIds: ['pubmed-auid'],
        authors: ['Furukawa Y', 'Sakata M', 'Furukawa TA'],
      }),
    ]

    const { publications, warnings } = dedupePublications(input)

    expect(publications).toHaveLength(1)
    const [merged] = publications
    // DOI-keyed record is the better base, so its key survives...
    expect(merged.key).toBe('doi:10.1001/jamapsychiatry.2024.0001')
    // ...but nothing the PMID record knew is lost.
    expect(merged.pmid).toBe('38123456')
    expect(merged.sources).toEqual(['orcid', 'pubmed'])
    expect(merged.seedIds).toEqual(['orcid-0000', 'pubmed-auid'])
    // The longer author list wins over the truncated one.
    expect(merged.authors).toEqual(['Furukawa Y', 'Sakata M', 'Furukawa TA'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Cognitive behavioural therapy for insomnia')
  })

  it('warns by name when a same-title/same-year merge happens', () => {
    const input = [
      pub({ title: 'Sleep and mood: a review', doi: '10.1/a', year: 2023 }),
      pub({ title: 'Sleep and Mood: A Review!', doi: '10.1/b', year: 2023 }),
    ]
    const { publications, warnings } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Sleep and mood: a review')
    expect(warnings[0]).toContain('2023')
    expect(warnings[0]).toContain('doi:10.1/a')
    expect(warnings[0]).toContain('doi:10.1/b')
  })

  it('does not merge the same title published in different years', () => {
    const input = [
      pub({ title: 'Annual report', doi: '10.1/a', year: 2023 }),
      pub({ title: 'Annual report', doi: '10.1/b', year: 2024 }),
    ]
    const { publications, warnings } = dedupePublications(input)
    expect(publications).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  it('promotes trust to confirmed when any record in the group is confirmed', () => {
    const input = [
      pub({
        title: 'A candidate hit',
        doi: '10.1/x',
        trust: 'candidate',
        sources: ['pubmed'],
      }),
      pub({
        title: 'A candidate hit',
        doi: '10.1/x',
        trust: 'confirmed',
        sources: ['orcid'],
      }),
    ]
    const { publications } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(publications[0].trust).toBe('confirmed')
  })

  it('stays candidate when no record is confirmed', () => {
    const input = [
      pub({ title: 'Unconfirmed', doi: '10.1/y', trust: 'candidate' }),
      pub({ title: 'Unconfirmed', doi: '10.1/y', trust: 'candidate' }),
    ]
    const { publications } = dedupePublications(input)
    expect(publications[0].trust).toBe('candidate')
  })

  it('fills scalar gaps from lower-priority records', () => {
    const input = [
      pub({
        title: 'Gappy',
        doi: '10.12688/f1000research.999.2',
        journal: '',
        month: undefined,
        language: undefined,
      }),
      pub({
        title: 'Gappy',
        doi: '10.12688/f1000research.999.1',
        journal: 'F1000Research',
        month: 3,
        language: 'en',
        orcidType: 'preprint',
      }),
    ]
    const { publications } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(publications[0].doiVersion).toBe(2)
    expect(publications[0].journal).toBe('F1000Research')
    expect(publications[0].month).toBe(3)
    expect(publications[0].language).toBe('en')
    expect(publications[0].orcidType).toBe('preprint')
  })

  it('is deterministic in output order (first-seen key order)', () => {
    const input = [
      pub({ title: 'Zeta', doi: '10.1/z' }),
      pub({ title: 'Alpha', doi: '10.1/a' }),
      pub({ title: 'Zeta', doi: '10.1/z', sources: ['pubmed'] }),
      pub({ title: 'Mid', pmid: '111' }),
    ]
    const run = () => dedupePublications(input).publications.map((p) => p.key)
    expect(run()).toEqual(['doi:10.1/z', 'doi:10.1/a', 'pmid:111'])
    expect(run()).toEqual(run())
  })

  it('groups title-slug-keyed records without warning (same key, not a heuristic merge)', () => {
    const input = [
      pub({ title: 'No identifiers here', year: 2022, sources: ['manual'] }),
      pub({ title: 'No Identifiers Here.', year: 2022, sources: ['orcid'] }),
    ]
    const { publications, warnings } = dedupePublications(input)
    expect(publications).toHaveLength(1)
    expect(publications[0].key).toBe('title:noidentifiershere')
    expect(publications[0].sources).toEqual(['manual', 'orcid'])
    expect(warnings).toEqual([])
  })
})
