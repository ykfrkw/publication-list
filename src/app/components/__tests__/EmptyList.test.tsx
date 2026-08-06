/**
 * @vitest-environment jsdom
 *
 * What the wizard does with a list that has nothing on it.
 *
 * The failure being pinned here is not hypothetical. A group configured a
 * PubMed seed that returned exactly the five papers they wanted; every hit was
 * a `candidate`, `strict` kept candidates out of `publications`, and the wizard
 * handed over a snippet that was an empty `<section class="publist">`. Pasted
 * on a page it rendered nothing, and it would have gone on rendering nothing
 * for ever — an embed has no review queue, so the one action that would have
 * fixed it cannot be taken at the far end.
 *
 * Three things follow, and all three are asserted below:
 *
 *   1. An empty list says so at the top of the results, and says *which* of the
 *      three causes it is, because they have three different remedies.
 *   2. There is no snippet to copy. Not a warned-about snippet — none.
 *   3. Even a non-empty list warns when the embed will be smaller than the
 *      preview, which is the same bug one step short of its worst case.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import type { DroppedCounts, ListConfig, ListModel, Publication } from '@/core/types'
import { ResultsPanel } from '../ResultsPanel'
import { SnippetPanel } from '../SnippetPanel'
import { ArticleModeForm, LabModeForm, PersonModeForm } from '../ModeForms'
import { emptyDraft } from '../../lib/wizard'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOTHING_DROPPED: DroppedCounts = {
  excluded: 0,
  window: 0,
  erratum: 0,
  preprint: 0,
  dateRange: 0,
  limit: 0,
}

const CONFIRMED: Publication = {
  key: 'doi:10.1136/bmj.n71',
  title: 'The PRISMA 2020 statement',
  authors: ['Page MJ'],
  authorsFull: ['Matthew J Page'],
  journal: 'BMJ',
  year: 2021,
  doi: '10.1136/bmj.n71',
  sources: ['orcid'],
  seedIds: ['0000-0003-1317-0220'],
  trust: 'confirmed',
  category: 'original',
}

/** The owner's five PubMed hits, none of them confirmed. */
const SLEEPI_CANDIDATES: Publication[] = [
  38231522, 39242039, 39188094, 41061442, 40703853,
].map((pmid) => ({
  key: `pmid:${pmid}`,
  title: `SLEEPI paper ${pmid}`,
  authors: ['Furukawa Y'],
  authorsFull: ['Yuki Furukawa'],
  journal: 'Sleep',
  year: 2024,
  pmid: String(pmid),
  sources: ['pubmed'] as const,
  seedIds: ['sleepi'],
  trust: 'candidate' as const,
  category: 'original' as const,
}))

/** The owner's configuration, as `draftToConfig` would project it. */
const SLEEPI_CONFIG = normalizeConfig({
  seeds: {
    pubmed: [
      {
        query:
          '("SLEEPI"[author]) OR (38231522 [pmid] OR 39242039 [pmid] OR 39188094 [pmid] OR 41061442 [pmid] OR 40703853 [pmid])',
      },
    ],
  },
})

function model(over: Partial<ListModel> = {}, config?: ListConfig): ListModel {
  return {
    config: config ?? normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] } }),
    members: [],
    publications: [],
    candidates: [],
    warnings: [],
    dropped: { ...NOTHING_DROPPED },
    generatedAt: '2026-08-06T00:00:00.000Z',
    ...over,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderResults(m: ListModel) {
  act(() => {
    root.render(<ResultsPanel model={m} credit />)
  })
}

function renderSnippet(m: ListModel) {
  act(() => {
    root.render(
      <SnippetPanel
        model={m}
        credit
        disclaimer
        snapshot={false}
        onCreditChange={() => {}}
        onDisclaimerChange={() => {}}
        onSnapshotChange={() => {}}
      />,
    )
  })
}

function text(): string {
  return container.textContent ?? ''
}

describe('the empty-list warning in the results panel', () => {
  it('blames the review queue, and says confirming is what publishes', () => {
    renderResults(model({ candidates: SLEEPI_CANDIDATES }, SLEEPI_CONFIG))

    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(text()).toContain('5 records are waiting in the review queue')
    expect(text()).toContain('review queue above')
    expect(text()).toContain('never appear in an embed')
    // Not the other two causes.
    expect(text()).not.toContain('no source returned a record')
    expect(text()).not.toContain('every record found was filtered out')
  })

  it('names the filter responsible when a filter emptied the list', () => {
    renderResults(
      model(
        { dropped: { ...NOTHING_DROPPED, preprint: 2, dateRange: 1 } },
        normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] }, from: '2030' }),
      ),
    )

    expect(text()).toContain('every record found was filtered out')
    expect(text()).toContain('2 held back as preprints')
    expect(text()).toContain('Include preprints')
    expect(text()).toContain('date range you set (from 2030)')
    expect(text()).not.toContain('waiting in the review queue')
  })

  it('points at the seeds when nothing came back at all', () => {
    renderResults(model())

    expect(text()).toContain('no source returned a record')
    expect(text()).toContain('ORCID iD')
    expect(text()).not.toContain('waiting in the review queue')
  })

  it('says nothing at all about a list that has publications on it', () => {
    renderResults(model({ publications: [CONFIRMED] }))

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(text()).toContain('The PRISMA 2020 statement')
  })
})

describe('the snippet for a list that would render empty', () => {
  it('is not generated at all — there is nothing on the panel to copy', () => {
    renderSnippet(model({ candidates: SLEEPI_CANDIDATES }, SLEEPI_CONFIG))

    // No snippet block, and no button that would put one on the clipboard.
    expect(container.querySelector('pre')).toBeNull()
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    )
    expect(buttons.join('|')).not.toContain('Copy')
    expect(text()).not.toContain('publist-embed')
    expect(text()).not.toContain('embed.js')
  })

  it('explains why it is withheld, and what to fix', () => {
    renderSnippet(model({ candidates: SLEEPI_CANDIDATES }, SLEEPI_CONFIG))

    expect(text()).toContain('would stay empty for ever')
    expect(text()).toContain('no review queue')
    // The same diagnosis the results panel gives, so the two do not disagree.
    expect(text()).toContain('5 records are waiting in the review queue')
    expect(text()).toContain('press Generate list again')
  })

  it('is withheld for a filtered-empty list too, with that cause named', () => {
    renderSnippet(model({ dropped: { ...NOTHING_DROPPED, excluded: 3 } }))

    expect(container.querySelector('pre')).toBeNull()
    expect(text()).toContain('every record found was filtered out')
    expect(text()).toContain('3 in the exclude list')
  })
})

describe('the candidate-count note beside a snippet that does get generated', () => {
  it('states how many records the embed will be missing', () => {
    renderSnippet(model({ publications: [CONFIRMED], candidates: SLEEPI_CANDIDATES }))

    expect(text()).toContain('5 records in the review queue are not in this snippet')
    expect(text()).toContain('It carries the 1 publication on your list.')
    expect(text()).toContain('never in an embed')
    // The snippet itself is still there: this is a warning, not a block.
    expect(container.querySelector('pre')?.textContent).toContain('publist-embed')
  })

  it('reads singular for a single outstanding candidate', () => {
    renderSnippet(
      model({ publications: [CONFIRMED], candidates: [SLEEPI_CANDIDATES[0]] }),
    )
    expect(text()).toContain('1 record in the review queue is not in this snippet')
  })

  it('is absent when there is nothing outstanding', () => {
    renderSnippet(model({ publications: [CONFIRMED] }))
    expect(text()).not.toContain('review queue')
    expect(container.querySelector('pre')?.textContent).toContain('publist-embed')
  })

  it('is absent under `auto`, where the candidates are published anyway', () => {
    renderSnippet(
      model({
        publications: [CONFIRMED, ...SLEEPI_CANDIDATES],
        candidates: SLEEPI_CANDIDATES,
      }),
    )
    expect(text()).not.toContain('not in this snippet')
  })
})

describe('the hint next to the PubMed query box', () => {
  function renderLab(pubmed: string) {
    act(() => {
      root.render(
        <LabModeForm draft={{ ...emptyDraft('lab'), pubmed }} update={() => {}} />,
      )
    })
  }

  it('fires on the owner’s query and names the identifiers to move', () => {
    renderLab(SLEEPI_CONFIG.seeds.pubmed![0].query)

    expect(text()).toContain('Those look like pins rather than a search')
    expect(text()).toContain('38231522, 39242039, 39188094, 41061442, 40703853')
    // "above", not "below": the pinned-papers field now precedes the query
    // field, and a hint that points the wrong way is worse than none.
    expect(text()).toContain('pinned-papers box above')
    expect(text()).not.toContain('pinned-papers box below')
    // It is a hint, not a rewrite: the textarea still holds what was typed.
    const box = Array.from(container.querySelectorAll('textarea')).find((t) =>
      t.value.includes('[pmid]'),
    )
    expect(box?.value).toBe(SLEEPI_CONFIG.seeds.pubmed![0].query)
  })

  it('stays quiet for an ordinary author query', () => {
    renderLab('Tanaka H[au] AND ("Univ Tokyo"[ad]) AND 2019:2026[dp]')
    expect(text()).not.toContain('look like pins')
  })
})

/**
 * Which box comes first.
 *
 * Naming a paper by its identifier is the simpler act, the more reliable one
 * and the more common one: it finds exactly the record meant and needs no
 * review. A PubMed query can be too broad, can return nothing, and puts
 * everything it finds in a queue. The pinned box therefore sits above the query
 * box — and the hint above, which now says "above", depends on it.
 */
describe('the order of the two source fields', () => {
  function fieldOrder(): string[] {
    // Field labels in document order, which is what a reader meets them in.
    return Array.from(container.querySelectorAll('label'))
      .map((el) => el.textContent ?? '')
      .filter(
        (label) => label.includes('Pinned papers') || label.includes('PubMed queries'),
      )
  }

  it('puts the pinned-papers field above the queries field in person mode', () => {
    act(() => {
      root.render(
        <PersonModeForm draft={emptyDraft('person')} update={() => {}} />,
      )
    })
    const order = fieldOrder()
    expect(order).toHaveLength(2)
    expect(order[0]).toContain('Pinned papers')
    expect(order[1]).toContain('PubMed queries')
  })

  it('puts them in the same order in lab mode', () => {
    act(() => {
      root.render(<LabModeForm draft={emptyDraft('lab')} update={() => {}} />)
    })
    const order = fieldOrder()
    expect(order).toHaveLength(2)
    expect(order[0]).toContain('Pinned papers')
    expect(order[1]).toContain('PubMed queries')
  })

  it('spells the pinned field the same way in all three modes', () => {
    const labels = new Set<string>()
    for (const form of [
      <ArticleModeForm key="a" draft={emptyDraft('article')} update={() => {}} />,
      <PersonModeForm key="p" draft={emptyDraft('person')} update={() => {}} />,
      <LabModeForm key="l" draft={emptyDraft('lab')} update={() => {}} />,
    ]) {
      act(() => root.render(form))
      const found = Array.from(container.querySelectorAll('label'))
        .map((el) => el.textContent ?? '')
        .find((label) => label.includes('Pinned papers'))
      expect(found).toBeDefined()
      labels.add(found!)
    }
    // Three modes, one name. It used to be three names for one box, in a
    // wizard whose point is that a list built in one mode reopens in another.
    expect([...labels]).toEqual(['Pinned papers (PMIDs and DOIs)'])
  })
})

/**
 * No solid button in the results panel — deliberately, not by omission.
 *
 * The row is a set of peer export formats (Word, WordPress, static HTML,
 * Markdown, BibTeX, RIS) and the tool has no opinion about which one a given
 * person came for. Promoting one to solid would be a claim it cannot make. The
 * one action it does ask for is `Copy snippet`, which is solid in
 * `SnippetPanel` — see the matching count in `SnippetPanel.test.tsx`.
 */
describe('the export row’s button hierarchy', () => {
  function solidButtons(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).filter((b) => b.classList.contains('bg-primary'))
  }

  it('has an empty primary slot for a list with publications on it', () => {
    renderResults(model({ publications: [CONFIRMED] }))
    expect(solidButtons()).toEqual([])
    // The exports are all there — this is a hierarchy claim, not an absence of
    // controls.
    const labels = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    )
    expect(labels.join('|')).toContain('Copy All (for Word)')
    expect(labels.join('|')).toContain('.bib')
  })

  it('offers no pubs.json download beside the other formats', () => {
    renderResults(model({ publications: [CONFIRMED] }))
    expect(text()).not.toContain('pubs.json')
  })

  it('stays empty for an empty list too', () => {
    renderResults(model({ candidates: SLEEPI_CANDIDATES }, SLEEPI_CONFIG))
    expect(solidButtons()).toEqual([])
  })
})
