import { describe, expect, it } from 'vitest'
import {
  OPEN_REVIEW_JOURNALS,
  PREPRINT_SERVERS,
  categorizeAll,
  categorizePublication,
  isOpenReviewJournal,
  isPreprintServer,
} from '../categorize'
import type { Publication } from '../types'

function pub(overrides: Partial<Publication> = {}): Publication {
  return {
    key: 'doi:10.1/x',
    title: 'A paper',
    authors: [],
    authorsFull: [],
    journal: '',
    year: 2024,
    sources: ['orcid'],
    seedIds: ['seed-a'],
    trust: 'confirmed',
    ...overrides,
  }
}

describe('constants', () => {
  it('exports the preprint server list', () => {
    expect(PREPRINT_SERVERS).toContain('medrxiv')
    expect(PREPRINT_SERVERS).toContain('research square')
  })

  it('exports the open-review journal list', () => {
    expect(OPEN_REVIEW_JOURNALS).toContain('f1000research')
    expect(OPEN_REVIEW_JOURNALS).toContain('wellcome open research')
  })
})

describe('isPreprintServer / isOpenReviewJournal', () => {
  it('matches case-insensitively as a substring', () => {
    expect(isPreprintServer('medRxiv')).toBe(true)
    expect(isPreprintServer('medRxiv : the preprint server for health sciences'))
      .toBe(true)
    expect(isOpenReviewJournal('F1000Research')).toBe(true)
    expect(isOpenReviewJournal('Wellcome Open Research')).toBe(true)
  })

  it('is false for empty or unrelated journals', () => {
    expect(isPreprintServer('')).toBe(false)
    expect(isPreprintServer(undefined)).toBe(false)
    expect(isPreprintServer('BMJ')).toBe(false)
    expect(isOpenReviewJournal('')).toBe(false)
    expect(isOpenReviewJournal(undefined)).toBe(false)
    expect(isOpenReviewJournal('BMJ')).toBe(false)
  })
})

describe('categorizePublication — step 1: preprint servers', () => {
  it('classifies a preprint-server journal as preprint whatever else says', () => {
    expect(
      categorizePublication(
        pub({ journal: 'medRxiv', openAlexType: 'article' }),
      ),
    ).toBe('preprint')
    expect(
      categorizePublication(pub({ journal: 'Research Square', orcidType: 'journal-article' })),
    ).toBe('preprint')
  })

  it('classifies orcidType=preprint as preprint outside an open-review journal', () => {
    expect(
      categorizePublication(pub({ journal: 'Some Journal', orcidType: 'preprint' })),
    ).toBe('preprint')
    expect(categorizePublication(pub({ orcidType: 'PREPRINT' }))).toBe('preprint')
  })

  it('does not let orcidType=preprint short-circuit an open-review journal', () => {
    // F1000 records carry orcidType "preprint" even after approval.
    expect(
      categorizePublication(
        pub({
          journal: 'F1000Research',
          orcidType: 'preprint',
          peerReviewApproved: true,
        }),
      ),
    ).toBe('original')
  })
})

describe('categorizePublication — step 2: open-review journals', () => {
  it('is original when peer review is approved', () => {
    expect(
      categorizePublication(
        pub({ journal: 'F1000Research', peerReviewApproved: true }),
      ),
    ).toBe('original')
    expect(
      categorizePublication(
        pub({ journal: 'Gates Open Research', peerReviewApproved: true }),
      ),
    ).toBe('original')
  })

  it('is preprint when peer review is not approved', () => {
    expect(
      categorizePublication(
        pub({ journal: 'F1000Research', peerReviewApproved: false }),
      ),
    ).toBe('preprint')
  })

  it('is preprint when the approval status is unknown', () => {
    expect(categorizePublication(pub({ journal: 'HRB Open Research' }))).toBe(
      'preprint',
    )
    expect(
      categorizePublication(
        pub({ journal: 'Wellcome Open Research', peerReviewApproved: undefined }),
      ),
    ).toBe('preprint')
  })

  it('beats a contradicting OpenAlex type', () => {
    expect(
      categorizePublication(
        pub({
          journal: 'F1000Research',
          openAlexType: 'article',
          peerReviewApproved: false,
        }),
      ),
    ).toBe('preprint')
  })
})

describe('categorizePublication — step 3: OpenAlex type', () => {
  it('maps letter', () => {
    expect(categorizePublication(pub({ openAlexType: 'letter' }))).toBe('letter')
  })

  it('maps editorial', () => {
    expect(categorizePublication(pub({ openAlexType: 'editorial' }))).toBe(
      'editorial',
    )
  })

  it('maps article and review to original', () => {
    expect(categorizePublication(pub({ openAlexType: 'article' }))).toBe('original')
    expect(categorizePublication(pub({ openAlexType: 'review' }))).toBe('original')
  })

  it('maps preprint', () => {
    expect(categorizePublication(pub({ openAlexType: 'preprint' }))).toBe('preprint')
  })

  it('excludes erratum and paratext (R behaviour, not the older TS `other`)', () => {
    expect(categorizePublication(pub({ openAlexType: 'erratum' }))).toBe('exclude')
    expect(categorizePublication(pub({ openAlexType: 'paratext' }))).toBe('exclude')
    // …even when the ORCID type would otherwise say journal-article.
    expect(
      categorizePublication(
        pub({ openAlexType: 'Erratum', orcidType: 'journal-article' }),
      ),
    ).toBe('exclude')
  })

  it('is case-insensitive', () => {
    expect(categorizePublication(pub({ openAlexType: 'LETTER' }))).toBe('letter')
  })

  it('falls through to the ORCID type for an unrecognized OpenAlex type', () => {
    expect(
      categorizePublication(
        pub({ openAlexType: 'book-chapter', orcidType: 'book-chapter' }),
      ),
    ).toBe('other')
  })
})

describe('categorizePublication — step 4: ORCID / researchmap type', () => {
  it('maps journal-article, review and scientific_journal to original', () => {
    expect(categorizePublication(pub({ orcidType: 'journal-article' }))).toBe(
      'original',
    )
    expect(categorizePublication(pub({ orcidType: 'review' }))).toBe('original')
    // researchmap's type string — the older TS implementation never handled it.
    expect(categorizePublication(pub({ orcidType: 'scientific_journal' }))).toBe(
      'original',
    )
  })

  it('maps anything containing "letter"', () => {
    expect(categorizePublication(pub({ orcidType: 'letter' }))).toBe('letter')
    expect(categorizePublication(pub({ orcidType: 'Letter to the Editor' }))).toBe(
      'letter',
    )
  })

  it('maps editorial and comment', () => {
    expect(categorizePublication(pub({ orcidType: 'editorial' }))).toBe('editorial')
    expect(categorizePublication(pub({ orcidType: 'comment' }))).toBe('editorial')
  })

  it('maps the "other" token family', () => {
    for (const t of [
      'book',
      'book-chapter',
      'conference-paper',
      'conference-abstract',
      'report',
      'dissertation-thesis',
      'working-paper',
      'other',
    ]) {
      expect(categorizePublication(pub({ orcidType: t }))).toBe('other')
    }
  })
})

describe('categorizePublication — step 5: default', () => {
  it('is original when nothing is known', () => {
    expect(categorizePublication(pub())).toBe('original')
    expect(
      categorizePublication(pub({ journal: 'BMJ', orcidType: '', openAlexType: '' })),
    ).toBe('original')
  })

  it('is original for an unrecognized ORCID type', () => {
    expect(categorizePublication(pub({ orcidType: 'data-set' }))).toBe('original')
  })
})

describe('categorizeAll', () => {
  it('sets category and splits out excluded records', () => {
    const input = [
      pub({ key: 'doi:10.1/a', openAlexType: 'article' }),
      pub({ key: 'doi:10.1/b', openAlexType: 'erratum' }),
      pub({ key: 'doi:10.1/c', openAlexType: 'letter' }),
      pub({ key: 'doi:10.1/d', openAlexType: 'paratext' }),
    ]
    const { publications, excluded } = categorizeAll(input)

    expect(publications.map((p) => [p.key, p.category])).toEqual([
      ['doi:10.1/a', 'original'],
      ['doi:10.1/c', 'letter'],
    ])
    expect(excluded.map((p) => p.key)).toEqual(['doi:10.1/b', 'doi:10.1/d'])
    expect(excluded[0].category).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const input = [pub({ openAlexType: 'article' })]
    categorizeAll(input)
    expect(input[0].category).toBeUndefined()
  })

  it('handles an empty list', () => {
    expect(categorizeAll([])).toEqual({ publications: [], excluded: [] })
  })
})
