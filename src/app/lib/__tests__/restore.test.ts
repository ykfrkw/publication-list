/**
 * @vitest-environment jsdom
 *
 * Pasting a snippet back in.
 *
 * The centrepiece is the round trip: a draft is projected onto a config, the
 * config into a snippet, and the snippet back into a draft, and the two drafts
 * have to agree field by field. Everything else here is either a different
 * paste shape or one of the things the paste is *not* allowed to do.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DISCLAIMER,
  normalizeConfig,
  serializeConfig,
} from '@/core/config'
import type { ListConfig, ListModel, Publication } from '@/core/types'
import {
  RestoreError,
  restoreFromPaste,
  type RestoreResult,
} from '../restore'
import {
  buildEmbedSnippet,
  buildIframeSnippet,
  SITE_BASE,
} from '../snippet'
import { draftToConfig, emptyDraft, type WizardDraft } from '../wizard'

// ─────────────────────────────────────────────────────────────── fixtures ──

const PUBLICATION: Publication = {
  key: 'doi:10.1136/bmj.n71',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ', 'Furukawa Y'],
  authorsFull: ['Matthew J Page', 'Yuki Furukawa'],
  journal: 'BMJ',
  year: 2021,
  doi: '10.1136/bmj.n71',
  pmid: '33782057',
  sources: ['orcid'],
  seedIds: ['0000-0003-1317-0220'],
  trust: 'confirmed',
  category: 'original',
}

function modelFor(config: ListConfig): ListModel {
  return {
    config,
    members: [],
    publications: [PUBLICATION],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-06T00:00:00.000Z',
  }
}

/**
 * The script snippet a draft would produce in the wizard.
 *
 * `snapshot` defaults to *on* here, unlike in the wizard: most of these tests
 * are about reading settings back out of a full snippet, and the snapshot is
 * the thing the credit and disclaimer lines are read beside. The lightweight
 * default has its own tests below.
 */
function snippetFor(draft: WizardDraft, credit = true, snapshot = true): string {
  const config = draftToConfig(draft)
  const model = modelFor({
    ...config,
    disclaimer: draft.disclaimer ? 'show' : 'hide',
  })
  return buildEmbedSnippet(model, { credit, snapshot })
}

/**
 * The config a restored draft projects onto, with `disclaimer` put back.
 *
 * `draftToConfig` deliberately never writes `disclaimer` — it would change
 * `configHash` and evict the cached build on every tick of the checkbox (see
 * `WizardDraft.disclaimer`) — so the comparison normalizes it on both sides and
 * the checkbox itself is asserted separately.
 */
function comparable(config: ListConfig): ListConfig {
  return { ...config, disclaimer: DEFAULT_DISCLAIMER }
}

const ARTICLE_DRAFT: WizardDraft = {
  ...emptyDraft('article'),
  pins: 'pmid:33782057\ndoi:10.1136/bmj.n71',
  exclude: ['pmid:12345678'],
  style: 'apa',
  groupBy: 'none',
  boldNames: 'Yuki Furukawa, Matthew J Page',
  from: '2015',
  to: '2026-08',
  limit: '50',
  japanese: 'merge',
  reviewPolicy: 'auto',
  preprints: true,
}

const PERSON_DRAFT: WizardDraft = {
  ...emptyDraft('person'),
  orcid: '0000-0003-1317-0220',
  researchmap: 'yukifurukawa',
  pubmed: 'Furukawa Y[au]\ninsomnia[ti] AND cognitive[ti]',
  pins: 'pmid:33782057',
  style: 'nature',
  groupBy: 'year',
  boldNames: 'Yuki Furukawa',
  limit: '20',
}

const LAB_DRAFT: WizardDraft = {
  ...emptyDraft('lab'),
  members: [
    '0000-0003-1317-0220',
    '0000-0002-1825-0097\t2019-04..2023-03+36',
    'yukifurukawa',
  ].join('\n'),
  pubmed: 'sleep[ti] AND Tokyo[ad]',
  pins: 'pmid:33782057',
  exclude: ['doi:10.1000/xyz'],
  style: 'harvard',
  groupBy: 'category',
  japanese: 'hide',
  boldNames: 'Yuki Furukawa',
  from: '2018-04',
  to: '2026',
  limit: '100',
  preprints: true,
}

/** Everything a user can see on the form. */
function visible(draft: WizardDraft) {
  return {
    mode: draft.mode,
    pins: draft.pins,
    orcid: draft.orcid,
    researchmap: draft.researchmap,
    pubmed: draft.pubmed,
    members: draft.members,
    style: draft.style,
    from: draft.from,
    to: draft.to,
    groupBy: draft.groupBy,
    preprints: draft.preprints,
    japanese: draft.japanese,
    reviewPolicy: draft.reviewPolicy,
    boldNames: draft.boldNames,
    limit: draft.limit,
    exclude: draft.exclude,
    credit: draft.credit,
    disclaimer: draft.disclaimer,
  }
}

// ─────────────────────────────────────────────────────────── round trips ──

describe('the round trip, draft → snippet → draft', () => {
  it('restores a reference list', async () => {
    const config = draftToConfig(ARTICLE_DRAFT)
    const { draft, form } = await restoreFromPaste(snippetFor(ARTICLE_DRAFT))

    expect(form).toBe('embed')
    expect(draft.mode).toBe('article')
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
    expect(visible(draft)).toEqual(visible(ARTICLE_DRAFT))
  })

  it('restores one person’s list, PubMed queries included', async () => {
    const config = draftToConfig(PERSON_DRAFT)
    const { draft } = await restoreFromPaste(snippetFor(PERSON_DRAFT))

    expect(draft.mode).toBe('person')
    expect(draft.orcid).toBe('0000-0003-1317-0220')
    expect(draft.researchmap).toBe('yukifurukawa')
    expect(draft.pubmed).toBe(
      'Furukawa Y[au]\ninsomnia[ti] AND cognitive[ti]',
    )
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
    expect(visible(draft)).toEqual(visible(PERSON_DRAFT))
  })

  it('restores a lab list, member time windows included', async () => {
    const config = draftToConfig(LAB_DRAFT)
    const { draft } = await restoreFromPaste(snippetFor(LAB_DRAFT))

    expect(draft.mode).toBe('lab')
    // ORCID seeds first, then researchmap ones — the order `draftToConfig`
    // reads them back in.
    expect(draft.members).toBe(
      [
        '0000-0003-1317-0220',
        '0000-0002-1825-0097\t2019-04..2023-03+36',
        'yukifurukawa',
      ].join('\n'),
    )
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
    expect(config.seeds.orcid).toEqual([
      '0000-0003-1317-0220',
      { id: '0000-0002-1825-0097', from: '2019-04', to: '2023-03', grace: 36 },
    ])
    expect(visible(draft)).toEqual(visible(LAB_DRAFT))
  })

  it('keeps a one-person list with a time window in lab mode', async () => {
    // Person mode's ORCID field is a single line with nowhere to put a window,
    // so a windowed seed opens on the form that can show it.
    const config = normalizeConfig({
      seeds: { orcid: [{ id: '0000-0003-1317-0220', to: '2023-03' }] },
    })
    const { draft } = await restoreFromPaste(
      buildEmbedSnippet(modelFor(config), { credit: true }),
    )
    expect(draft.mode).toBe('lab')
    expect(draft.members).toBe('0000-0003-1317-0220\t..2023-03')
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
  })

  it('leaves the review-decision lists alone and puts every pin in the box', async () => {
    const { draft } = await restoreFromPaste(snippetFor(PERSON_DRAFT))
    expect(draft.include).toEqual([])
    expect(draft.pins).toBe('pmid:33782057')
  })

  /**
   * The tick that says "publish this query's hits without reviewing them".
   *
   * It is the one PubMed-seed field whose loss would not be cosmetic — a seed
   * that comes back untrusted publishes a shorter list on the next load — so it
   * has a transport of its own, `data-pubmed-trusted`, and this is the test
   * that it survives the whole way round.
   */
  it('restores the review ticks onto the same queries', async () => {
    const draftWithTicks: WizardDraft = {
      ...emptyDraft('person'),
      orcid: '0000-0003-1317-0220',
      pubmed: 'a[au]\nb[au]\nc[au]',
      pubmedTrusted: ['a[au]', 'c[au]'],
    }
    const { draft } = await restoreFromPaste(snippetFor(draftWithTicks))

    expect(draft.pubmed).toBe('a[au]\nb[au]\nc[au]')
    expect(draft.pubmedTrusted).toEqual(['a[au]', 'c[au]'])
    expect(draftToConfig(draft).seeds.pubmed).toEqual([
      { query: 'a[au]', trust: 'confirmed' },
      { query: 'b[au]' },
      { query: 'c[au]', trust: 'confirmed' },
    ])
  })

  it('restores the ticks off the iframe snippet too', async () => {
    const config = normalizeConfig({
      seeds: { pubmed: [{ query: 'a[au]' }, { query: 'b[au]', trust: 'confirmed' }] },
    })
    const { draft } = await restoreFromPaste(buildIframeSnippet(config))
    expect(draft.pubmedTrusted).toEqual(['b[au]'])
  })

  it('restores a snippet that carries no snapshot at all', async () => {
    // The wizard's default snippet. Every setting is in the attributes, so
    // nothing about the round trip depends on the rendered list being there.
    const config = draftToConfig(PERSON_DRAFT)
    const { draft, form } = await restoreFromPaste(
      snippetFor(PERSON_DRAFT, true, false),
    )
    expect(form).toBe('embed')
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
    // The credit line is still in the markup to be read, because it is not
    // part of the snapshot.
    expect(draft.credit).toBe(true)
    expect(draft.disclaimer).toBe(true)
    // …and the box that produced it comes back unticked.
    expect(draft.snapshot).toBe(false)
  })

  it('remembers whether the pasted snippet had a snapshot', async () => {
    const withSnapshot = await restoreFromPaste(snippetFor(PERSON_DRAFT, true, true))
    expect(withSnapshot.draft.snapshot).toBe(true)
  })

  it('lists the excluded records so they can be undone', async () => {
    const { draft } = await restoreFromPaste(snippetFor(LAB_DRAFT))
    expect(draft.exclude).toEqual(['doi:10.1000/xyz'])
    expect(draft.removed).toEqual({ 'doi:10.1000/xyz': {} })
  })
})

/**
 * A comma inside a value, all the way round.
 *
 * Six parameters are comma-joined lists, and a realistic PubMed query contains
 * a comma: `Furukawa Y[au] AND (Tokyo, Japan[ad])`. Before `encodeListValue`
 * that query came back as **two** seeds — `…(Tokyo` and `Japan[ad])` — with no
 * error anywhere, and the wizard's answer was to steer the user to a hosted
 * file. The file is gone, so the escape has to hold: these are the tests that
 * say it does, on the whole path a user actually takes.
 */
describe('values the comma-joined transports used to break', () => {
  const COMMA = 'Furukawa Y[au] AND (Tokyo, Japan[ad])'
  const PERCENT = 'insomnia[ti] AND 50% response[tiab]'

  const withQueries = (pubmed: string): WizardDraft => ({
    ...emptyDraft('person'),
    orcid: '0000-0003-1317-0220',
    pubmed,
  })

  it('brings a query containing a comma back as one seed, not two', async () => {
    const before = withQueries(COMMA)
    const { draft } = await restoreFromPaste(snippetFor(before))

    expect(draft.pubmed).toBe(COMMA)
    expect(draftToConfig(draft).seeds.pubmed).toEqual([{ query: COMMA }])
    expect(visible(draft)).toEqual(visible(before))
  })

  it('brings a literal percent sign back unchanged', async () => {
    const before = withQueries(PERCENT)
    const { draft } = await restoreFromPaste(snippetFor(before))

    expect(draft.pubmed).toBe(PERCENT)
    expect(draftToConfig(draft).seeds.pubmed).toEqual([{ query: PERCENT }])
  })

  it('keeps several such queries apart, and in order', async () => {
    const before = withQueries([COMMA, PERCENT, 'plain[au]'].join('\n'))
    const { draft } = await restoreFromPaste(snippetFor(before))

    expect(draft.pubmed).toBe([COMMA, PERCENT, 'plain[au]'].join('\n'))
    expect(draftToConfig(draft).seeds.pubmed).toEqual([
      { query: COMMA },
      { query: PERCENT },
      { query: 'plain[au]' },
    ])
  })

  it('keeps the review tick on the query it was put on', async () => {
    // The ticks travel as positions within `data-pubmed`. A query that split in
    // two would shift every position after it onto the wrong query — the
    // failure mode that publishes somebody else's unreviewed hits.
    const before: WizardDraft = {
      ...withQueries([COMMA, 'b[au]'].join('\n')),
      pubmedTrusted: ['b[au]'],
    }
    const { draft } = await restoreFromPaste(snippetFor(before))

    expect(draft.pubmedTrusted).toEqual(['b[au]'])
    expect(draftToConfig(draft).seeds.pubmed).toEqual([
      { query: COMMA },
      { query: 'b[au]', trust: 'confirmed' },
    ])
  })

  it('survives the iframe snippet too, which joins the same way', async () => {
    const config = draftToConfig(withQueries([COMMA, PERCENT].join('\n')))
    const { draft, form } = await restoreFromPaste(buildIframeSnippet(config))

    expect(form).toBe('iframe')
    expect(draft.pubmed).toBe([COMMA, PERCENT].join('\n'))
  })

  it('carries a comma in the other list fields as well', async () => {
    // `exclude` rather than `boldNames`: the bold-names *box* is itself a
    // comma-separated field, so a comma typed there is a separator by design
    // and the wizard, not the transport, is where it splits. `exclude` is a
    // real array on both sides, so the whole path is the transport's.
    const config = normalizeConfig({
      seeds: { orcid: ['0000-0003-1317-0220'] },
      exclude: ['doi:10.1000/a,b', 'pmid:1'],
    })
    const { draft } = await restoreFromPaste(
      buildEmbedSnippet(modelFor(config), { credit: true }),
    )
    expect(draft.exclude).toEqual(['doi:10.1000/a,b', 'pmid:1'])
  })
})

// ────────────────────────────────────────────────────────── paste shapes ──

describe('the shapes a paste can take', () => {
  it('accepts the opening <div> on its own, with no snapshot', async () => {
    const { draft, form, lost } = await restoreFromPaste(
      '<div class="publist-embed" data-orcid="0000-0003-1317-0220" data-style="apa"></div>',
    )
    expect(form).toBe('embed')
    expect(draft.mode).toBe('person')
    expect(draft.orcid).toBe('0000-0003-1317-0220')
    expect(draft.style).toBe('apa')
    // No snapshot means nothing to read the credit off, and it says so.
    expect(draft.credit).toBe(true)
    expect(lost.join(' ')).toContain('credit link')
  })

  it('accepts the iframe snippet', async () => {
    const config = draftToConfig(PERSON_DRAFT)
    const { draft, form } = await restoreFromPaste(
      buildIframeSnippet(config, { credit: true }),
    )
    expect(form).toBe('iframe')
    expect(comparable(draftToConfig(draft))).toEqual(comparable(config))
    expect(draft.credit).toBe(true)
  })

  it('reads credit=0 off the iframe URL', async () => {
    const config = draftToConfig(PERSON_DRAFT)
    const { draft } = await restoreFromPaste(
      buildIframeSnippet(config, { credit: false }),
    )
    expect(draft.credit).toBe(false)
  })

  it('accepts a bare widget.html URL', async () => {
    const { draft, form } = await restoreFromPaste(
      `${SITE_BASE}widget.html?orcid=0000-0003-1317-0220&style=chicago&credit=0`,
    )
    expect(form).toBe('iframe')
    expect(draft.orcid).toBe('0000-0003-1317-0220')
    expect(draft.style).toBe('chicago')
    expect(draft.credit).toBe(false)
  })

  it('rejects a paste that is neither', async () => {
    await expect(restoreFromPaste('just some prose')).rejects.toBeInstanceOf(
      RestoreError,
    )
    await expect(restoreFromPaste('just some prose')).rejects.toThrow(
      /publist-embed/,
    )
    await expect(restoreFromPaste('  ')).rejects.toThrow(/nothing to read/)
  })

  it('names what it looked for when the markup has no settings in it', async () => {
    await expect(
      restoreFromPaste('<p>my publications</p>'),
    ).rejects.toThrow(/publist-embed[\s\S]*widget\.html/)
  })

  it('refuses markup whose settings name no source at all', async () => {
    await expect(
      restoreFromPaste('<div class="publist-embed" data-style="apa"></div>'),
    ).rejects.toThrow(/no publication source/)
  })
})

// ──────────────────────────────────────────────────────── the data-list id ──

function stubFetch(body: unknown) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    void url
    void init
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response)
  })
}

/**
 * `data-list` is the one route left that fetches anything.
 *
 * It names a file in this repository's own `lists/` registry, never a URL, and
 * the id is checked with `isListId` (shared from `core/config.ts` with the
 * widget and the embed script) before it is resolved against
 * `SITE_BASE` — so a paste cannot make this module request an arbitrary
 * address. The suite that used to live here covered `data-config` as well;
 * that route is gone, and the tests that were only about it went with it. The
 * ones below are the halves that still describe live behaviour.
 */
describe('the data-list route', () => {
  const HOSTED = normalizeConfig({
    seeds: {
      orcid: ['0000-0003-1317-0220'],
      pubmed: [
        {
          query: 'Furukawa Y[au]',
          trust: 'confirmed',
          label: 'my searches',
          from: '2019',
          grace: 12,
        },
      ],
    },
    style: 'apa',
  })

  it('resolves a data-list id against this site and nowhere else', async () => {
    const fetchStub = stubFetch(JSON.parse(serializeConfig(HOSTED)))
    const { draft, form, fetchedFrom, lost } = await restoreFromPaste(
      '<div class="publist-embed" data-list="sleepi"></div>',
      { fetch: fetchStub },
    )
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls[0][0]).toBe(`${SITE_BASE}lists/sleepi.json`)
    expect(form).toBe('list')
    expect(fetchedFrom).toBe(`${SITE_BASE}lists/sleepi.json`)
    expect(draft.style).toBe('apa')
    // The file route is the one that carries `trust`.
    expect(draft.pubmedTrusted).toEqual(['Furukawa Y[au]'])
    expect(lost.join(' ')).toContain('data-list id')
  })

  it('reports the PubMed fields the query box cannot hold', async () => {
    const { lost } = await restoreFromPaste(
      '<div class="publist-embed" data-list="sleepi"></div>',
      { fetch: stubFetch(JSON.parse(serializeConfig(HOSTED))) },
    )
    const text = lost.join('\n')
    expect(text).toContain('label')
    expect(text).toContain('start date')
    expect(text).toContain('grace period')
    expect(text).toContain('Furukawa Y[au]')
    // It does not claim to have lost the tick — the file carried it, and the
    // draft says so.
    expect(text).toContain('did come back')
    expect(text).not.toContain('Re-tick it')
  })

  it('refuses a data-list id that tries to climb out of lists/', async () => {
    const fetchStub = stubFetch({})
    await expect(
      restoreFromPaste(
        '<div class="publist-embed" data-list="../../secrets"></div>',
        { fetch: fetchStub },
      ),
    ).rejects.toThrow(/not a usable list id/)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('reports a fetch that fails rather than restoring half a form', async () => {
    const fetchStub = vi.fn(async () =>
      Promise.resolve({ ok: false, status: 404 } as unknown as Response),
    )
    await expect(
      restoreFromPaste('<div class="publist-embed" data-list="sleepi"></div>', {
        fetch: fetchStub,
      }),
    ).rejects.toThrow(/404/)
  })

  it('lets inline attributes win over the registry file, as the embed does', async () => {
    const { draft } = await restoreFromPaste(
      '<div class="publist-embed" data-list="sleepi" data-style="nature"></div>',
      { fetch: stubFetch(JSON.parse(serializeConfig(HOSTED))) },
    )
    expect(draft.style).toBe('nature')
  })
})

/**
 * The route that was removed, asserted as removed.
 *
 * A `data-config` attribute or a bare URL used to make this module fetch
 * whatever address the paste named. Both now stop at an error message, and —
 * the part that matters — neither reaches `fetch`.
 */
describe('a paste that names a URL to fetch', () => {
  it('does not fetch a data-config attribute, whatever it points at', async () => {
    const fetchStub = stubFetch({ seeds: { orcid: ['0000-0000-0000-0000'] } })
    await expect(
      restoreFromPaste(
        '<div class="publist-embed" data-config="https://evil.example/pubs.json"></div>',
        { fetch: fetchStub },
      ),
    ).rejects.toThrow(/no publication source/)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('ignores a data-config sitting beside real inline settings', async () => {
    const fetchStub = stubFetch({ style: 'nature' })
    const { draft, form } = await restoreFromPaste(
      '<div class="publist-embed" data-config="https://evil.example/pubs.json" ' +
        'data-orcid="0000-0003-1317-0220" data-style="apa"></div>',
      { fetch: fetchStub },
    )
    expect(fetchStub).not.toHaveBeenCalled()
    expect(form).toBe('embed')
    expect(draft.orcid).toBe('0000-0003-1317-0220')
    expect(draft.style).toBe('apa')
  })

  it('refuses a bare URL and says what would have worked', async () => {
    const fetchStub = stubFetch({})
    await expect(
      restoreFromPaste('https://example.org/pubs.json', { fetch: fetchStub }),
    ).rejects.toThrow(/Nothing here reads settings from a URL/)
    await expect(
      restoreFromPaste('https://example.org/pubs.json', { fetch: fetchStub }),
    ).rejects.toThrow(/publist-embed/)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────── credit and disclaimer lines ──

describe('the credit and disclaimer checkboxes', () => {
  const base: WizardDraft = { ...emptyDraft('person'), orcid: '0000-0003-1317-0220' }

  async function restoredFlags(credit: boolean, disclaimer: boolean) {
    const { draft } = await restoreFromPaste(
      snippetFor({ ...base, disclaimer }, credit),
    )
    return { credit: draft.credit, disclaimer: draft.disclaimer }
  }

  it('reads both back on', async () => {
    expect(await restoredFlags(true, true)).toEqual({
      credit: true,
      disclaimer: true,
    })
  })

  it('reads both back off', async () => {
    expect(await restoredFlags(false, false)).toEqual({
      credit: false,
      disclaimer: false,
    })
  })

  it('reads them independently', async () => {
    expect(await restoredFlags(false, true)).toEqual({
      credit: false,
      disclaimer: true,
    })
    expect(await restoredFlags(true, false)).toEqual({
      credit: true,
      disclaimer: false,
    })
  })

  it('follows the snapshot when the site owner has deleted the credit line', async () => {
    // `data-*` says nothing about the credit, so the markup is the evidence:
    // the line is gone from the page, so the box comes back unticked.
    const snippet = snippetFor(base, true).replace(
      /<p class="publist-credit"[\s\S]*?<\/p>/,
      '',
    )
    const { draft } = await restoreFromPaste(snippet)
    expect(draft.credit).toBe(false)
    expect(draft.disclaimer).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────── the losses ──

describe('what it says could not be restored', () => {
  it('names the PubMed extras on the inline route, and counts the tick as kept', async () => {
    const { lost } = await restoreFromPaste(snippetFor(PERSON_DRAFT))
    const text = lost.join('\n')
    // The name and the dates on a PubMed seed still have nowhere to go.
    expect(text).toContain('grace period')
    // The tick does travel now, in `data-pubmed-trusted`. The sentence names
    // it — as one of the two things a snippet *does* carry — so the assertion
    // is about what it claims, not about whether the words appear.
    expect(text).toContain('carries the query text and the “publish without review” tick')
    expect(text).not.toContain('Re-tick')
  })

  it('says nothing about PubMed when there are no PubMed seeds', async () => {
    const { lost } = await restoreFromPaste(snippetFor(ARTICLE_DRAFT))
    expect(lost.join('\n')).not.toContain('PubMed')
  })

  it('names the member names and the lost pairing in lab mode', async () => {
    const { lost } = await restoreFromPaste(snippetFor(LAB_DRAFT))
    const text = lost.join('\n')
    expect(text).toContain('names')
    expect(text).toContain('researchmap permalink')
  })

  it('names the removed records it can only show by identifier', async () => {
    const { lost } = await restoreFromPaste(snippetFor(ARTICLE_DRAFT))
    expect(lost.join('\n')).toContain('removed')
  })

  it('says nothing was lost when nothing was', async () => {
    const { lost } = await restoreFromPaste(
      snippetFor({ ...emptyDraft('person'), orcid: '0000-0003-1317-0220' }),
    )
    expect(lost).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────── security ──

describe('a hostile paste', () => {
  const HOSTILE = [
    '<div class="publist-embed" data-orcid="0000-0003-1317-0220" data-style="apa">',
    '  <section class="publist">',
    '    <img src="x" onerror="globalThis.__pwned = true">',
    '    <script>globalThis.__pwned = true</script>',
    '    <ol class="publist-list"><li>A paper</li></ol>',
    '    <p class="publist-disclaimer">…</p>',
    '  </section>',
    '</div>',
    '<script src="https://evil.example/embed.js" defer></script>',
  ].join('\n')

  it('restores the settings without running anything from the paste', async () => {
    const flag = () =>
      (globalThis as unknown as Record<string, unknown>).__pwned
    expect(flag()).toBeUndefined()

    const before = {
      img: document.querySelectorAll('img').length,
      script: document.querySelectorAll('script').length,
    }
    const { draft } = await restoreFromPaste(HOSTILE)

    expect(draft.orcid).toBe('0000-0003-1317-0220')
    expect(draft.style).toBe('apa')
    // The disclaimer was read off the snapshot; the credit was not there.
    expect(draft.disclaimer).toBe(true)
    expect(draft.credit).toBe(false)

    expect(flag()).toBeUndefined()
    expect(document.querySelectorAll('img').length).toBe(before.img)
    expect(document.querySelectorAll('script').length).toBe(before.script)
    expect(document.body.innerHTML).not.toContain('evil.example')
  })

  it('puts no markup from the paste into anything it returns', async () => {
    const result: RestoreResult = await restoreFromPaste(HOSTILE)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('onerror')
    expect(serialized).not.toContain('<script')
    expect(serialized).not.toContain('evil.example')
  })

  it('does not follow a URL the paste hides in an unrelated attribute', async () => {
    const fetchStub = stubFetch({})
    const { draft } = await restoreFromPaste(
      '<div class="publist-embed" data-orcid="0000-0003-1317-0220" src="https://evil.example/x.json" href="https://evil.example/y.json"></div>',
      { fetch: fetchStub },
    )
    expect(fetchStub).not.toHaveBeenCalled()
    expect(draft.orcid).toBe('0000-0003-1317-0220')
  })
})
