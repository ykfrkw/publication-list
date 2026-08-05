import { afterEach, describe, expect, it } from 'vitest'

import { pubKey } from '../../ids'
import type { Publication } from '../../types'
import {
  OPEN_REVIEW_JOURNALS,
  enrichPeerReview,
  enrichPeerReviewWithWarnings,
  isOpenReviewJournal,
} from '../crossref'
import { httpStatusResponse, loadFixture, stubFetch } from './helpers'

const approved = loadFixture<Record<string, unknown>>('crossref-approved.json')
const awaiting = loadFixture<Record<string, unknown>>('crossref-awaiting.json')

function pub(title: string, journal: string, doi?: string): Publication {
  const base: Publication = {
    key: '',
    title,
    authors: [],
    authorsFull: [],
    journal,
    year: 2020,
    doi,
    sources: ['orcid'],
    seedIds: ['seed'],
    trust: 'confirmed',
  }
  return { ...base, key: pubKey(base) }
}

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('isOpenReviewJournal', () => {
  it('matches the R list, case-insensitively and as a substring', () => {
    expect(OPEN_REVIEW_JOURNALS).toContain('f1000research')
    expect(isOpenReviewJournal('F1000Research')).toBe(true)
    expect(isOpenReviewJournal('Wellcome Open Research')).toBe(true)
    expect(isOpenReviewJournal('Gates Open Research')).toBe(true)
    expect(isOpenReviewJournal('HRB Open Research')).toBe(true)
    expect(isOpenReviewJournal('BMJ')).toBe(false)
    expect(isOpenReviewJournal(undefined)).toBe(false)
  })
})

describe('enrichPeerReview', () => {
  it('sets peerReviewApproved from referee assertions', async () => {
    const stub = stubFetch((url) =>
      url.includes('8597') ? awaiting : approved,
    )
    restore = stub.restore

    const out = await enrichPeerReview([
      pub('Approved article', 'F1000Research', '10.3410/f1000research.1-57.v1'),
      pub('Awaiting review', 'F1000Research', '10.12688/f1000research.8597.1'),
    ])

    expect(out[0].peerReviewApproved).toBe(true)
    expect(out[1].peerReviewApproved).toBe(false)
    expect(stub.calls[0]).toBe(
      'https://api.crossref.org/works/10.3410%2Ff1000research.1-57.v1',
    )
    // No mailto: this runs from each visitor's IP.
    expect(stub.calls[0]).not.toContain('mailto')
  })

  it('only looks up open-review journals that have a DOI', async () => {
    const stub = stubFetch(() => approved)
    restore = stub.restore

    const out = await enrichPeerReview([
      pub('Ordinary paper', 'BMJ', '10.1136/bmj.n71'),
      pub('No DOI', 'F1000Research'),
    ])

    expect(stub.calls).toHaveLength(0)
    expect(out[0].peerReviewApproved).toBeUndefined()
    expect(out[1].peerReviewApproved).toBeUndefined()
  })

  it('warns instead of throwing, and leaves the flag unset, when Crossref fails', async () => {
    const stub = stubFetch(() => httpStatusResponse(404, { status: 'error' }))
    restore = stub.restore

    const result = await enrichPeerReviewWithWarnings([
      pub('Approved article', 'F1000Research', '10.3410/f1000research.1-57.v1'),
    ])

    expect(result.publications[0].peerReviewApproved).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Crossref 10.3410/f1000research.1-57.v1')
  })
})
