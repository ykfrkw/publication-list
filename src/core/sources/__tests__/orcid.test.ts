import { afterEach, describe, expect, it } from 'vitest'

import {
  fetchOrcidName,
  fetchOrcidPerson,
  fetchOrcidWorks,
  fetchOrcidWorksWithWarnings,
} from '../orcid'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

const ORCID_ID = '0000-0003-1317-0220'
const works = loadFixture<Record<string, unknown>>('orcid-works.json')
const person = loadFixture<Record<string, unknown>>('orcid-person.json')

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('fetchOrcidWorks', () => {
  it('parses group[].work-summary[0] into Publications', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const pubs = await fetchOrcidWorks(ORCID_ID)

    expect(stub.calls).toEqual([`https://pub.orcid.org/v3.0/${ORCID_ID}/works`])
    expect(pubs).toHaveLength(4)

    const first = pubs[0]
    expect(first.title).toContain('MDMA')
    expect(first.journal).toBe('European Neuropsychopharmacology')
    expect(first.year).toBe(2026)
    expect(first.month).toBe(6)
    expect(first.doi).toBe('10.1016/j.euroneuro.2026.112802')
    expect(first.orcidType).toBe('journal-article')
    expect(first.sources).toEqual(['orcid'])
    expect(first.seedIds).toEqual([ORCID_ID])
    expect(first.trust).toBe('confirmed')
    expect(first.key).toBe('doi:10.1016/j.euroneuro.2026.112802')
    // ORCID work summaries carry no author list.
    expect(first.authors).toEqual([])
    expect(first.authorsFull).toEqual([])
  })

  it('reads the pmid external id alongside the doi', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const pubs = await fetchOrcidWorks(ORCID_ID)
    const withPmid = pubs.find((p) => p.pmid !== undefined)

    expect(withPmid?.pmid).toBe('41278217')
    expect(withPmid?.doi).toBe('10.1093/sleepadvances/zpaf070')
    // DOI still wins the key when both identifiers are present.
    expect(withPmid?.key.startsWith('doi:')).toBe(true)
  })

  it('records the version of a versioned F1000 DOI', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const pubs = await fetchOrcidWorks(ORCID_ID)
    const f1000 = pubs.find((p) => p.journal === 'F1000Research')

    expect(f1000?.doi).toBe('10.12688/f1000research.169873.1')
    expect(f1000?.doiVersion).toBe(1)
    // The key drops the version so v1…v4 collapse onto one record.
    expect(f1000?.key).toBe('doi:10.12688/f1000research.169873')
  })

  it('keeps preprints that have no journal title', async () => {
    const stub = stubFetch(() => works)
    restore = stub.restore

    const pubs = await fetchOrcidWorks(ORCID_ID)
    const preprint = pubs.find((p) => p.orcidType === 'preprint')

    expect(preprint).toBeDefined()
    expect(preprint?.journal).toBe('')
    expect(preprint?.year).toBe(2024)
  })

  it('lowercases and de-prefixes the DOI', async () => {
    const stub = stubFetch(() => ({
      group: [
        {
          'work-summary': [
            {
              title: { title: { value: 'Mixed case' } },
              'external-ids': {
                'external-id': [
                  {
                    'external-id-type': 'DOI',
                    'external-id-value': 'https://doi.org/10.1136/BMJ.N71',
                  },
                ],
              },
              type: 'journal-article',
              'publication-date': { year: { value: '2021' } },
            },
          ],
        },
      ],
    }))
    restore = stub.restore

    const pubs = await fetchOrcidWorks(ORCID_ID)
    expect(pubs[0].doi).toBe('10.1136/bmj.n71')
    expect(pubs[0].month).toBeUndefined()
  })

  it('returns a warning instead of throwing when ORCID fails', async () => {
    const stub = stubFetch(() => httpStatusResponse(404, { 'error-code': 9016 }))
    restore = stub.restore

    const result = await fetchOrcidWorksWithWarnings('0000-0000-0000-0000')

    expect(result.publications).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('404')
    // 4xx is not retried.
    expect(stub.calls).toHaveLength(1)
  })
})

describe('fetchOrcidName', () => {
  it('prefers the credit name', async () => {
    const stub = stubFetch(() => person)
    restore = stub.restore

    await expect(fetchOrcidName(ORCID_ID)).resolves.toBe('Yuki Furukawa')
    expect(stub.calls).toEqual([`https://pub.orcid.org/v3.0/${ORCID_ID}/person`])
  })

  it('falls back to given + family, tidying ORCID’s all-caps storage', async () => {
    const stub = stubFetch(() => ({
      name: {
        'given-names': { value: 'YUKI' },
        'family-name': { value: 'FURUKAWA' },
        'credit-name': null,
      },
    }))
    restore = stub.restore

    await expect(fetchOrcidName(ORCID_ID)).resolves.toBe('Yuki Furukawa')
  })

  it('resolves to undefined when the profile is unavailable', async () => {
    const stub = stubFetch(() => httpStatusResponse(404))
    restore = stub.restore

    await expect(fetchOrcidName(ORCID_ID)).resolves.toBeUndefined()
  })
})

describe('fetchOrcidPerson', () => {
  it('returns the given/family split alongside the display name', async () => {
    const stub = stubFetch(() => person)
    restore = stub.restore

    // The split is the only one this pipeline gets pre-separated, and it is
    // what lets researchmap author lists be read rather than guessed at.
    await expect(fetchOrcidPerson(ORCID_ID)).resolves.toEqual({
      name: 'Yuki Furukawa',
      anchor: { given: 'Yuki', family: 'Furukawa' },
    })
  })

  it('has no anchor when ORCID holds only one half of the name', async () => {
    const stub = stubFetch(() => ({
      name: { 'family-name': { value: 'Furukawa' }, 'credit-name': null },
    }))
    restore = stub.restore

    await expect(fetchOrcidPerson(ORCID_ID)).resolves.toEqual({ name: 'Furukawa' })
  })

  it('returns nothing at all when the profile is unavailable', async () => {
    const stub = stubFetch(() => httpStatusResponse(404))
    restore = stub.restore

    await expect(fetchOrcidPerson(ORCID_ID)).resolves.toEqual({})
  })
})
