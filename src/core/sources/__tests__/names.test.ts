/**
 * Author-name formatting and, more importantly, the *order detection* that
 * decides which formatter is allowed to run.
 *
 * The strings here are real: they come from `api.researchmap.jp/yk_frkw` and
 * `api.researchmap.jp/7000024045` as captured on 2026-08-05 (see the fixtures
 * next to this file), plus the ORCID `/person` split for 0000-0003-1317-0220.
 */

import { describe, expect, it } from 'vitest'

import {
  detectNameOrder,
  detectNameOrderFor,
  formatAuthorFamilyFirst,
  formatAuthorShort,
  isFullPersonName,
} from '../names'

const YUKI = { given: 'Yuki', family: 'Furukawa' }
/** researchmap 7000024045 spells the given name "Kenichi"; papers say "Ken'ichi". */
const KENICHI = { given: 'Kenichi', family: 'Osaka' }

describe('formatAuthorShort / formatAuthorFamilyFirst — particles', () => {
  it('keeps a short form with a particle intact', () => {
    // Both formatters mangled this: "van DJ" family-first, "Jh vD" given-first.
    expect(formatAuthorShort('van Dalfsen JH')).toBe('van Dalfsen JH')
    expect(formatAuthorFamilyFirst('van Dalfsen JH')).toBe('van Dalfsen JH')
    expect(formatAuthorShort('de la Cruz J')).toBe('de la Cruz J')
  })

  it('still abbreviates a full name that contains a particle', () => {
    expect(formatAuthorShort('Annemieke van Straten')).toBe('van Straten A')
    expect(formatAuthorShort('Jens H. van Dalfsen')).toBe('van Dalfsen JH')
  })
})

describe('short forms are normalized to Family I', () => {
  it('moves leading initials behind the family name', () => {
    // OpenAlex returns both spellings, sometimes inside one author list:
    // "Kataoka Y, T Takayama, Yoshimura K" is what the live run produced.
    expect(formatAuthorShort('T. Takayama')).toBe('Takayama T')
    expect(formatAuthorShort('K. Koba')).toBe('Koba K')
    expect(formatAuthorFamilyFirst('N. Hashimoto')).toBe('Hashimoto N')
    expect(formatAuthorShort('A. B. Smith')).toBe('Smith AB')
    expect(formatAuthorShort('Y. van Straten')).toBe('van Straten Y')
  })

  it('leaves an already-correct short form untouched', () => {
    expect(formatAuthorShort('Furukawa Y')).toBe('Furukawa Y')
    expect(formatAuthorShort('Schneider CL')).toBe('Schneider CL')
  })
})

describe('capitalizeWord via the formatters', () => {
  it('capitalizes after a Unicode hyphen, not just an ASCII one', () => {
    // OpenAlex spells this one with U+2010; splitting on "-" alone produced
    // "Schneider‐thoma J".
    expect(formatAuthorShort('Johannes Schneider‐Thoma')).toBe(
      'Schneider‐Thoma J',
    )
    expect(formatAuthorShort('Natalia Fares-Otero')).toBe('Fares-Otero N')
  })
})

describe('isFullPersonName', () => {
  it('accepts names with a word beyond the family name', () => {
    expect(isFullPersonName('Yuki Furukawa')).toBe(true)
    expect(isFullPersonName('Natalia E. Fares-Otero')).toBe(true)
    expect(isFullPersonName('Jens H. van Dalfsen')).toBe(true)
    expect(isFullPersonName('YUKI FURUKAWA')).toBe(true)
    expect(isFullPersonName("Osaka Ken'ichi")).toBe(true)
  })

  it('rejects short forms, including the ones researchmap files as full names', () => {
    expect(isFullPersonName('Furukawa Y')).toBe(false)
    expect(isFullPersonName('Türkmen C')).toBe(false)
    expect(isFullPersonName('Schneider CL')).toBe(false)
    expect(isFullPersonName('van Dalfsen JH')).toBe(false)
    expect(isFullPersonName('Osaka, K.')).toBe(false)
    expect(isFullPersonName('K. Koba')).toBe(false)
    expect(isFullPersonName('Furukawa')).toBe(false)
    expect(isFullPersonName('')).toBe(false)
  })

  it('treats a kana or CJK name as full — it has no initials to expand', () => {
    expect(isFullPersonName('田口 良子')).toBe(true)
    expect(isFullPersonName('中山和弘')).toBe(true)
  })
})

describe('detectNameOrderFor', () => {
  it('recognizes the anchor written either way round', () => {
    expect(detectNameOrderFor('Yuki Furukawa', YUKI)).toBe('given-first')
    expect(detectNameOrderFor('YUKI FURUKAWA', YUKI)).toBe('given-first')
    expect(detectNameOrderFor('Furukawa Yuki', YUKI)).toBe('family-first')
    // Apostrophes and diacritics are normalized away before comparing.
    expect(detectNameOrderFor("Osaka Ken'ichi", KENICHI)).toBe('family-first')
    expect(detectNameOrderFor('Ken’ichi Osaka', KENICHI)).toBe('given-first')
  })

  it('reads a short form of the anchor as family-first', () => {
    expect(detectNameOrderFor('Furukawa Y', YUKI)).toBe('family-first')
    expect(detectNameOrderFor('Furukawa YK', YUKI)).toBe('family-first')
  })

  it('does not answer for someone else', () => {
    // This is the trap: a co-author who shares the surname.
    expect(detectNameOrderFor('Toshiaki A. Furukawa', YUKI)).toBeUndefined()
    expect(detectNameOrderFor('Toshi A Furukawa', YUKI)).toBeUndefined()
    expect(detectNameOrderFor('Furukawa Toshiaki', YUKI)).toBeUndefined()
    expect(detectNameOrderFor('Masatsugu Sakata', YUKI)).toBeUndefined()
    expect(detectNameOrderFor('Furukawa', YUKI)).toBeUndefined()
  })

  it('does not answer without both halves of the anchor', () => {
    expect(detectNameOrderFor('Yuki Furukawa', { given: '', family: 'Furukawa' }))
      .toBeUndefined()
    expect(detectNameOrderFor('Yuki Furukawa', { given: 'Yuki', family: '' }))
      .toBeUndefined()
  })
})

describe('detectNameOrder', () => {
  const givenFirstList = [
    'Natalia E. Fares-Otero',
    'Yuki Furukawa',
    'Marit Sijbrandij',
    'Stefan Leucht',
  ]
  const familyFirstList = [
    'Tokuchi Naoko',
    'Ohte Nobuhito',
    "Osaka Ken'ichi",
    'Katsuyama Masanori',
  ]
  const shortFormList = ['Türkmen C', 'Schneider CL', 'Furukawa Y', 'van Dalfsen JH']

  it('measures each account rather than assuming a convention', () => {
    expect(detectNameOrder(givenFirstList, [YUKI])).toBe('given-first')
    expect(detectNameOrder(familyFirstList, [KENICHI])).toBe('family-first')
  })

  it('returns nothing without an anchor, so the caller cannot guess', () => {
    expect(detectNameOrder(givenFirstList, [])).toBeUndefined()
    expect(detectNameOrder(givenFirstList, [KENICHI])).toBeUndefined()
  })

  it('ignores short-form matches: they read the same under both conventions', () => {
    // "Furukawa Y" is written that way whichever order the list uses, so it
    // says nothing about the full names sitting next to it.
    expect(detectNameOrder(shortFormList, [YUKI])).toBeUndefined()
  })

  it('refuses to decide when one list contains both conventions', () => {
    // researchmap account `nakayama` really does this.
    const mixed = ['Atsuho Nakayama', 'Nakayama Atsuho']
    expect(detectNameOrder(mixed, [{ given: 'Atsuho', family: 'Nakayama' }]))
      .toBeUndefined()
  })

  it('is not fooled into a vote by a same-surname co-author', () => {
    expect(
      detectNameOrder(
        ['Yuki Furukawa', 'Masatsugu Sakata', 'Toshiaki A. Furukawa'],
        [YUKI],
      ),
    ).toBe('given-first')
  })
})
