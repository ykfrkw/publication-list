/**
 * Why an empty list is empty, and what an embed of it would leave out.
 *
 * The bug being pinned here is the one the SLEEPI list hit: a PubMed seed that
 * returned exactly the five wanted papers, all of them candidates, all of them
 * therefore off `publications`, and a wizard that said nothing about any of it.
 * The three causes are asserted separately because they have three different
 * remedies — confirm, change a setting, fix a seed — and a message that guessed
 * wrong would send the user to the wrong one.
 */

import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import type { DroppedCounts, ListConfig, ListModel, Publication } from '@/core/types'
import {
  candidatesMissingFromEmbed,
  describeDropped,
  diagnoseEmptyList,
} from '../diagnose'

const NOTHING_DROPPED: DroppedCounts = {
  excluded: 0,
  window: 0,
  erratum: 0,
  preprint: 0,
  dateRange: 0,
  limit: 0,
}

function pub(over: Partial<Publication> = {}): Publication {
  return {
    key: 'pmid:38231522',
    title: 'A trial',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'Sleep',
    year: 2024,
    pmid: '38231522',
    sources: ['pubmed'],
    seedIds: ['q'],
    trust: 'candidate',
    ...over,
  }
}

function model(over: Partial<ListModel> = {}, config?: ListConfig): ListModel {
  return {
    config: config ?? normalizeConfig({ seeds: {} }),
    members: [],
    publications: [],
    candidates: [],
    warnings: [],
    dropped: { ...NOTHING_DROPPED },
    generatedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  }
}

/** The owner's list: five PubMed hits, none of them confirmed. */
const SLEEPI = model({
  candidates: Array.from({ length: 5 }, (_, i) =>
    pub({ key: `pmid:${38231522 + i}`, pmid: String(38231522 + i) }),
  ),
})

describe('diagnoseEmptyList', () => {
  it('says nothing at all about a list that has publications on it', () => {
    expect(diagnoseEmptyList(model({ publications: [pub({ trust: 'confirmed' })] }))).toBeNull()
  })

  it('blames the review queue when candidates are waiting — the SLEEPI case', () => {
    const empty = diagnoseEmptyList(SLEEPI)
    expect(empty?.cause).toBe('candidates')
    expect(empty?.title).toContain('5 records are waiting in the review queue')
    // The remedy, and the fact that an embed can never apply it.
    expect(empty?.body).toContain('review queue above')
    expect(empty?.body).toContain('never appear in an embed')
    expect(empty?.filters).toEqual([])
  })

  it('reads singular for one waiting candidate', () => {
    const empty = diagnoseEmptyList(model({ candidates: [pub()] }))
    expect(empty?.title).toContain('1 record is waiting')
  })

  it('names the filter responsible when everything was filtered out', () => {
    const empty = diagnoseEmptyList(
      model({ dropped: { ...NOTHING_DROPPED, preprint: 3 } }),
    )
    expect(empty?.cause).toBe('filtered')
    expect(empty?.title).toContain('every record found was filtered out')
    expect(empty?.body).toContain('3 records came back')
    expect(empty?.filters).toHaveLength(1)
    expect(empty?.filters[0]).toContain('3 held back as preprints')
    expect(empty?.filters[0]).toContain('Include preprints')
  })

  it('names the date range with the bounds that were actually set', () => {
    const empty = diagnoseEmptyList(
      model(
        { dropped: { ...NOTHING_DROPPED, dateRange: 4 } },
        normalizeConfig({ seeds: {}, from: '2030' }),
      ),
    )
    expect(empty?.cause).toBe('filtered')
    expect(empty?.filters[0]).toContain('4 outside the date range you set (from 2030)')
  })

  it('names every filter that removed something, not just the first', () => {
    const empty = diagnoseEmptyList(
      model(
        {
          dropped: {
            ...NOTHING_DROPPED,
            excluded: 1,
            window: 2,
            erratum: 1,
            preprint: 1,
          },
        },
        normalizeConfig({ seeds: {} }),
      ),
    )
    expect(empty?.filters).toHaveLength(4)
    expect(empty?.body).toContain('5 records came back')
  })

  it('points at the seeds when nothing came back at all', () => {
    const empty = diagnoseEmptyList(model())
    expect(empty?.cause).toBe('nothing')
    expect(empty?.title).toContain('no source returned a record')
    expect(empty?.body).toContain('ORCID')
    expect(empty?.body).toContain('PubMed')
    expect(empty?.filters).toEqual([])
  })

  it('treats a model with no `dropped` (an old cache entry) as "nothing found"', () => {
    const stale = model()
    delete stale.dropped
    expect(diagnoseEmptyList(stale)?.cause).toBe('nothing')
  })

  it('prefers the review queue but still reports what a filter took', () => {
    const empty = diagnoseEmptyList(
      model({
        candidates: [pub()],
        dropped: { ...NOTHING_DROPPED, preprint: 2 },
      }),
    )
    expect(empty?.cause).toBe('candidates')
    expect(empty?.body).toContain('Separately, 2 other records were removed')
    expect(empty?.body).toContain('held back as preprints')
  })
})

describe('describeDropped', () => {
  it('is empty when nothing was dropped, and when the counts are unknown', () => {
    const config = normalizeConfig({ seeds: {} })
    expect(describeDropped(NOTHING_DROPPED, config)).toEqual([])
    expect(describeDropped(undefined, config)).toEqual([])
  })

  it('lists the filters in the order the pipeline applies them', () => {
    const config = normalizeConfig({ seeds: {}, from: '2020', to: '2024', limit: 5 })
    const described = describeDropped(
      { excluded: 1, window: 1, erratum: 1, preprint: 1, dateRange: 1, limit: 1 },
      config,
    )
    expect(described).toHaveLength(6)
    expect(described[0]).toContain('exclude list')
    expect(described[1]).toContain('Joined / Left')
    expect(described[2]).toContain('erratum')
    expect(described[3]).toContain('preprint')
    expect(described[4]).toContain('2020 to 2024')
    expect(described[5]).toContain('limit of 5')
  })
})

describe('candidatesMissingFromEmbed', () => {
  it('counts every candidate under the default strict policy', () => {
    expect(candidatesMissingFromEmbed(SLEEPI)).toBe(5)
  })

  it('is zero when there are no candidates', () => {
    expect(
      candidatesMissingFromEmbed(model({ publications: [pub({ trust: 'confirmed' })] })),
    ).toBe(0)
  })

  it('is zero under `auto`, where the same records are already published', () => {
    const candidates = [pub(), pub({ key: 'pmid:39242039', pmid: '39242039' })]
    expect(
      candidatesMissingFromEmbed(
        model({ publications: [...candidates], candidates }),
      ),
    ).toBe(0)
  })
})
