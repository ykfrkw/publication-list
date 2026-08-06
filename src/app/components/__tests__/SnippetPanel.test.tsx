/**
 * @vitest-environment jsdom
 *
 * Component test for the embed panel's disclosure rules.
 *
 * Two things are asserted here rather than left to judgement, because both are
 * about what a first-time visitor is confronted with:
 *
 *   - the hosted-`pubs.json` route appears **only when it is needed** — an
 *     inline attribute block too long to paste and read back, or a value
 *     containing a comma that comma-joined attributes cannot carry;
 *   - the iframe snippet starts **collapsed**, because it is the fallback for a
 *     CMS that strips `<script>`, not the route to recommend.
 *
 * Nothing here touches the network: the model is a fixture.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import type { ListConfig, ListModel, Publication } from '@/core/types'
import { INLINE_ATTR_BUDGET, inlineAttributeLength } from '../../lib/snippet'
import { SnippetPanel } from '../SnippetPanel'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PUBLICATION: Publication = {
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

function model(config: ListConfig): ListModel {
  return {
    config,
    members: [],
    publications: [PUBLICATION],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-06T00:00:00.000Z',
  }
}

/** The common case: one ORCID iD and a citation style. */
const SIMPLE = normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] } })

/** A lab that has rejected dozens of same-name candidates. */
const OVERSIZED = normalizeConfig({
  seeds: { orcid: ['0000-0003-1317-0220'] },
  exclude: Array.from({ length: 40 }, (_, i) => `pmid:${30000000 + i}`),
})

/** A PubMed query with a comma in it — unrepresentable as a joined attribute. */
const COMMA_HOSTILE = normalizeConfig({
  seeds: { pubmed: [{ query: 'Furukawa Y[au] AND (Tokyo, Japan[ad])' }] },
})

/** A trusted PubMed seed — a flag neither inline transport can carry. */
const TRUSTED_SEED = normalizeConfig({
  seeds: { pubmed: [{ query: '"SLEEPI"[cn]', trust: 'confirmed' }] },
})

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

function render(config: ListConfig, configUrl = '', snapshot = false) {
  act(() => {
    root.render(
      <SnippetPanel
        model={model(config)}
        credit
        disclaimer
        snapshot={snapshot}
        configUrl={configUrl}
        onCreditChange={() => {}}
        onDisclaimerChange={() => {}}
        onSnapshotChange={() => {}}
        onConfigUrlChange={() => {}}
      />,
    )
  })
}

/** The checkbox whose label contains `text`. */
function checkbox(text: string): HTMLInputElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((input) => {
    const id = input.getAttribute('id')
    const label = id == null ? null : container.querySelector(`label[for="${id}"]`)
    return (label?.textContent ?? '').includes(text)
  })
}

/** Every `<details>` whose summary mentions `text`. */
function disclosure(text: string): HTMLDetailsElement | undefined {
  return Array.from(container.querySelectorAll('details')).find((el) =>
    (el.querySelector('summary')?.textContent ?? '').includes(text),
  )
}

function hostedUrlInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
}

describe('the hosted pubs.json route', () => {
  it('is out of the way for a plain single-ORCID configuration', () => {
    expect(inlineAttributeLength(SIMPLE)).toBeLessThan(INLINE_ATTR_BUDGET)
    render(SIMPLE)

    // Reachable, but behind a disclosure that starts closed — not a field
    // competing with the snippet the visitor came for.
    const details = disclosure('Keep the settings in a file')
    expect(details).toBeDefined()
    expect(details?.open).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('is shown outright when the inline attributes are too long to paste', () => {
    expect(inlineAttributeLength(OVERSIZED)).toBeGreaterThan(INLINE_ATTR_BUDGET)
    render(OVERSIZED)

    expect(disclosure('Keep the settings in a file')).toBeUndefined()
    expect(container.textContent).toContain('large for inline attributes')
    expect(hostedUrlInput()).not.toBeNull()
  })

  it('is shown outright when a value contains a comma', () => {
    render(COMMA_HOSTILE)

    expect(disclosure('Keep the settings in a file')).toBeUndefined()
    expect(container.textContent).toContain('cannot travel in an inline attribute')
  })

  it('stays visible once a hosted URL has been pasted, with no size complaint', () => {
    render(SIMPLE, 'https://gist.githubusercontent.com/x/pubs.json')

    expect(disclosure('Keep the settings in a file')).toBeUndefined()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('explains what the file is and why hosting it is worth the trouble', () => {
    render(SIMPLE)
    const text = disclosure('Keep the settings in a file')?.textContent ?? ''
    expect(text).toContain('pubs.json')
    expect(text).toContain('Gist')
    expect(text).toContain('data-config')
    expect(text).toContain('every page')
    // The download is right where the explanation is.
    expect(text).toContain('Download pubs.json')
  })
})

describe('the iframe snippet', () => {
  it('starts collapsed and says what it is for', () => {
    render(SIMPLE)
    const details = disclosure('iframe snippet')
    expect(details).toBeDefined()
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toContain('strips')
  })

  it('still carries the widget URL inside', () => {
    render(SIMPLE)
    const details = disclosure('iframe snippet')
    expect(details?.textContent).toContain('widget.html')
  })
})

describe('the script snippet', () => {
  it('is never collapsed — it is the route being recommended', () => {
    render(SIMPLE)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('publist-embed')
    expect(pre?.closest('details')).toBeNull()
  })
})

/**
 * A trusted PubMed seed used to leave this panel with nothing to hand over:
 * both snippets were withheld and a hosted `pubs.json` was demanded instead.
 * Since the trust travels in `data-pubmed-trusted`, it is an ordinary list —
 * and this is the regression test for the dead end, because the only route to
 * an auto-updating group list ran through it.
 */
describe('a list that trusts a PubMed query', () => {
  it('produces both snippets, with the tick carried inline', () => {
    render(TRUSTED_SEED)

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('data-pubmed="&quot;SLEEPI&quot;[cn]"')
    expect(pre?.textContent).toContain('data-pubmed-trusted="0"')
    // The iframe fallback is there too, and carries the same flag.
    const iframe = disclosure('iframe snippet')
    expect(iframe).toBeDefined()
    expect(iframe?.textContent).toContain('pubmed-trusted=0')
    // Nothing is demanded of the user: the hosted file is back behind its
    // disclosure, where every other ordinary configuration leaves it.
    expect(container.textContent).not.toContain('needs the file below')
    expect(disclosure('Keep the settings in a file')).toBeDefined()
  })

  it('emits a data-config snippet once the URL is there', () => {
    render(TRUSTED_SEED, 'https://example.org/pubs.json')

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('data-config="https://example.org/pubs.json"')
    // The query is not also inlined — the file is the whole configuration.
    expect(pre?.textContent).not.toContain('data-pubmed')
    expect(container.textContent).not.toContain('needs the file below')
    expect(disclosure('iframe snippet')).toBeDefined()
  })

  it('leaves an untrusted version of the same query alone', () => {
    render(normalizeConfig({ seeds: { pubmed: [{ query: '"SLEEPI"[cn]' }] } }))

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('data-pubmed')
    expect(pre?.textContent).not.toContain('data-pubmed-trusted')
    expect(container.textContent).not.toContain('needs the file below')
  })
})

/**
 * The snapshot is a tick box, unticked to begin with and recommended in its
 * own label. The credit line is not part of it and must survive either way —
 * `embed.js` can never put one back, so a snapshot that took the credit with it
 * would be a link deleted silently and permanently.
 */
describe('the snapshot checkbox', () => {
  it('is off to begin with, and says so as a recommendation', () => {
    render(SIMPLE)
    const box = checkbox('Include the list itself')
    expect(box).toBeDefined()
    expect(box?.checked).toBe(false)
    const label = container.querySelector(`label[for="${box?.id}"]`)
    expect(label?.textContent).toContain('recommended')
  })

  it('names all three things a missing snapshot costs, beside the box', () => {
    render(SIMPLE)
    const hint = checkbox('Include the list itself')?.closest('div')?.textContent ?? ''
    expect(hint).toContain('search engines')
    expect(hint).toContain('JavaScript')
    expect(hint).toContain('once the fetch finishes')
  })

  it('leaves the list out of the snippet until it is ticked', () => {
    render(SIMPLE)
    const before = container.querySelector('pre')?.textContent ?? ''
    expect(before).not.toContain('The PRISMA 2020 statement')
    expect(before).toContain('publist-embed')

    render(SIMPLE, '', true)
    const after = container.querySelector('pre')?.textContent ?? ''
    expect(after).toContain('The PRISMA 2020 statement')
    expect(after.length).toBeGreaterThan(before.length)
  })

  it('keeps exactly one credit line whether or not it is ticked', () => {
    for (const snapshot of [false, true]) {
      render(SIMPLE, '', snapshot)
      const snippet = container.querySelector('pre')?.textContent ?? ''
      expect(snippet.split('publist-credit').length - 1).toBe(1)
      expect(snippet.split('publist-disclaimer').length - 1).toBe(1)
    }
  })
})
