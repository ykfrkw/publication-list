import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUP_BY, configHash } from '@/core/config'
import type { ListModel, Publication } from '@/core/types'
import {
  GROUP_BY_DEFAULT,
  applyFreeze,
  applyReviewDecisions,
  candidateRef,
  draftToConfig,
  emptyDraft,
  hasNameQuery,
  initialChecked,
  isRunnable,
  planFreeze,
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
    expect(config.groupBy).toBe('category-year')
  })
})

describe('draftToConfig — grouping default per mode', () => {
  it('groups a publication page by type then year, matching the embed default', () => {
    expect(DEFAULT_GROUP_BY).toBe('category-year')
    for (const mode of ['person', 'lab'] as const) {
      expect(emptyDraft(mode).groupBy).toBe('category-year')
      expect(draftToConfig(emptyDraft(mode)).groupBy).toBe('category-year')
    }
  })

  it('keeps the reference list flat, because its numbering is what gets cited', () => {
    // The one mode that does not take the shared default: an article's
    // reference list has to be a single unbroken numbered sequence.
    expect(emptyDraft('article').groupBy).toBe('none')
    expect(draftToConfig(emptyDraft('article')).groupBy).toBe('none')
    expect(GROUP_BY_DEFAULT.article).toBe('none')
  })

  it('lets the user override the per-mode default in either direction', () => {
    for (const groupBy of ['category', 'year', 'none'] as const) {
      expect(draftToConfig({ ...emptyDraft('person'), groupBy }).groupBy).toBe(groupBy)
    }
    expect(
      draftToConfig({ ...emptyDraft('article'), groupBy: 'category-year' }).groupBy,
    ).toBe('category-year')
  })
})

describe('draftToConfig — the source disclaimer', () => {
  it('starts checked', () => {
    for (const mode of ['article', 'person', 'lab'] as const) {
      expect(emptyDraft(mode).disclaimer).toBe(true)
    }
  })

  it('stays out of the config, and so out of the config hash', () => {
    // It is applied to the built model in `App.tsx` instead. Putting a purely
    // presentational toggle into `configHash` would evict the cached build
    // every time someone ticked the box.
    const on = { ...emptyDraft('person'), orcid: '0000-0003-1317-0220' }
    const off = { ...on, disclaimer: false }
    expect(configHash(draftToConfig(on))).toBe(configHash(draftToConfig(off)))
    // The config still carries the field, defaulted by `normalizeConfig`.
    expect(draftToConfig(off).disclaimer).toBe('show')
  })

  it('is a separate switch from the credit', () => {
    const draft = { ...emptyDraft('person'), credit: false }
    expect(draft.disclaimer).toBe(true)
  })
})

describe('draftToConfig — preprints', () => {
  it('leaves preprints excluded while the checkbox is unticked', () => {
    expect(emptyDraft('person').preprints).toBe(false)
    expect(draftToConfig(emptyDraft('person')).preprints).toBe('exclude')
  })

  it('opts in once the checkbox is ticked', () => {
    const config = draftToConfig({ ...emptyDraft('person'), preprints: true })
    expect(config.preprints).toBe('include')
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

// ─────────────────────────────────────────────── member turnover in a lab ──

const STUDENT = '0000-0002-1825-0097'
const SUPERVISOR = '0000-0003-1317-0220'

function labDraft(members: string) {
  return { ...emptyDraft('lab'), members }
}

describe('draftToConfig — member time windows', () => {
  it('projects a dateless member line onto the bare string it always was', () => {
    const config = draftToConfig(labDraft(`${SUPERVISOR}\n${STUDENT}`))
    expect(config.seeds.orcid).toEqual([SUPERVISOR, STUDENT])
  })

  it('projects a dated member line onto a windowed seed', () => {
    const config = draftToConfig(
      labDraft(`${SUPERVISOR}\nHanako Sato\t${STUDENT}\t2019-04..2023-03`),
    )
    expect(config.seeds.orcid).toEqual([
      SUPERVISOR,
      { id: STUDENT, from: '2019-04', to: '2023-03' },
    ])
  })

  it('carries the window onto a researchmap seed on the same line', () => {
    const config = draftToConfig(labDraft('someone\t..2023-03'))
    expect(config.seeds.researchmap).toEqual([
      { id: 'someone', to: '2023-03' },
    ])
  })

  it('leaves the config hash of a dateless lab list unchanged', () => {
    // Nothing about the windows feature may alter what an existing lab list
    // builds, caches under, or pastes into a page.
    const before = configHash(draftToConfig(labDraft(`${SUPERVISOR}\n${STUDENT}`)))
    expect(before).toBe(
      configHash(
        draftToConfig({
          ...emptyDraft('lab'),
          members: `${SUPERVISOR}\n${STUDENT}`,
        }),
      ),
    )
  })
})

describe('planFreeze', () => {
  function model(publications: Publication[]): ListModel {
    return {
      config: draftToConfig(labDraft(`${SUPERVISOR}\n${STUDENT}`)),
      members: [],
      publications,
      candidates: [],
      warnings: [],
      generatedAt: '2026-08-06T00:00:00.000Z',
    }
  }

  const solo = pub({
    key: 'doi:10.1136/bmj.n71',
    doi: '10.1136/bmj.n71',
    trust: 'confirmed',
    seedIds: [STUDENT],
  })
  const shared = pub({
    key: 'pmid:33782057',
    pmid: '33782057',
    trust: 'confirmed',
    seedIds: [STUDENT, SUPERVISOR],
  })
  const supervisorOnly = pub({
    key: 'pmid:12345678',
    pmid: '12345678',
    trust: 'confirmed',
    seedIds: [SUPERVISOR],
  })

  it('pins everything the member currently contributes, and nothing else', () => {
    const plan = planFreeze(
      model([solo, shared, supervisorOnly]),
      [STUDENT],
      'Hanako Sato',
    )
    expect(plan.refs).toEqual(['doi:10.1136/bmj.n71', 'pmid:33782057'])
    expect(plan.label).toBe('Hanako Sato')
    expect(plan.unpinnable).toEqual([])
    expect(plan.losing).toEqual([])
  })

  it('reports the records it cannot pin, and which of them will disappear', () => {
    const noId = pub({
      key: 'title:a-conference-abstract',
      title: 'A conference abstract',
      trust: 'confirmed',
      seedIds: [STUDENT],
    })
    const noIdShared = pub({
      key: 'title:a-shared-abstract',
      title: 'A shared abstract',
      trust: 'confirmed',
      seedIds: [STUDENT, SUPERVISOR],
    })

    const plan = planFreeze(model([solo, noId, noIdShared]), [STUDENT])
    expect(plan.refs).toEqual(['doi:10.1136/bmj.n71'])
    expect(plan.unpinnable.map((p) => p.title)).toEqual([
      'A conference abstract',
      'A shared abstract',
    ])
    // Only the one nothing else contributes actually falls off the list.
    expect(plan.losing.map((p) => p.title)).toEqual(['A conference abstract'])
  })

  it('takes out both identifiers when a member has an ORCID and a researchmap', () => {
    const viaResearchmap = pub({
      key: 'doi:10.1000/rm',
      doi: '10.1000/rm',
      trust: 'confirmed',
      seedIds: ['hanako'],
    })
    const plan = planFreeze(model([solo, viaResearchmap]), [STUDENT, 'hanako'])
    expect(plan.refs).toEqual(['doi:10.1136/bmj.n71', 'doi:10.1000/rm'])
  })
})

describe('applyFreeze', () => {
  it('pins the papers and takes the seed out of the member list', () => {
    const draft = labDraft(`${SUPERVISOR}\nHanako Sato\t${STUDENT}`)
    const plan = {
      seedIds: [STUDENT],
      label: 'Hanako Sato',
      refs: ['doi:10.1136/bmj.n71', 'pmid:33782057'],
      pinned: [],
      unpinnable: [],
      losing: [],
    }
    const next = applyFreeze(draft, plan, 1, new Date('2026-08-06T00:00:00Z'))

    expect(next.include).toEqual(['doi:10.1136/bmj.n71', 'pmid:33782057'])
    expect(next.members.split('\n')[1]).toContain('# frozen 2026-08-06')

    const config = draftToConfig(next)
    // The seed is gone; the pins that replace it are in `include`.
    expect(config.seeds.orcid).toEqual([SUPERVISOR])
    expect(config.include).toEqual(['doi:10.1136/bmj.n71', 'pmid:33782057'])
  })

  it('does not duplicate a reference already pinned', () => {
    const draft = {
      ...labDraft(STUDENT),
      include: ['doi:10.1136/bmj.n71'],
    }
    const plan = {
      seedIds: [STUDENT],
      label: STUDENT,
      refs: ['doi:10.1136/bmj.n71'],
      pinned: [],
      unpinnable: [],
      losing: [],
    }
    expect(applyFreeze(draft, plan, 0).include).toEqual(['doi:10.1136/bmj.n71'])
  })
})
