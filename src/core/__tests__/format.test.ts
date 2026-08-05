import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  escapeUrl,
  formatCitation,
  formatCitationPlain,
  matchesBoldName,
} from '../format'
import type { Publication } from '../types'

/** Hand-written fixture; no network, no snapshots of live API payloads. */
function makePub(overrides: Partial<Publication> = {}): Publication {
  return {
    key: 'doi:10.1136/bmj.n71',
    title: 'Digital cognitive behavioural therapy for insomnia',
    authors: ['Furukawa Y', 'Sakata M', 'Cipriani A'],
    authorsFull: ['Yuki Furukawa', 'Masatsugu Sakata', 'Andrea Cipriani'],
    journal: 'JAMA Psychiatry',
    year: 2024,
    month: 6,
    doi: '10.1001/jamapsychiatry.2024.0888',
    pmid: '38809561',
    sources: ['pubmed'],
    seedIds: ['orcid:0000-0003-1317-0220'],
    trust: 'confirmed',
    category: 'original',
    ...overrides,
  }
}

const DOI_LINK =
  'doi: <a href="https://doi.org/10.1001/jamapsychiatry.2024.0888" target="_blank">10.1001/jamapsychiatry.2024.0888</a>'

describe('escapeHtml', () => {
  it('escapes the five markup-critical characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;',
    )
  })

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Sleep and Biological Rhythms')).toBe(
      'Sleep and Biological Rhythms',
    )
  })
})

describe('escapeUrl', () => {
  it('percent-encodes before escaping, so a quote cannot close the attribute', () => {
    const out = escapeUrl('https://doi.org/10.1/a"onload="alert(1)')
    expect(out).not.toContain('"')
    expect(out).toContain('%22')
  })
})

// ─────────────────────────────────────────────── golden strings per style ──

describe('formatCitation golden strings', () => {
  it('vancouver', () => {
    expect(formatCitation(makePub(), 'vancouver')).toBe(
      'Furukawa Y, Sakata M, Cipriani A. ' +
        'Digital cognitive behavioural therapy for insomnia. ' +
        '<em>JAMA Psychiatry</em>. 2024. ' +
        DOI_LINK,
    )
  })

  it('apa', () => {
    expect(formatCitation(makePub(), 'apa')).toBe(
      'Furukawa Y, Sakata M, & Cipriani A ' +
        '(2024). ' +
        'Digital cognitive behavioural therapy for insomnia. ' +
        '<em>JAMA Psychiatry</em>. ' +
        DOI_LINK,
    )
  })

  it('harvard', () => {
    expect(formatCitation(makePub(), 'harvard')).toBe(
      'Furukawa Y, Sakata M and Cipriani A ' +
        '(2024) ' +
        "'Digital cognitive behavioural therapy for insomnia', " +
        '<em>JAMA Psychiatry</em>. ' +
        DOI_LINK,
    )
  })

  it('chicago', () => {
    expect(formatCitation(makePub(), 'chicago')).toBe(
      'Furukawa Y, Sakata M, and Cipriani A. ' +
        '"Digital cognitive behavioural therapy for insomnia." ' +
        '<em>JAMA Psychiatry</em> ' +
        '(2024). ' +
        DOI_LINK,
    )
  })

  it('nature bolds the year', () => {
    expect(formatCitation(makePub(), 'nature')).toBe(
      'Furukawa Y, Sakata M, Cipriani A. ' +
        'Digital cognitive behavioural therapy for insomnia. ' +
        '<em>JAMA Psychiatry</em> ' +
        '<b>2024</b>. ' +
        DOI_LINK,
    )
  })
})

describe('formatCitationPlain', () => {
  it('carries no markup and no HTML entities', () => {
    const pub = makePub({ title: 'Sleep & wake: <b>a trial</b>' })
    const plain = formatCitationPlain(pub, 'vancouver', ['Yuki Furukawa'])
    expect(plain).toBe(
      'Furukawa Y, Sakata M, Cipriani A. ' +
        'Sleep & wake: <b>a trial</b>. ' +
        'JAMA Psychiatry. 2024. ' +
        'doi: 10.1001/jamapsychiatry.2024.0888',
    )
    expect(plain).not.toContain('&amp;')
    expect(plain).not.toContain('<em>')
    expect(plain).not.toContain('<a ')
  })
})

describe('missing fields', () => {
  it('drops absent journal, year and doi without leaving stray separators', () => {
    const pub = makePub({ journal: '', year: 0, doi: undefined })
    expect(formatCitation(pub, 'vancouver')).toBe(
      'Furukawa Y, Sakata M, Cipriani A. ' +
        'Digital cognitive behavioural therapy for insomnia.',
    )
  })

  it('handles an empty author list', () => {
    const pub = makePub({ authors: [], authorsFull: [] })
    expect(formatCitation(pub, 'vancouver')).toBe(
      'Digital cognitive behavioural therapy for insomnia. ' +
        '<em>JAMA Psychiatry</em>. 2024. ' +
        DOI_LINK,
    )
  })
})

// ────────────────────────────────────────────────────── bold-name matching ──

describe('bold-name matching', () => {
  const pub = makePub({
    authors: ['Furukawa Yuri', 'Furukawa Yuki', 'Cipriani A'],
    authorsFull: ['Yuri Furukawa', 'Yuki Furukawa', 'Andrea Cipriani'],
  })

  it('bolds Furukawa Yuki and leaves the co-author Furukawa Yuri alone', () => {
    const html = formatCitation(pub, 'vancouver', ['Furukawa Yuki'])
    expect(html).toContain('<b>Furukawa Yuki</b>')
    expect(html).not.toContain('<b>Furukawa Yuri</b>')
  })

  it('is the same in the other direction', () => {
    const html = formatCitation(pub, 'vancouver', ['Yuri Furukawa'])
    expect(html).toContain('<b>Furukawa Yuri</b>')
    expect(html).not.toContain('<b>Furukawa Yuki</b>')
  })

  it('is case-insensitive and accent-insensitive', () => {
    expect(matchesBoldName('Yuki Furukawa', ['yuki FURUKAWA'])).toBe(true)
    expect(matchesBoldName('Jürgen Müller-Bergh', ['Jurgen Muller Bergh'])).toBe(
      true,
    )
  })

  it('matches on the full name, not a bare surname', () => {
    // A bare surname must not sweep up every Furukawa in the list.
    expect(matchesBoldName('Yuri Furukawa', ['Furukawa Yuki'])).toBe(false)
    expect(matchesBoldName('Yuki Furukawa', ['Furukawa Yuki'])).toBe(true)
  })

  it('does not let a bold-name part match inside an unrelated word', () => {
    // R matched substrings anywhere in the name; "li" would have hit "Alice".
    expect(matchesBoldName('Alice Cooper', ['Li Cooper'])).toBe(false)
  })

  it('falls back to family + initials when the author name is short form', () => {
    expect(matchesBoldName('Furukawa Y', ['Yuki Furukawa'])).toBe(true)
    expect(matchesBoldName('Sakata M', ['Yuki Furukawa'])).toBe(false)
  })

  it('resolves particle surnames', () => {
    expect(matchesBoldName('van Straten A', ['Annemieke van Straten'])).toBe(
      true,
    )
  })

  it('documents the ambiguity of a short-form bold name', () => {
    // "Furukawa Y" carries nothing that separates Yuki from Yuri, so it
    // matches both. Spell the bold name out to disambiguate co-authors who
    // share a surname and an initial.
    expect(matchesBoldName('Yuki Furukawa', ['Furukawa Y'])).toBe(true)
    expect(matchesBoldName('Yuri Furukawa', ['Furukawa Y'])).toBe(true)
  })

  it('escapes the author name it bolds', () => {
    const evil = makePub({
      authors: ['<script>Furukawa Y'],
      authorsFull: ['Yuki Furukawa'],
    })
    const html = formatCitation(evil, 'vancouver', ['Yuki Furukawa'])
    expect(html).toContain('<b>&lt;script&gt;Furukawa Y</b>')
    expect(html).not.toContain('<script>')
  })
})

describe('author truncation', () => {
  const many = [
    'Aoki A',
    'Baker B',
    'Chen C',
    'Doi D',
    'Endo E',
    'Fuji F',
    'Goto G',
    'Hara H',
    'Ito I',
  ]
  const manyFull = [
    'Akira Aoki',
    'Bruce Baker',
    'Cheng Chen',
    'Daichi Doi',
    'Emi Endo',
    'Fumika Fuji',
    'Goro Goto',
    'Hanako Hara',
    'Ichiro Ito',
  ]

  it('shows the first three and et al. past six authors', () => {
    const pub = makePub({ authors: many, authorsFull: manyFull })
    expect(formatCitation(pub, 'vancouver')).toContain(
      'Aoki A, Baker B, Chen C, et al.',
    )
  })

  it('pulls a hidden bolded author back into view', () => {
    const pub = makePub({ authors: many, authorsFull: manyFull })
    expect(formatCitation(pub, 'vancouver', ['Hanako Hara'])).toContain(
      'Aoki A, Baker B, Chen C, ...<b>Hara H</b>, et al.',
    )
  })

  it('truncates identically in every style (R behaviour, not per-style caps)', () => {
    const pub = makePub({ authors: many, authorsFull: manyFull })
    for (const style of [
      'vancouver',
      'apa',
      'harvard',
      'chicago',
      'nature',
    ] as const) {
      expect(formatCitation(pub, style)).toContain(
        'Aoki A, Baker B, Chen C, et al.',
      )
    }
  })
})

describe('HTML escaping of upstream metadata', () => {
  it('escapes the title and the journal', () => {
    const pub = makePub({
      title: '<script>alert(1)</script> Sleep & Wake',
      journal: 'Journal of <b>Sleep</b> & Rhythms',
    })
    const html = formatCitation(pub, 'vancouver')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Sleep &amp; Wake')
    expect(html).toContain('<em>Journal of &lt;b&gt;Sleep&lt;/b&gt; &amp; Rhythms</em>')
  })

  it('cannot be broken out of via the doi href', () => {
    const pub = makePub({ doi: '10.1/x" onmouseover="alert(1)' })
    const html = formatCitation(pub, 'vancouver')
    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('%22')
  })
})
