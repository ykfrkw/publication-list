/**
 * @vitest-environment jsdom
 *
 * Component test for the embed panel's disclosure rules and its one call to
 * action.
 *
 * Three things are asserted here rather than left to judgement, because all
 * three are about what a first-time visitor is confronted with:
 *
 *   - the script snippet is never collapsed, and its Copy button is the single
 *     solid control in the whole output area;
 *   - the iframe snippet starts **collapsed**, because it is the fallback for a
 *     CMS that strips `<script>`, not the route to recommend;
 *   - nothing here asks the visitor to host a file. The route that did — a
 *     `pubs.json` behind a `data-config` attribute — is gone, and the suite
 *     that covered it went with it.
 *
 * Nothing here touches the network: the model is a fixture.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '@/core/config'
import type { ListConfig, ListModel, Publication } from '@/core/types'
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

/** A PubMed query with a comma in it — the case that used to force a file. */
const COMMA_QUERY = normalizeConfig({
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

function render(config: ListConfig, snapshot = false) {
  act(() => {
    root.render(
      <SnippetPanel
        model={model(config)}
        credit
        disclaimer
        snapshot={snapshot}
        onCreditChange={() => {}}
        onDisclaimerChange={() => {}}
        onSnapshotChange={() => {}}
      />,
    )
  })
}

/**
 * The solid buttons on screen.
 *
 * `variant="default"` is the only one that paints a filled background, and it
 * does it with the `bg-primary` class — so counting that class counts the
 * controls the panel is *asking* to have clicked.
 */
function solidButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.classList.contains('bg-primary'),
  )
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

/**
 * The route that was removed, asserted as removed.
 *
 * Not a redundant test: the panel used to steer people here on two triggers —
 * a long attribute block and a comma in a value — and both fixtures below are
 * the ones that fired them. Neither may produce a file, a URL field or a
 * download now; the comma is carried by the escape in `core/config.ts` and the
 * length is simply not the panel's business.
 */
describe('the hosted pubs.json route', () => {
  const CONFIGS: [name: string, config: ListConfig][] = [
    ['a plain single-ORCID configuration', SIMPLE],
    ['a configuration with a very long attribute block', OVERSIZED],
    ['a configuration whose query contains a comma', COMMA_QUERY],
  ]

  for (const [name, config] of CONFIGS) {
    it(`is nowhere to be found for ${name}`, () => {
      render(config)

      expect(container.textContent).not.toContain('pubs.json')
      expect(container.textContent).not.toContain('data-config')
      expect(disclosure('Keep the settings in a file')).toBeUndefined()
      // No URL field, and no download that would produce a file to point at.
      expect(container.querySelector('input[type="url"]')).toBeNull()
      const buttons = Array.from(container.querySelectorAll('button')).map(
        (b) => b.textContent ?? '',
      )
      expect(buttons.join('|')).not.toContain('Download')
    })
  }

  it('complains about neither length nor commas, because neither is a problem', () => {
    render(OVERSIZED)
    expect(container.textContent).not.toContain('large for inline attributes')

    render(COMMA_QUERY)
    expect(container.textContent).not.toContain('cannot travel in an inline attribute')
  })

  it('carries the comma into the snippet, escaped, rather than routing around it', () => {
    render(COMMA_QUERY)
    const snippet = container.querySelector('pre')?.textContent ?? ''
    expect(snippet).toContain(
      'data-pubmed="Furukawa Y[au] AND (Tokyo%2C Japan[ad])"',
    )
  })
})

/**
 * One solid button, and it is `Copy snippet`.
 *
 * A solid button says "we are asking you to click this". Copying the embed
 * snippet is the one thing this tool asks for, so it is solid here and nothing
 * else in the output area is — see the matching count over `ResultsPanel` in
 * `EmptyList.test.tsx`.
 */
describe('the call to action', () => {
  it('is exactly one button, and it copies the script snippet', () => {
    render(SIMPLE)
    const solid = solidButtons()
    expect(solid).toHaveLength(1)
    expect(solid[0].textContent).toContain('Copy snippet')
  })

  it('stays at one however the panel is configured', () => {
    for (const config of [SIMPLE, OVERSIZED, COMMA_QUERY]) {
      for (const snapshot of [false, true]) {
        render(config, snapshot)
        expect(solidButtons()).toHaveLength(1)
      }
    }
  })

  it('leaves the iframe copy button quiet, inside its disclosure', () => {
    render(SIMPLE)
    const iframeCopy = Array.from(
      disclosure('iframe snippet')?.querySelectorAll('button') ?? [],
    )
    expect(iframeCopy.length).toBeGreaterThan(0)
    for (const button of iframeCopy) {
      expect(button.classList.contains('bg-primary')).toBe(false)
    }
  })

  it('says the snippet is the thing to keep, so there is nothing else to save', () => {
    render(SIMPLE)
    expect(container.textContent).toContain('it is the whole configuration')
    expect(container.textContent).toContain('Start from an existing snippet')
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
    // Nothing is demanded of the user, and there is no file to demand.
    expect(container.textContent).not.toContain('needs the file below')
    expect(container.textContent).not.toContain('pubs.json')
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

    render(SIMPLE, true)
    const after = container.querySelector('pre')?.textContent ?? ''
    expect(after).toContain('The PRISMA 2020 statement')
    expect(after.length).toBeGreaterThan(before.length)
  })

  it('keeps exactly one credit line whether or not it is ticked', () => {
    for (const snapshot of [false, true]) {
      render(SIMPLE, snapshot)
      const snippet = container.querySelector('pre')?.textContent ?? ''
      expect(snippet.split('publist-credit').length - 1).toBe(1)
      expect(snippet.split('publist-disclaimer').length - 1).toBe(1)
    }
  })
})
