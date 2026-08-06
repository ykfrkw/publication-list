/**
 * Seed schema and per-member time windows.
 *
 * The cases that matter are the two ways this feature could quietly ruin a
 * publication page: a bare-string seed changing behaviour (every existing
 * config), and a current member's papers vanishing because a co-author
 * graduated. Both are pinned below.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SEED_GRACE_MONTHS,
  INCLUDE_SEED_ID,
  addMonths,
  applySeedWindows,
  decodeSeed,
  encodeSeed,
  normalizeSeedList,
  resolveSeedWindows,
  seedId,
  seedIdList,
  seedWindowOf,
} from '../seeds'
import { normalizeOrcid } from '../ids'
import { normalizeConfig } from '../config'
import type { ListConfig, Publication } from '../types'

const STUDENT = '0000-0002-1825-0097'
const SUPERVISOR = '0000-0003-1317-0220'

function pub(overrides: Partial<Publication> & { key: string }): Publication {
  return {
    title: `Paper ${overrides.key}`,
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'BMJ',
    year: 2026,
    sources: ['orcid'],
    seedIds: [],
    trust: 'confirmed',
    ...overrides,
  }
}

function config(seeds: ListConfig['seeds']): ListConfig {
  return normalizeConfig({ v: 1, seeds })
}

// ───────────────────────────────────────────────────────────── the schema ──

describe('seed identity', () => {
  it('reads the id out of either form', () => {
    expect(seedId(STUDENT)).toBe(STUDENT)
    expect(seedId({ id: STUDENT, to: '2023-03' })).toBe(STUDENT)
    expect(seedIdList([STUDENT, { id: SUPERVISOR }])).toEqual([
      STUDENT,
      SUPERVISOR,
    ])
  })

  it('treats an object seed with no dates as windowless', () => {
    expect(seedWindowOf(STUDENT)).toBeUndefined()
    expect(seedWindowOf({ id: STUDENT })).toBeUndefined()
    expect(seedWindowOf({ id: STUDENT, to: '2023-03' })).toBeDefined()
  })

  it('normalizes the id without losing the window, and keeps strings strings', () => {
    const normalized = normalizeSeedList(
      ['https://orcid.org/0000-0002-1825-0097', { id: SUPERVISOR, to: '2023' }],
      normalizeOrcid,
    )
    expect(normalized).toEqual([STUDENT, { id: SUPERVISOR, to: '2023' }])
  })
})

describe('the attribute encoding', () => {
  it('leaves a bare seed exactly as it was', () => {
    expect(encodeSeed(STUDENT)).toBe(STUDENT)
    expect(decodeSeed(STUDENT)).toBe(STUDENT)
  })

  it('round-trips every shape of window', () => {
    const cases = [
      { id: STUDENT, from: '2019-04', to: '2023-03' },
      { id: STUDENT, from: '2019-04' },
      { id: STUDENT, to: '2023-03' },
      { id: STUDENT, from: '2019-04', to: '2023-03', grace: 0 },
      { id: STUDENT, from: '2019', to: '2023', grace: 36 },
    ]
    for (const seed of cases) {
      expect(decodeSeed(encodeSeed(seed))).toEqual(seed)
    }
    expect(encodeSeed({ id: STUDENT, from: '2019-04', to: '2023-03' })).toBe(
      `${STUDENT}@2019-04:2023-03`,
    )
    expect(encodeSeed({ id: STUDENT, to: '2023-03' })).toBe(
      `${STUDENT}@:2023-03`,
    )
  })

  it('refuses to read a window out of anything that is not exactly one', () => {
    // A tail that is not a window leaves the whole value as the id, so a
    // value containing an `@` is never silently reinterpreted.
    expect(decodeSeed('someone@example.com')).toBe('someone@example.com')
    expect(decodeSeed(`${STUDENT}@`)).toBe(`${STUDENT}@`)
    expect(decodeSeed(`${STUDENT}@notadate`)).toBe(`${STUDENT}@notadate`)
  })
})

describe('addMonths', () => {
  it('carries across years', () => {
    expect(addMonths(202303, 24)).toBe(202503)
    expect(addMonths(202303, 25)).toBe(202504)
    expect(addMonths(202312, 1)).toBe(202401)
    expect(addMonths(202301, 0)).toBe(202301)
  })
})

describe('resolveSeedWindows', () => {
  it('finds nothing to do for a config of bare strings', () => {
    const { windows, warnings } = resolveSeedWindows(
      config({ orcid: [STUDENT, SUPERVISOR] }),
    )
    expect(windows.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it('adds the default grace to the end date', () => {
    const { windows } = resolveSeedWindows(
      config({ orcid: [{ id: STUDENT, from: '2019-04', to: '2023-03' }] }),
    )
    expect(DEFAULT_SEED_GRACE_MONTHS).toBe(24)
    expect(windows.get(STUDENT)).toMatchObject({ from: 201904, to: 202503 })
  })

  it('honours grace: 0', () => {
    const { windows } = resolveSeedWindows(
      config({ orcid: [{ id: STUDENT, to: '2023-03', grace: 0 }] }),
    )
    expect(windows.get(STUDENT)?.to).toBe(202303)
  })

  it('keys a PubMed window on label ?? query, as the pipeline tags records', () => {
    const { windows } = resolveSeedWindows(
      config({
        pubmed: [
          { query: 'Tanaka H[au]', label: 'Hiroshi Tanaka', to: '2022-03' },
          { query: 'Sato K[au]', to: '2022-03' },
        ],
      }),
    )
    expect([...windows.keys()]).toEqual(['Hiroshi Tanaka', 'Sato K[au]'])
  })

  it('reports an unreadable date rather than guessing at it', () => {
    const { windows, warnings } = resolveSeedWindows(
      config({ orcid: [{ id: STUDENT, to: 'last spring' }] }),
    )
    expect(windows.size).toBe(0)
    expect(warnings[0]).toContain('unreadable end date')
    expect(warnings[0]).toContain(STUDENT)
  })
})

// ────────────────────────────────────────────────────────────── filtering ──

describe('applySeedWindows', () => {
  it('changes nothing at all when every seed is a bare string', () => {
    const pubs = [
      pub({ key: 'a', year: 1999, seedIds: [STUDENT] }),
      pub({ key: 'b', year: 2026, seedIds: [SUPERVISOR] }),
    ]
    const result = applySeedWindows(pubs, config({ orcid: [STUDENT, SUPERVISOR] }))
    expect(result.publications).toEqual(pubs)
    expect(result.warnings).toEqual([])
  })

  it('keeps a co-authored paper on the current member’s seed', () => {
    // THE case this feature exists to not get wrong: the student left in
    // 2023-03, this paper is from 2026, and the supervisor is still here.
    const coauthored = pub({
      key: 'shared',
      year: 2026,
      month: 6,
      seedIds: [STUDENT, SUPERVISOR],
    })
    const result = applySeedWindows(
      [coauthored],
      config({
        orcid: [{ id: STUDENT, from: '2019-04', to: '2023-03' }, SUPERVISOR],
      }),
    )
    expect(result.publications).toHaveLength(1)
    // The departed member's seed is dropped from the record, not the record.
    expect(result.publications[0].seedIds).toEqual([SUPERVISOR])
    expect(result.warnings.join(' ')).toContain(
      'stayed on the list because another member',
    )
  })

  it('drops a paper contributed only by an out-of-window seed, and says so', () => {
    const later = pub({
      key: 'elsewhere',
      title: 'Work done at the next institution',
      year: 2026,
      month: 6,
      seedIds: [STUDENT],
    })
    const result = applySeedWindows(
      [later],
      config({ orcid: [{ id: STUDENT, from: '2019-04', to: '2023-03' }] }),
    )
    expect(result.publications).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Left 1 record(s) off the list')
    expect(result.warnings[0]).toContain('Work done at the next institution')
    expect(result.warnings[0]).toContain(STUDENT)
  })

  it('admits a paper exactly at to + 24 months and rejects the next one', () => {
    const windowed = config({ orcid: [{ id: STUDENT, to: '2023-03' }] })
    const atBoundary = pub({
      key: 'boundary',
      year: 2025,
      month: 3,
      seedIds: [STUDENT],
    })
    const justAfter = pub({
      key: 'after',
      year: 2025,
      month: 4,
      seedIds: [STUDENT],
    })
    expect(applySeedWindows([atBoundary], windowed).publications).toHaveLength(1)
    expect(applySeedWindows([justAfter], windowed).publications).toHaveLength(0)
  })

  it('never removes a pinned record', () => {
    const pinned = pub({
      key: 'pinned',
      year: 2026,
      month: 6,
      doi: '10.1136/bmj.n71',
      seedIds: [STUDENT, INCLUDE_SEED_ID],
    })
    const result = applySeedWindows(
      [pinned],
      config({ orcid: [{ id: STUDENT, to: '2023-03', grace: 0 }] }),
    )
    expect(result.publications).toEqual([pinned])
    expect(result.warnings).toEqual([])
  })

  it('keeps a record whose date is unknown', () => {
    const undated = pub({ key: 'undated', year: 0, seedIds: [STUDENT] })
    const result = applySeedWindows(
      [undated],
      config({ orcid: [{ id: STUDENT, to: '2023-03' }] }),
    )
    expect(result.publications).toEqual([undated])
  })

  it('applies the start of a window as well as its end', () => {
    const early = pub({ key: 'early', year: 2015, seedIds: [STUDENT] })
    const result = applySeedWindows(
      [early],
      config({ orcid: [{ id: STUDENT, from: '2019-04' }] }),
    )
    expect(result.publications).toEqual([])
    expect(result.warnings[0]).toContain('from 2019-04')
  })

  it('leaves a still-active member unbounded at the top end', () => {
    const recent = pub({ key: 'recent', year: 2026, seedIds: [STUDENT] })
    const result = applySeedWindows(
      [recent],
      config({ orcid: [{ id: STUDENT, from: '2019-04' }] }),
    )
    expect(result.publications).toEqual([recent])
  })
})
