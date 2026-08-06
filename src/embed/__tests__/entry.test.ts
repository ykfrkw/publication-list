// @vitest-environment jsdom

/**
 * `src/embed/entry.ts` in a real DOM.
 *
 * The load-bearing assertion in this file is the credit-link invariant: the
 * `.publist-credit` node the site owner pasted must survive a re-render **by
 * identity**. `toBe` rather than `toEqual` throughout — an equal-looking
 * replacement node would mean the script destroyed and recreated the link,
 * which is precisely the distributed-widget link pattern this project is built
 * to avoid.
 *
 * The `.publist-disclaimer` node gets the same treatment for a plainer reason:
 * it too lives in the pasted snippet, and a script of ours restoring a line the
 * site owner deleted would be overruling them on their own page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeConfig } from '../../core/config'
import {
  CREDIT_HTML,
  CREDIT_SELECTOR,
  DISCLAIMER_HTML,
  DISCLAIMER_SELECTOR,
} from '../../core/render'
import type { ListModel, Publication } from '../../core/types'

const mocks = vi.hoisted(() => ({
  buildList: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}))

vi.mock('../../core/pipeline', () => ({ buildList: mocks.buildList }))
vi.mock('../../core/cache', () => ({
  readCache: mocks.readCache,
  writeCache: mocks.writeCache,
}))

// Imported after the mocks are registered; importing runs the module's own
// `init()` against an empty document, which is a no-op.
const { init } = await import('../entry')

const ORCID = '0000-0003-1317-0220'

function publication(key: string, title: string): Publication {
  return {
    key,
    title,
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'BMJ',
    year: 2024,
    sources: ['orcid'],
    seedIds: [ORCID],
    trust: 'confirmed',
    category: 'original',
  }
}

function model(title: string): ListModel {
  return {
    config: normalizeConfig({ seeds: { orcid: [ORCID] } }),
    members: [],
    publications: [publication('doi:10.1136/bmj.n71', title)],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

const SNAPSHOT_LIST =
  '<ol class="publist-list"><li>Snapshot citation, 2019.</li></ol>'

/** The wizard's snippet: snapshot list, then the two static trailer lines. */
function mountFlat(): HTMLElement {
  document.body.innerHTML =
    `<div class="publist-embed" data-orcid="${ORCID}" data-style="vancouver">` +
    SNAPSHOT_LIST +
    DISCLAIMER_HTML +
    CREDIT_HTML +
    '</div>'
  return document.querySelector<HTMLElement>('.publist-embed')!
}

/** The real shape: both trailer lines nested inside the rendered `<section>`. */
function mountNested(): HTMLElement {
  document.body.innerHTML =
    `<div class="publist-embed" data-orcid="${ORCID}">` +
    `<section class="publist">${SNAPSHOT_LIST}${DISCLAIMER_HTML}${CREDIT_HTML}</section>` +
    '</div>'
  return document.querySelector<HTMLElement>('.publist-embed')!
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.buildList.mockReset()
  mocks.readCache.mockReset().mockReturnValue(null)
  mocks.writeCache.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  document.body.innerHTML = ''
})

describe('the credit link is never touched', () => {
  it('keeps the same credit node across a re-render', async () => {
    const el = mountFlat()
    const credit = el.querySelector(CREDIT_SELECTOR)!
    const anchor = credit.querySelector('a')!
    const href = anchor.getAttribute('href')

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(credit.querySelector('a')).toBe(anchor)
    expect(anchor.getAttribute('href')).toBe(href)
    expect(anchor.hasAttribute('rel')).toBe(false)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    // The list really was replaced.
    expect(el.textContent).toContain('Fresh citation')
    expect(el.textContent).not.toContain('Snapshot citation')
  })

  it('keeps the same credit node when it sits inside the rendered section', async () => {
    const el = mountNested()
    const credit = el.querySelector(CREDIT_SELECTOR)!

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
    expect(el.textContent).not.toContain('Snapshot citation')
  })

  it('injects markup that contains no credit at all', async () => {
    // No credit in the snippet — the site owner deleted it, or never had one.
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">${SNAPSHOT_LIST}</div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBeNull()
    expect(el.innerHTML).not.toContain('publist-credit')
    expect(el.innerHTML).not.toContain('yukifurukawa.jp')
    expect(el.textContent).toContain('Fresh citation')
  })

  it('does not restore a credit the owner deleted, even across two renders', async () => {
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">${SNAPSHOT_LIST}</div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!

    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBeNull()
  })

  it('keeps the credit node across the cached render and the live render', async () => {
    const el = mountFlat()
    const credit = el.querySelector(CREDIT_SELECTOR)!

    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
  })
})

describe('the source disclaimer is never touched either', () => {
  it('keeps the same disclaimer node across a re-render', async () => {
    const el = mountFlat()
    const note = el.querySelector(DISCLAIMER_SELECTOR)!
    const text = note.textContent

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBe(note)
    expect(note.textContent).toBe(text)
    expect(el.querySelectorAll(DISCLAIMER_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
  })

  it('keeps both trailer nodes when they sit inside the rendered section', async () => {
    const el = mountNested()
    const note = el.querySelector(DISCLAIMER_SELECTOR)!
    const credit = el.querySelector(CREDIT_SELECTOR)!

    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    // By identity, across both the cached render and the live one.
    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBe(note)
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelectorAll(DISCLAIMER_SELECTOR).length).toBe(1)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
    expect(el.textContent).not.toContain('Snapshot citation')
  })

  it('injects markup that contains no disclaimer, even with data-disclaimer="show"', async () => {
    // The config says show, and the runtime path still must not create one:
    // this script may not add nodes to someone else's markup.
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}" data-disclaimer="show">` +
      `${SNAPSHOT_LIST}</div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBeNull()
    expect(el.innerHTML).not.toContain('publist-disclaimer')
    expect(el.textContent).toContain('Fresh citation')
  })

  it('does not restore a disclaimer the owner deleted, even across two renders', async () => {
    // Credit kept, disclaimer removed by hand — neither is put back or taken.
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">` +
      `<section class="publist">${SNAPSHOT_LIST}${CREDIT_HTML}</section></div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!
    const credit = el.querySelector(CREDIT_SELECTOR)!

    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBeNull()
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
  })

  it('keeps a disclaimer the owner kept after deleting the credit', async () => {
    // The mirror case: the two are independent in both directions.
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">` +
      `<section class="publist">${SNAPSHOT_LIST}${DISCLAIMER_HTML}</section></div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!
    const note = el.querySelector(DISCLAIMER_SELECTOR)!

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBe(note)
    expect(el.querySelector(CREDIT_SELECTOR)).toBeNull()
    expect(el.textContent).toContain('Fresh citation')
    expect(el.textContent).not.toContain('Snapshot citation')
  })

  it('treats a container holding only trailer lines as empty', async () => {
    // Nothing for the visitor to read, so this is the case that earns a real
    // spinner rather than the quiet "Updating…" line.
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">` +
      `${DISCLAIMER_HTML}${CREDIT_HTML}</div>`
    const el = document.querySelector<HTMLElement>('.publist-embed')!
    let spinnerSeen = false
    mocks.buildList.mockImplementation(async () => {
      spinnerSeen = el.querySelector('.publist-spinner') != null
      return model('Fresh citation')
    })

    await init()

    expect(spinnerSeen).toBe(true)
    expect(el.querySelector(DISCLAIMER_SELECTOR)).not.toBeNull()
    expect(el.querySelector(CREDIT_SELECTOR)).not.toBeNull()
  })
})

describe('failure leaves the snapshot alone', () => {
  it('does not blank the list when buildList rejects', async () => {
    const el = mountFlat()
    const before = el.innerHTML
    const credit = el.querySelector(CREDIT_SELECTOR)!

    mocks.buildList.mockRejectedValue(new Error('network is down'))
    await init()

    expect(el.innerHTML).toBe(before)
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.getAttribute('data-publist-state')).toBe('error')
    expect(warn).toHaveBeenCalled()
  })

  it('does not write to the cache when the build failed', async () => {
    mountFlat()
    mocks.buildList.mockRejectedValue(new Error('network is down'))
    await init()
    expect(mocks.writeCache).not.toHaveBeenCalled()
  })
})

describe('config resolution and state', () => {
  it('passes the parsed inline config through to buildList', async () => {
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}" data-style="apa" ` +
      `data-limit="5" data-review-policy="auto">${SNAPSHOT_LIST}</div>`

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    const config = mocks.buildList.mock.calls[0][0] as ListModel['config']
    expect(config.seeds.orcid).toEqual([ORCID])
    expect(config.style).toBe('apa')
    expect(config.limit).toBe(5)
    expect(config.reviewPolicy).toBe('auto')
  })

  it('lets inline attributes win over a remote data-config', async () => {
    const remote = {
      v: 1,
      seeds: { orcid: ['0000-0000-0000-0000'] },
      style: 'nature',
      limit: 99,
    }
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(remote), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    document.body.innerHTML =
      `<div class="publist-embed" data-config="https://example.test/pubs.json" ` +
      `data-style="apa">${SNAPSHOT_LIST}</div>`

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    const config = mocks.buildList.mock.calls[0][0] as ListModel['config']
    expect(config.style).toBe('apa')
    expect(config.limit).toBe(99)
    expect(config.seeds.orcid).toEqual(['0000-0000-0000-0000'])

    fetchStub.mockRestore()
  })

  it('walks the state attribute from loading to ready', async () => {
    const el = mountFlat()
    const seen: (string | null)[] = []
    mocks.buildList.mockImplementation(async () => {
      seen.push(el.getAttribute('data-publist-state'))
      return model('Fresh citation')
    })

    await init()

    expect(seen).toEqual(['loading'])
    expect(el.getAttribute('data-publist-state')).toBe('ready')
  })

  it('marks a cache hit before revalidating', async () => {
    const el = mountFlat()
    const seen: (string | null)[] = []
    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockImplementation(async () => {
      seen.push(el.getAttribute('data-publist-state'))
      return model('Fresh citation')
    })

    await init()

    expect(seen).toEqual(['cached'])
    expect(el.getAttribute('data-publist-state')).toBe('ready')
  })

  it('caches the built model under the config hash', async () => {
    mountFlat()
    const built = model('Fresh citation')
    mocks.buildList.mockResolvedValue(built)

    await init()

    expect(mocks.writeCache).toHaveBeenCalledTimes(1)
    expect(mocks.writeCache.mock.calls[0][1]).toBe(built)
  })

  it('hydrates every container on the page, once each', async () => {
    document.body.innerHTML =
      `<div class="publist-embed" data-orcid="${ORCID}">${SNAPSHOT_LIST}</div>` +
      `<div class="publist-embed" data-researchmap="ykanekopsy">${SNAPSHOT_LIST}</div>`

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()
    await init()

    expect(mocks.buildList).toHaveBeenCalledTimes(2)
  })
})
