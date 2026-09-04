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

  // Japanese-script matching is EXACT equality after `normalizeNameCjk` —
  // no surname-only or prefix matching, in keeping with this module's
  // under-bolding stance (see the Yuki/Yuri cases above).
  describe('Japanese-script names', () => {
    it('matches kanji names across space variants', () => {
      expect(matchesBoldName('古川雄基', ['古川雄基'])).toBe(true)
      expect(matchesBoldName('古川 雄基', ['古川雄基'])).toBe(true)
      expect(matchesBoldName('古川　雄基', ['古川雄基'])).toBe(true)
      expect(matchesBoldName('古川雄基', ['古川 雄基'])).toBe(true)
      expect(matchesBoldName('古川雄基', ['古川　雄基'])).toBe(true)
    })

    it('matches kana names across space variants', () => {
      expect(matchesBoldName('ふるかわゆうき', ['ふるかわ ゆうき'])).toBe(true)
      expect(matchesBoldName('ふるかわ ゆうき', ['ふるかわゆうき'])).toBe(true)
    })

    it('matches a 中点-separated author string', () => {
      expect(matchesBoldName('古川・雄基', ['古川雄基'])).toBe(true)
      expect(matchesBoldName('ふるかわ・ゆうき', ['ふるかわゆうき'])).toBe(true)
    })

    it('does not let a bare surname sweep up a full name', () => {
      expect(matchesBoldName('古川雄基', ['古川'])).toBe(false)
      expect(matchesBoldName('古川', ['古川雄基'])).toBe(false)
    })

    it('does not match a near-miss that shares a prefix', () => {
      expect(matchesBoldName('古川雄基', ['古川雄大'])).toBe(false)
      expect(matchesBoldName('古川雄大', ['古川雄基'])).toBe(false)
    })

    it('never matches across scripts', () => {
      expect(matchesBoldName('古川雄基', ['Yuki Furukawa'])).toBe(false)
      expect(matchesBoldName('Yuki Furukawa', ['古川雄基'])).toBe(false)
    })

    it('bolds both renderings when boldNames carries both forms', () => {
      const boldNames = ['Yuki Furukawa', '古川雄基']
      // The Latin author list…
      const latin = formatCitation(makePub(), 'vancouver', boldNames)
      expect(latin).toContain('<b>Furukawa Y</b>')
      // …and the Japanese one, from the same bold-name set.
      const ja = makePub({
        authors: ['古川 雄基', '佐藤 花子'],
        authorsFull: ['古川 雄基', '佐藤 花子'],
      })
      const html = formatCitation(ja, 'vancouver', boldNames)
      expect(html).toContain('<b>古川 雄基</b>')
      expect(html).not.toContain('<b>佐藤 花子</b>')
    })
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

// ─────────────────────────────────────── kind-aware citations (業績集) ──

describe('book citations', () => {
  const jaBook = makePub({
    kind: 'book',
    title: '不眠症診療の実際',
    authors: ['古川 雄基', '佐藤 花子'],
    authorsFull: ['古川 雄基', '佐藤 花子'],
    journal: '',
    doi: undefined,
    pmid: undefined,
    publisher: '医学書院',
    year: 2024,
  })

  it('renders the Japanese template with 、：．punctuation', () => {
    expect(formatCitationPlain(jaBook, 'vancouver')).toBe(
      '古川 雄基、佐藤 花子：不眠症診療の実際．医学書院、2024.',
    )
  })

  it('appends the 担当 range before the final period', () => {
    const withRange = makePub({ ...jaBook, bookRange: '第3章 pp. 45-60' })
    expect(formatCitationPlain(withRange, 'vancouver')).toBe(
      '古川 雄基、佐藤 花子：不眠症診療の実際．医学書院、2024（担当：第3章 pp. 45-60）.',
    )
  })

  it('bolds a Japanese author through the shared CJK matching path', () => {
    // The bold name has no space; the author list does. `normalizeNameCjk`
    // equality has to bridge that, exactly as it does for papers.
    const html = formatCitation(jaBook, 'vancouver', ['古川雄基'])
    expect(html).toContain('<b>古川 雄基</b>、佐藤 花子：')
    expect(html).not.toContain('<b>佐藤 花子</b>')
  })

  it('falls back to Latin punctuation when nothing is Japanese-script', () => {
    const latin = makePub({
      kind: 'book',
      title: 'Clinical Handbook of Insomnia',
      journal: '',
      doi: undefined,
      publisher: 'Springer',
      year: 2023,
    })
    expect(formatCitationPlain(latin, 'vancouver')).toBe(
      'Furukawa Y, Sakata M, Cipriani A: Clinical Handbook of Insomnia. Springer; 2023.',
    )
  })

  it('ignores the citation style beyond the Latin author separators', () => {
    const latin = makePub({
      kind: 'book',
      title: 'Clinical Handbook of Insomnia',
      journal: '',
      doi: undefined,
      publisher: 'Springer',
      year: 2023,
    })
    // APA's "&" joins the authors, but the template stays the fixed book one —
    // no "(2023)." and no trailing journal segment.
    expect(formatCitationPlain(latin, 'apa')).toBe(
      'Furukawa Y, Sakata M, & Cipriani A: Clinical Handbook of Insomnia. Springer; 2023.',
    )
  })

  it('keeps the linked doi tail — the one link a non-paper may carry', () => {
    const withDoi = makePub({
      kind: 'book',
      title: 'Clinical Handbook of Insomnia',
      journal: '',
      publisher: 'Springer',
      doi: '10.1000/book.1',
    })
    const html = formatCitation(withDoi, 'vancouver')
    expect(html).toContain('Springer; 2024.')
    expect(html).toContain(
      'doi: <a href="https://doi.org/10.1000/book.1" target="_blank">10.1000/book.1</a>',
    )
  })

  it('escapes the publisher in the HTML flavour', () => {
    const evil = makePub({
      kind: 'book',
      journal: '',
      doi: undefined,
      publisher: 'Springer & <b>Sons</b>',
    })
    const html = formatCitation(evil, 'vancouver')
    expect(html).toContain('Springer &amp; &lt;b&gt;Sons&lt;/b&gt;')
    expect(html).not.toContain('<b>Sons</b>')
  })
})

describe('presentation citations', () => {
  const jaTalk = makePub({
    kind: 'presentation',
    title: '不眠症の行動療法',
    authors: ['古川 雄基'],
    authorsFull: ['古川 雄基'],
    journal: '',
    doi: undefined,
    pmid: undefined,
    event: 'Annual Meeting of the Japanese Society of Sleep Research',
    eventJa: '日本睡眠学会第48回定期学術集会',
    year: 2024,
    month: 7,
  })

  it('renders the Japanese template, preferring eventJa, with 年月', () => {
    expect(formatCitationPlain(jaTalk, 'vancouver')).toBe(
      '古川 雄基：不眠症の行動療法．日本睡眠学会第48回定期学術集会、2024年7月.',
    )
  })

  it('marks an invited talk 招待講演 before the final period', () => {
    const invited = makePub({ ...jaTalk, invited: true })
    expect(formatCitationPlain(invited, 'vancouver')).toBe(
      '古川 雄基：不眠症の行動療法．日本睡眠学会第48回定期学術集会、2024年7月（招待講演）.',
    )
  })

  it('bolds a Japanese presenter from a kanji bold name', () => {
    const html = formatCitation(jaTalk, 'vancouver', ['古川雄基'])
    expect(html).toContain('<b>古川 雄基</b>：')
  })

  const latinTalk = makePub({
    kind: 'presentation',
    title: 'Behavioural treatment of insomnia',
    journal: '',
    doi: undefined,
    event: 'World Sleep Congress',
    year: 2024,
    month: 6,
  })

  it('renders the Latin template with an abbreviated month', () => {
    expect(formatCitationPlain(latinTalk, 'vancouver')).toBe(
      'Furukawa Y, Sakata M, Cipriani A: Behavioural treatment of insomnia. World Sleep Congress, Jun 2024.',
    )
  })

  it('drops the month cleanly when the record has none', () => {
    const undatedMonth = makePub({ ...latinTalk, month: undefined })
    expect(formatCitationPlain(undatedMonth, 'vancouver')).toBe(
      'Furukawa Y, Sakata M, Cipriani A: Behavioural treatment of insomnia. World Sleep Congress, 2024.',
    )
  })

  it('marks an invited Latin talk with (invited)', () => {
    const invited = makePub({ ...latinTalk, invited: true })
    expect(formatCitationPlain(invited, 'vancouver')).toContain(
      'World Sleep Congress, Jun 2024 (invited).',
    )
  })

  it('falls back to the other-language event name when only one exists', () => {
    // A Latin-script talk whose record carries only the Japanese event name
    // still shows the event, rather than losing it to the preference order.
    const onlyJa = makePub({
      ...latinTalk,
      event: undefined,
      eventJa: '日本睡眠学会',
    })
    expect(formatCitationPlain(onlyJa, 'vancouver')).toContain('. 日本睡眠学会,')
  })

  it('never links a presentation, even when a doi is present', () => {
    const withDoi = makePub({ ...latinTalk, doi: '10.1000/talk.1' })
    const html = formatCitation(withDoi, 'vancouver')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('doi:')
  })
})

describe('award citations', () => {
  it('renders the Japanese template with no author list', () => {
    const ja = makePub({
      kind: 'award',
      title: '最優秀演題賞',
      journal: '',
      doi: undefined,
      pmid: undefined,
      awardAssociation: '日本睡眠学会',
      year: 2023,
    })
    expect(formatCitationPlain(ja, 'vancouver')).toBe(
      '最優秀演題賞．日本睡眠学会、2023.',
    )
    // The record carries authors; the template must not.
    expect(formatCitationPlain(ja, 'vancouver')).not.toContain('Furukawa')
  })

  it('renders the Latin template', () => {
    const latin = makePub({
      kind: 'award',
      title: 'Early Career Investigator Award',
      authors: [],
      authorsFull: [],
      journal: '',
      doi: undefined,
      awardAssociation: 'World Sleep Society',
      year: 2023,
    })
    expect(formatCitationPlain(latin, 'vancouver')).toBe(
      'Early Career Investigator Award. World Sleep Society, 2023.',
    )
  })

  it('never links an award, even when a doi is present', () => {
    const withDoi = makePub({
      kind: 'award',
      title: 'Best Paper Award',
      journal: '',
      awardAssociation: 'World Sleep Society',
      doi: '10.1000/award.1',
    })
    expect(formatCitation(withDoi, 'vancouver')).not.toContain('<a ')
  })
})

describe('kind defaults to paper', () => {
  it('renders an explicit kind: paper byte-identically to an absent one', () => {
    for (const style of [
      'vancouver',
      'apa',
      'harvard',
      'chicago',
      'nature',
    ] as const) {
      expect(formatCitation(makePub({ kind: 'paper' }), style)).toBe(
        formatCitation(makePub(), style),
      )
      expect(formatCitationPlain(makePub({ kind: 'paper' }), style)).toBe(
        formatCitationPlain(makePub(), style),
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
