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

  // The scheme allowlist is defense in depth: no current call site can reach
  // it with an attacker-controlled scheme (both prepend a hardcoded
  // `https://`). These pin the guard so a future one cannot.
  it('passes http and https through', () => {
    expect(escapeUrl('https://doi.org/10.1136/bmj.n71')).toBe(
      'https://doi.org/10.1136/bmj.n71',
    )
    expect(escapeUrl('http://example.ac.uk/pubs')).toBe(
      'http://example.ac.uk/pubs',
    )
  })

  it('passes scheme-relative and relative URLs through', () => {
    expect(escapeUrl('//example.ac.uk/pubs')).toBe('//example.ac.uk/pubs')
    expect(escapeUrl('/publications')).toBe('/publications')
    expect(escapeUrl('10.1136/bmj.n71')).toBe('10.1136/bmj.n71')
    expect(escapeUrl('')).toBe('')
  })

  it('refuses javascript:, data: and vbscript:', () => {
    expect(escapeUrl('javascript:alert(1)')).toBe('')
    expect(escapeUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(escapeUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('refuses a mixed-case scheme', () => {
    expect(escapeUrl('JaVaScRiPt:alert(1)')).toBe('')
    expect(escapeUrl('DATA:text/html,x')).toBe('')
  })

  it('refuses leading whitespace and control-character evasion', () => {
    expect(escapeUrl('  javascript:alert(1)')).toBe('')
    expect(escapeUrl('\u0001javascript:alert(1)')).toBe('')
    expect(escapeUrl('\njavascript:alert(1)')).toBe('')
    expect(escapeUrl('\u0000javascript:alert(1)')).toBe('')
  })

  it('refuses a scheme split by an embedded tab or newline', () => {
    expect(escapeUrl('java\tscript:alert(1)')).toBe('')
    expect(escapeUrl('java\nscript:alert(1)')).toBe('')
    expect(escapeUrl('java\r\nscript:alert(1)')).toBe('')
    expect(escapeUrl('jav\u0009ascript:alert(1)')).toBe('')
  })

  it('leaves the two current call sites untouched', () => {
    // Whatever a malicious DOI contains, the hardcoded prefix makes the
    // result an ordinary https URL — allowed, and inert.
    expect(escapeUrl('https://doi.org/' + 'javascript:alert(1)')).toBe(
      'https://doi.org/javascript:alert(1)',
    )
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

// ───────────────────────────────────────────── segments that self-terminate ──

describe('segments that already end in a period', () => {
  /** Real shape: >6 authors, so the list ends in "et al." */
  const truncated = makePub({
    authors: [
      'Furukawa Y', 'Sakata M', 'Cipriani A', 'Efthimiou O',
      'Perlis M', 'Luo Y', 'Noma H',
    ],
    authorsFull: [
      'Yuki Furukawa', 'Masatsugu Sakata', 'Andrea Cipriani', 'Orestis Efthimiou',
      'Michael Perlis', 'Yan Luo', 'Hisashi Noma',
    ],
  })

  it('does not double the period after "et al."', () => {
    // 20 of 34 citations in the 2026-08-05 live run read "…, et al.." here.
    for (const style of ['vancouver', 'chicago', 'nature'] as const) {
      const html = formatCitation(truncated, style)
      expect(html).toContain('Furukawa Y, Sakata M, Cipriani A, et al.')
      expect(html).not.toContain('et al..')
    }
    expect(formatCitationPlain(truncated, 'vancouver')).not.toContain('et al..')
  })

  it('still terminates an author list of six or fewer', () => {
    expect(formatCitation(makePub(), 'vancouver')).toContain('Cipriani A. ')
  })

  it('does not double the period after a title that carries its own', () => {
    // PubMed titles routinely arrive with a trailing period.
    const pub = makePub({
      title: 'Mental Health of Health Care Workers During the COVID-19 Pandemic.',
    })
    for (const style of ['vancouver', 'apa', 'chicago', 'nature'] as const) {
      const html = formatCitation(pub, style)
      expect(html).not.toContain('Pandemic..')
      expect(html).toContain('Pandemic.')
    }
    expect(formatCitationPlain(pub, 'vancouver')).not.toContain('Pandemic..')
  })

  it('keeps the quotes around a Chicago title outside its period', () => {
    const pub = makePub({ title: 'Sleep and depression.' })
    expect(formatCitation(pub, 'chicago')).toContain('"Sleep and depression."')
  })

  it('does not double the period after an abbreviated journal name', () => {
    // The period lands outside <em>, so the check has to see through the tag.
    const pub = makePub({ journal: 'Sleep Med.' })
    for (const style of ['vancouver', 'apa', 'harvard'] as const) {
      expect(formatCitation(pub, style)).toContain('<em>Sleep Med.</em>')
      expect(formatCitation(pub, style)).not.toContain('<em>Sleep Med.</em>.')
    }
    expect(formatCitationPlain(pub, 'vancouver')).not.toContain('Sleep Med..')
  })

  it('still terminates a journal name that does not', () => {
    expect(formatCitation(makePub(), 'vancouver')).toContain(
      '<em>JAMA Psychiatry</em>.',
    )
  })

  it('leaves a bolded last author terminated', () => {
    const html = formatCitation(makePub(), 'vancouver', ['Andrea Cipriani'])
    expect(html).toContain('<b>Cipriani A</b>. ')
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
