import { describe, expect, it } from 'vitest'
import type { Publication } from '@/core/types'
import {
  applyReviewDecisions,
  candidateRef,
  draftToConfig,
  emptyDraft,
  hasNameQuery,
  initialChecked,
  isRunnable,
  unreviewedCount,
} from '../wizard'

function pub(overrides: Partial<Publication> & { key: string }): Publication {
  return {
    title: 'A title',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'J Test',
    year: 2024,
    sources: ['pubmed'],
    seedIds: ['Furukawa Y[au]'],
    trust: 'candidate',
    ...overrides,
  }
}

describe('draftToConfig — mode 1, reference list', () => {
  it('puts the pasted identifiers in include and seeds nothing', () => {
    const config = draftToConfig({
      ...emptyDraft('article'),
      pins: '33782057\n10.1136/bmj.n71',
    })
    expect(config.seeds).toEqual({})
    expect(config.include).toEqual(['pmid:33782057', 'doi:10.1136/bmj.n71'])
    expect(config.groupBy).toBe('none')
  })

  it('ignores the PubMed query box, which mode 1 does not show', () => {
    const config = draftToConfig({
      ...emptyDraft('article'),
      pins: '33782057',
      pubmed: 'Furukawa Y[au]',
    })
    expect(config.seeds.pubmed).toBeUndefined()
  })
})

describe('draftToConfig — mode 2, one person', () => {
  it('maps the three seed fields onto ListConfig.seeds', () => {
    const config = draftToConfig({
      ...emptyDraft('person'),
      orcid: 'https://orcid.org/0000-0003-1317-0220',
      researchmap: 'furukawayuki',
      pubmed: '0000-0003-1317-0220[auid]',
      boldNames: 'Yuki Furukawa',
    })
    expect(config.seeds.orcid).toEqual(['0000-0003-1317-0220'])
    expect(config.seeds.researchmap).toEqual(['furukawayuki'])
    expect(config.seeds.pubmed).toEqual([{ query: '0000-0003-1317-0220[auid]' }])
    expect(config.boldNames).toEqual(['Yuki Furukawa'])
    expect(config.groupBy).toBe('category')
  })
})

describe('draftToConfig — mode 3, lab', () => {
  it('fans the pasted member list out into the seed arrays', () => {
    const config = draftToConfig({
      ...emptyDraft('lab'),
      members:
        'Yuki Furukawa\t0000-0003-1317-0220\tfurukawayuki\n0000-0002-1825-0097',
      pubmed: 'SLEEPI[au]',
      pins: '33782057',
    })
    expect(config.seeds.orcid).toEqual([
      '0000-0003-1317-0220',
      '0000-0002-1825-0097',
    ])
    expect(config.seeds.researchmap).toEqual(['furukawayuki'])
    expect(config.seeds.pubmed).toEqual([{ query: 'SLEEPI[au]' }])
    expect(config.include).toEqual(['pmid:33782057'])
  })
})

describe('draftToConfig — shared controls', () => {
  it('carries the filters through and drops malformed ones', () => {
    const config = draftToConfig({
      ...emptyDraft('person'),
      orcid: '0000-0003-1317-0220',
      style: 'apa',
      from: '2020-04',
      to: 'nonsense',
      japanese: 'hide',
      reviewPolicy: 'auto',
      limit: '25',
    })
    expect(config.style).toBe('apa')
    expect(config.from).toBe('2020-04')
    expect(config.to).toBeUndefined()
    expect(config.japanese).toBe('hide')
    expect(config.reviewPolicy).toBe('auto')
    expect(config.limit).toBe(25)
  })

  it('puts typed pins before review-queue confirmations in include', () => {
    const config = draftToConfig({
      ...emptyDraft('lab'),
      pins: '33782057',
      include: ['doi:10.1136/bmj.n71'],
      exclude: ['pmid:1'],
    })
    expect(config.include).toEqual(['pmid:33782057', 'doi:10.1136/bmj.n71'])
    expect(config.exclude).toEqual(['pmid:1'])
  })
})

describe('isRunnable', () => {
  it('is false for an untouched draft and true once there is a seed or a pin', () => {
    expect(isRunnable(emptyDraft('article'))).toBe(false)
    expect(isRunnable({ ...emptyDraft('article'), pins: '33782057' })).toBe(true)
    expect(
      isRunnable({ ...emptyDraft('person'), orcid: '0000-0003-1317-0220' }),
    ).toBe(true)
  })
})

describe('hasNameQuery', () => {
  it('distinguishes an [auid] identifier search from an [au] name search', () => {
    const auid = draftToConfig({
      ...emptyDraft('person'),
      pubmed: '0000-0003-1317-0220[auid]',
    })
    const name = draftToConfig({
      ...emptyDraft('person'),
      pubmed: 'Furukawa Y[au]',
    })
    expect(hasNameQuery(auid)).toBe(false)
    expect(hasNameQuery(name)).toBe(true)
  })
})

// ─────────────────────────────────────────────────── the review queue ──

const candidates = [
  pub({ key: 'pmid:111', pmid: '111', title: 'Mine' }),
  pub({ key: 'doi:10.1/x', doi: '10.1/x', title: 'Also mine' }),
  pub({ key: 'pmid:333', pmid: '333', title: 'A namesake' }),
]

describe('initialChecked', () => {
  it('pre-checks exactly the keys the pipeline suggested', () => {
    const checked = initialChecked(candidates, ['doi:10.1/x'], [], [])
    expect([...checked]).toEqual(['doi:10.1/x'])
  })

  it('keeps a previously confirmed candidate checked across a rebuild', () => {
    const checked = initialChecked(candidates, [], ['pmid:111'], [])
    expect(checked.has('pmid:111')).toBe(true)
  })

  it('lets an explicit rejection outrank the triage suggestion', () => {
    const checked = initialChecked(candidates, ['pmid:333'], [], ['pmid:333'])
    expect(checked.has('pmid:333')).toBe(false)
  })
})

describe('unreviewedCount', () => {
  it('counts candidates that are in neither list', () => {
    expect(unreviewedCount(candidates, [], [])).toBe(3)
    expect(unreviewedCount(candidates, ['pmid:111'], ['pmid:333'])).toBe(1)
  })
})

describe('applyReviewDecisions', () => {
  it('moves a checked candidate into include and an unchecked one into exclude', () => {
    const result = applyReviewDecisions(
      [],
      [],
      candidates,
      new Set(['pmid:111', 'doi:10.1/x']),
    )
    expect(result.include).toEqual(['pmid:111', 'doi:10.1/x'])
    expect(result.exclude).toEqual(['pmid:333'])
  })

  it('un-includes a candidate that gets unchecked', () => {
    const result = applyReviewDecisions(
      ['pmid:111'],
      [],
      candidates,
      new Set<string>(),
    )
    expect(result.include).not.toContain('pmid:111')
    expect(result.exclude).toEqual(['pmid:111', 'doi:10.1/x', 'pmid:333'])
  })

  it('un-excludes a candidate that gets checked', () => {
    const result = applyReviewDecisions(
      [],
      ['pmid:333'],
      candidates,
      new Set(['pmid:333']),
    )
    expect(result.exclude).not.toContain('pmid:333')
    expect(result.include).toContain('pmid:333')
  })

  it('leaves references outside the queue alone', () => {
    const result = applyReviewDecisions(
      ['pmid:999'],
      ['pmid:888'],
      candidates,
      new Set(['pmid:111']),
    )
    expect(result.include).toContain('pmid:999')
    expect(result.exclude).toContain('pmid:888')
  })

  it('never writes a duplicate reference', () => {
    const result = applyReviewDecisions(
      ['pmid:111'],
      [],
      candidates,
      new Set(['pmid:111']),
    )
    expect(result.include.filter((r) => r === 'pmid:111')).toHaveLength(1)
  })

  it('reports a candidate with neither a DOI nor a PMID instead of guessing', () => {
    const orphan = pub({ key: 'title:orphan', title: 'Orphan' })
    const result = applyReviewDecisions([], [], [orphan], new Set(['title:orphan']))
    expect(candidateRef(orphan)).toBeNull()
    expect(result.include).toEqual([])
    expect(result.exclude).toEqual([])
    expect(result.unreferenceable).toEqual([orphan])
  })

  it('uses the DOI when a candidate has both, matching pubKey precedence', () => {
    const both = pub({ key: 'doi:10.1/y', doi: '10.1/y', pmid: '777' })
    const result = applyReviewDecisions([], [], [both], new Set(['doi:10.1/y']))
    expect(result.include).toEqual(['doi:10.1/y'])
  })
})
