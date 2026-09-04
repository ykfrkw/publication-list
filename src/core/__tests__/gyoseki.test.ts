import { describe, expect, it } from 'vitest'
import { applyCategoryPins, categorizeGyoseki } from '../gyoseki'
import type { Publication } from '../types'

/** Minimal record; overrides carry whatever the branch under test needs. */
function pub(overrides: Partial<Publication> = {}): Publication {
  return {
    key: 'k',
    title: 'T',
    authors: [],
    authorsFull: [],
    journal: '',
    year: 2024,
    sources: ['researchmap'],
    seedIds: ['seed'],
    trust: 'confirmed',
    ...overrides,
  }
}

describe('categorizeGyoseki — awards', () => {
  it('files every award as award', () => {
    expect(categorizeGyoseki(pub({ kind: 'award' }))).toBe('award')
  })
})

describe('categorizeGyoseki — books', () => {
  // The live researchmap role tokens, one per branch of the role table.
  it('single_work (単著) → book-lead', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRole: 'single_work' }))).toBe('book-lead')
  })

  it('joint_work (共著) → book-lead', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRole: 'joint_work' }))).toBe('book-lead')
  })

  it('joint_translation (共訳) → book-lead', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'book', bookRole: 'joint_translation' })),
    ).toBe('book-lead')
  })

  it('contributor (分担執筆) → book-chapter', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRole: 'contributor' }))).toBe('book-chapter')
  })

  it('others → book-lead', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRole: 'others' }))).toBe('book-lead')
  })

  it('Japanese chapter roles (分担執筆) → book-chapter', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRole: '分担執筆' }))).toBe('book-chapter')
  })

  it('role absent + page range pp.123-145 → book-chapter', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'book', bookRange: 'pp.123-145' })),
    ).toBe('book-chapter')
  })

  it('role absent + chapter range 第3章 → book-chapter', () => {
    expect(categorizeGyoseki(pub({ kind: 'book', bookRange: '第3章' }))).toBe('book-chapter')
  })

  it('role absent, no range → book-lead', () => {
    expect(categorizeGyoseki(pub({ kind: 'book' }))).toBe('book-lead')
  })

  it('a lead role beats a page range — the range only decides when the role is absent', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'book', bookRole: 'single_work', bookRange: 'pp. 1-200' })),
    ).toBe('book-lead')
  })
})

describe('categorizeGyoseki — presentations', () => {
  it('language ja → domestic', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'presentation', language: 'ja' })),
    ).toBe('domestic-presentation')
  })

  it('language en → international', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'presentation', language: 'en' })),
    ).toBe('intl-presentation')
  })

  it('English title at a CJK-named event → domestic', () => {
    expect(
      categorizeGyoseki(
        pub({
          kind: 'presentation',
          title: 'CBT for insomnia',
          eventJa: '日本睡眠学会第49回定期学術集会',
        }),
      ),
    ).toBe('domestic-presentation')
  })

  it('all-Latin title and event → international', () => {
    expect(
      categorizeGyoseki(
        pub({
          kind: 'presentation',
          title: 'CBT for insomnia',
          event: 'World Sleep Congress',
        }),
      ),
    ).toBe('intl-presentation')
  })

  it('no language, no event → domestic (conservative default)', () => {
    expect(
      categorizeGyoseki(pub({ kind: 'presentation', title: 'A talk' })),
    ).toBe('domestic-presentation')
  })

  it('invited never flips the bucket', () => {
    expect(
      categorizeGyoseki(
        pub({ kind: 'presentation', language: 'ja', invited: true }),
      ),
    ).toBe('domestic-presentation')
    expect(
      categorizeGyoseki(
        pub({
          kind: 'presentation',
          title: 'A talk',
          event: 'Some Seminar',
          invited: true,
          presentationType: 'public_discourse',
        }),
      ),
    ).toBe('intl-presentation')
  })
})

describe('categorizeGyoseki — papers', () => {
  it('misc ja with 報告 in the title → ja-report', () => {
    expect(
      categorizeGyoseki(
        pub({ fromMisc: true, language: 'ja', title: '研究成果報告書' }),
      ),
    ).toBe('ja-report')
  })

  it('misc ja with meeting_report misc_type → ja-report', () => {
    expect(
      categorizeGyoseki(
        pub({ fromMisc: true, language: 'ja', miscType: 'meeting_report' }),
      ),
    ).toBe('ja-report')
  })

  it('misc ja without report signals → ja-review', () => {
    expect(
      categorizeGyoseki(pub({ fromMisc: true, language: 'ja' })),
    ).toBe('ja-review')
  })

  it('misc en → en-review', () => {
    expect(
      categorizeGyoseki(pub({ fromMisc: true, language: 'en' })),
    ).toBe('en-review')
  })

  it('letter en → en-review', () => {
    expect(
      categorizeGyoseki(pub({ category: 'letter', language: 'en' })),
    ).toBe('en-review')
  })

  it('editorial ja → ja-review', () => {
    expect(
      categorizeGyoseki(pub({ category: 'editorial', language: 'ja' })),
    ).toBe('ja-review')
  })

  it('openAlexType review → en-review', () => {
    expect(
      categorizeGyoseki(
        pub({ category: 'original', openAlexType: 'review', language: 'en' }),
      ),
    ).toBe('en-review')
  })

  it('a review-named journal → en-review', () => {
    expect(
      categorizeGyoseki(
        pub({ category: 'original', journal: 'Clinical Psychology Review', language: 'en' }),
      ),
    ).toBe('en-review')
  })

  it('plain ja article → ja-original', () => {
    expect(
      categorizeGyoseki(
        pub({ category: 'original', journal: '精神医学', language: 'ja' }),
      ),
    ).toBe('ja-original')
  })

  it('preprint en → en-original', () => {
    expect(
      categorizeGyoseki(
        pub({ category: 'preprint', journal: 'medRxiv', language: 'en' }),
      ),
    ).toBe('en-original')
  })

  it('absent kind reads as paper', () => {
    expect(categorizeGyoseki(pub({ category: 'original' }))).toBe('en-original')
  })
})

describe('applyCategoryPins', () => {
  it('moves a record pinned by DOI', () => {
    const input = [
      pub({ key: 'doi:10.1/a', doi: '10.1/a', gyosekiCategory: 'en-original' }),
      pub({ key: 'doi:10.1/b', doi: '10.1/b', gyosekiCategory: 'en-original' }),
    ]
    const { publications, warnings } = applyCategoryPins(input, [
      'doi:10.1/a=en-review',
    ])

    expect(publications[0].gyosekiCategory).toBe('en-review')
    expect(publications[1].gyosekiCategory).toBe('en-original')
    expect(warnings).toEqual([])
    // Immutable: the input records were not touched.
    expect(input[0].gyosekiCategory).toBe('en-original')
  })

  it('moves a presentation pinned by rm id', () => {
    const input = [
      pub({
        key: 'rm:51665682',
        kind: 'presentation',
        rmId: '51665682',
        gyosekiCategory: 'domestic-presentation',
      }),
    ]
    const { publications, warnings } = applyCategoryPins(input, [
      'rm:51665682=intl-presentation',
    ])

    expect(publications[0].gyosekiCategory).toBe('intl-presentation')
    expect(warnings).toEqual([])
  })

  it('warns when a pin matches no record', () => {
    const { publications, warnings } = applyCategoryPins(
      [pub({ key: 'doi:10.1/a', doi: '10.1/a' })],
      ['pmid:99999999=ja-review'],
    )

    expect(publications).toHaveLength(1)
    expect(warnings).toEqual(['Category pin "pmid:99999999=ja-review" matched no record.'])
  })

  it('passes records through untouched when there are no pins', () => {
    const input = [pub({ key: 'doi:10.1/a', doi: '10.1/a' })]
    const { publications, warnings } = applyCategoryPins(input, undefined)
    expect(publications).toBe(input)
    expect(warnings).toEqual([])
  })
})
