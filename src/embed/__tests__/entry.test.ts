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

/**
 * The shape `buildEmbedSnippet` emits: the rendered `<section>` for the
 * snapshot, and both trailer lines as siblings *outside* it.
 *
 * That split is what lets the wizard offer a snippet with no snapshot at all
 * without the credit going with it — see the note on `buildEmbedSnippet`. This
 * script has to leave both lines alone in this arrangement exactly as it does
 * in the other two.
 */
function mountSnippetShape(): HTMLElement {
  document.body.innerHTML =
    `<div class="publist-embed" data-orcid="${ORCID}" data-style="vancouver">` +
    `<section class="publist">${SNAPSHOT_LIST}</section>` +
    DISCLAIMER_HTML +
    CREDIT_HTML +
    '</div>'
  return document.querySelector<HTMLElement>('.publist-embed')!
}

/** The same snippet with the snapshot left out: trailer lines and nothing else. */
function mountSnapshotless(): HTMLElement {
  document.body.innerHTML =
    `<div class="publist-embed" data-orcid="${ORCID}" data-style="vancouver">` +
    DISCLAIMER_HTML +
    CREDIT_HTML +
    '</div>'
  return document.querySelector<HTMLElement>('.publist-embed')!
}

/** The older shape: both trailer lines nested inside the rendered `<section>`. */
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

  it('keeps both nodes when they sit outside the section, as the snippet emits them', async () => {
    const el = mountSnippetShape()
    const credit = el.querySelector(CREDIT_SELECTOR)!
    const anchor = credit.querySelector('a')!
    const note = el.querySelector(DISCLAIMER_SELECTOR)!

    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    // By identity, across the cached render and the live one.
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(credit.querySelector('a')).toBe(anchor)
    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBe(note)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.querySelectorAll(DISCLAIMER_SELECTOR).length).toBe(1)
    // The stale section went, and the new list landed above the trailer lines.
    expect(el.textContent).toContain('Fresh citation')
    expect(el.textContent).not.toContain('Snapshot citation')
    const children = Array.from(el.children)
    expect(children.indexOf(note)).toBeGreaterThan(0)
    expect(children.indexOf(credit)).toBe(children.length - 1)
  })

  it('fills a snapshotless snippet without creating or losing a trailer line', async () => {
    // The wizard's default snippet: no list in the markup at all, both trailer
    // lines present. The list has to arrive; the two lines must be the same
    // nodes afterwards, and there must still be exactly one of each.
    const el = mountSnapshotless()
    const credit = el.querySelector(CREDIT_SELECTOR)!
    const note = el.querySelector(DISCLAIMER_SELECTOR)!

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelector(DISCLAIMER_SELECTOR)).toBe(note)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.querySelectorAll(DISCLAIMER_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
    expect(el.querySelector('.publist-list')).not.toBeNull()
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

  /**
   * `data-config` used to name any URL for this script to fetch. It is gone,
   * and a snippet that still carries one must be inert: no request, and the
   * inline attributes used as the whole configuration.
   */
  it('fetches nothing for a data-config attribute and uses the inline settings', async () => {
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ v: 1, style: 'nature', limit: 99 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    document.body.innerHTML =
      `<div class="publist-embed" data-config="https://evil.test/pubs.json" ` +
      `data-orcid="${ORCID}" data-style="apa">${SNAPSHOT_LIST}</div>`

    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(fetchStub).not.toHaveBeenCalled()
    const config = mocks.buildList.mock.calls[0][0] as ListModel['config']
    expect(config.style).toBe('apa')
    expect(config.seeds.orcid).toEqual([ORCID])
    expect(config.limit).toBeUndefined()

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

/**
 * The one route that still fetches: `data-list`.
 *
 * It resolves an id against the URL this script was served from, so the id can
 * only ever name a file in this repository's own `lists/` registry. That base
 * is read from `document.currentScript` at module scope, which is why this
 * suite re-imports the module with a `<script src=…embed.js>` in the document
 * rather than reusing the `init` above — with no script tag there is no base,
 * and `loadConfig` skips the fetch entirely. Any future test of this route
 * needs `initWithScriptBase()` for the same reason.
 *
 * Two assertions here are the load-bearing ones. Inline attributes win over the
 * fetched file — carried over from the deleted `data-config` test, which is the
 * half of it that still applies. And an id that is not a bare filename reaches
 * no `fetch` at all: `new URL()` walks `..` like any path, so an unchecked
 * `data-list="../../secrets"` addressed `<site>/secrets.json`. This script was
 * the one of the three consumers that had no such check.
 */
describe('the data-list registry route', () => {
  const SCRIPT = 'https://ykfrkw.github.io/publication-list/embed.js'

  /** `entry.ts` re-evaluated with a script tag present, so it has a base URL. */
  async function initWithScriptBase(): Promise<() => Promise<void>> {
    document.body.innerHTML = ''
    document.head.innerHTML = `<script src="${SCRIPT}"></script>`
    vi.resetModules()
    // Importing runs the module's own `init()` against an empty body: a no-op.
    const mod = await import('../entry')
    return mod.init
  }

  afterEach(() => {
    document.head.innerHTML = ''
  })

  it('resolves the id against the script URL, inside lists/', async () => {
    const initScoped = await initWithScriptBase()
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ v: 1, seeds: { orcid: [ORCID] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    document.body.innerHTML =
      `<div class="publist-embed" data-list="sleepi">${SNAPSHOT_LIST}</div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await initScoped()

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub.mock.calls[0][0]).toBe(
      'https://ykfrkw.github.io/publication-list/lists/sleepi.json',
    )

    fetchStub.mockRestore()
  })

  it('lets inline attributes win over the file it fetched', async () => {
    const initScoped = await initWithScriptBase()
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          v: 1,
          seeds: { orcid: ['0000-0000-0000-0000'] },
          style: 'nature',
          limit: 99,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    document.body.innerHTML =
      `<div class="publist-embed" data-list="sleepi" data-style="apa">` +
      `${SNAPSHOT_LIST}</div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await initScoped()

    const config = mocks.buildList.mock.calls[0][0] as ListModel['config']
    // Inline wins where the two disagree…
    expect(config.style).toBe('apa')
    // …and the file supplies everything the attributes are silent about.
    expect(config.limit).toBe(99)
    expect(config.seeds.orcid).toEqual(['0000-0000-0000-0000'])

    fetchStub.mockRestore()
  })

  /**
   * The traversal guard, asserted where it matters: on the fetch stub.
   *
   * Not on the rendered outcome — a request that goes out and then fails still
   * went out. `expect(fetchStub).not.toHaveBeenCalled()` is the whole claim.
   */
  it.each([
    ['../../../secrets', 'climbs out of the registry directory'],
    ['../secrets', 'climbs one level'],
    ['sub/dir/list', 'names a path rather than a filename'],
    ['.hidden', 'starts with a dot, so it could begin a climb'],
    ['%2e%2e%2fsecrets', 'tries the escape the attribute reader does not decode'],
    // Reaches the same outcome by a different route: `attr()` in `config.ts`
    // trims and drops an empty value, so this never becomes an id at all.
    ['   ', 'is blank, and so is read as no id rather than a bad one'],
  ])('fetches nothing for data-list="%s", which %s', async (id) => {
    const initScoped = await initWithScriptBase()
    const fetchStub = vi.spyOn(globalThis, 'fetch')

    document.body.innerHTML =
      `<div class="publist-embed" data-list="${id}" data-orcid="${ORCID}">` +
      `${SNAPSHOT_LIST}</div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await initScoped()

    expect(fetchStub).not.toHaveBeenCalled()
    fetchStub.mockRestore()
  })

  it('leaves the snapshot up and warns when the id is refused', async () => {
    // A snippet naming an unusable id is a broken snippet, so it is not
    // quietly rendered from its inline attributes instead — but the visitor
    // still keeps the list that was pasted into the page.
    const initScoped = await initWithScriptBase()
    const fetchStub = vi.spyOn(globalThis, 'fetch')

    document.body.innerHTML =
      `<div class="publist-embed" data-list="../../secrets" data-orcid="${ORCID}">` +
      `${SNAPSHOT_LIST}</div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await initScoped()

    const el = document.querySelector<HTMLElement>('.publist-embed')!
    expect(fetchStub).not.toHaveBeenCalled()
    expect(mocks.buildList).not.toHaveBeenCalled()
    expect(el.textContent).toContain('Snapshot citation')
    expect(el.getAttribute('data-publist-state')).toBe('error')
    expect(warn).toHaveBeenCalled()

    fetchStub.mockRestore()
  })

  it('still accepts the ids the registry actually uses', async () => {
    // The guard has to be narrow enough to be safe and wide enough to be
    // useless-free: both files in `lists/` today, plus the shapes the pattern
    // deliberately allows.
    for (const id of ['furukawa', 'sleepi', 'my-lab_2026', 'v1.list']) {
      const initScoped = await initWithScriptBase()
      const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ v: 1, seeds: { orcid: [ORCID] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      document.body.innerHTML =
        `<div class="publist-embed" data-list="${id}">${SNAPSHOT_LIST}</div>`
      mocks.buildList.mockResolvedValue(model('Fresh citation'))
      await initScoped()

      expect(fetchStub.mock.calls[0][0]).toBe(
        `https://ykfrkw.github.io/publication-list/lists/${id}.json`,
      )
      fetchStub.mockRestore()
    }
  })

  /**
   * A network failure must never blank out a lab's list.
   *
   * The snapshot in the container is the fallback for everything, and a
   * `data-list` that 404s is the likeliest way to reach it — an id that was
   * removed from the registry, on a page nobody re-pasted.
   */
  it('leaves the snapshot in place when the registry file is missing', async () => {
    const initScoped = await initWithScriptBase()
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 404 }))

    document.body.innerHTML =
      `<div class="publist-embed" data-list="gone">${SNAPSHOT_LIST}</div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await initScoped()

    const el = document.querySelector<HTMLElement>('.publist-embed')!
    expect(mocks.buildList).not.toHaveBeenCalled()
    expect(el.textContent).toContain('Snapshot citation')
    expect(el.getAttribute('data-publist-state')).toBe('error')

    fetchStub.mockRestore()
  })
})

/**
 * `headingLevel: 'auto'` — the one setting that can only be answered here.
 *
 * The script runs inside the page the list was pasted into, so it is the only
 * renderer that can see the outline the list has to fit. Every assertion below
 * is about the *rendered* markup rather than about the detection function,
 * because what matters is the level the visitor's browser ends up with.
 */
describe('the automatic heading level', () => {
  /** Mount a container after the given markup and hydrate it. */
  async function renderAfter(
    before: string,
    attrs = '',
    after = '',
  ): Promise<HTMLElement> {
    document.body.innerHTML =
      before +
      `<div class="publist-embed" data-orcid="${ORCID}"${attrs}>${SNAPSHOT_LIST}</div>` +
      after
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()
    return document.querySelector<HTMLElement>('.publist-embed')!
  }

  it('renders one level below the nearest heading above it', async () => {
    const el = await renderAfter('<h2>Publications</h2>')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
    expect(el.querySelector('.publist-subheading')?.tagName).toBe('H4')
  })

  it('follows a deeper heading just as readily', async () => {
    const el = await renderAfter('<h1>Lab</h1><h2>About</h2><h4>Selected work</h4>')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H5')
    expect(el.querySelector('.publist-subheading')?.tagName).toBe('H6')
  })

  it('takes the nearest one, not the first or the deepest', async () => {
    const el = await renderAfter('<h1>Lab</h1><h4>Team</h4><h2>Publications</h2>')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
  })

  it('ignores headings that come after the container', async () => {
    const el = await renderAfter('<h2>Publications</h2>', '', '<h5>Contact</h5>')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
  })

  it('ignores the headings inside its own snapshot', async () => {
    // Otherwise each render would measure against the previous one and the
    // list would walk down the outline one level per page load.
    document.body.innerHTML =
      '<h2>Publications</h2>' +
      `<div class="publist-embed" data-orcid="${ORCID}">` +
      '<section class="publist"><h3 class="publist-heading">Original Articles</h3>' +
      SNAPSHOT_LIST +
      '</section></div>'
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()
    const el = document.querySelector<HTMLElement>('.publist-embed')!
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
  })

  it('falls back to h3 when nothing precedes it', async () => {
    const el = await renderAfter('')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
    expect(el.querySelector('.publist-subheading')?.tagName).toBe('H4')
  })

  it('clamps at both ends: h1 gives h2, h5 and h6 both give h5', async () => {
    const top = await renderAfter('<h1>Lab</h1>')
    expect(top.querySelector('.publist-heading')?.tagName).toBe('H2')

    const deep = await renderAfter('<h5>Selected work</h5>')
    expect(deep.querySelector('.publist-heading')?.tagName).toBe('H5')
    expect(deep.querySelector('.publist-subheading')?.tagName).toBe('H6')

    const deeper = await renderAfter('<h6>Selected work</h6>')
    expect(deeper.querySelector('.publist-heading')?.tagName).toBe('H5')
  })

  it('does not measure when the snippet names a level', async () => {
    const el = await renderAfter('<h4>Selected work</h4>', ' data-heading-level="2"')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H2')
    expect(el.querySelector('.publist-subheading')?.tagName).toBe('H3')
  })

  it('measures each container separately on one page', async () => {
    // The reason the level is not a module-level constant beside the other
    // render options: two embeds on one page can sit under different headings.
    document.body.innerHTML =
      `<h2>Publications</h2><div class="publist-embed" id="a" data-orcid="${ORCID}"></div>` +
      `<h4>Preprints</h4><div class="publist-embed" id="b" data-orcid="${ORCID}"></div>`
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()

    expect(
      document.querySelector('#a .publist-heading')?.tagName,
    ).toBe('H3')
    expect(
      document.querySelector('#b .publist-heading')?.tagName,
    ).toBe('H5')
  })

  it('applies the measured level to the cached render too', async () => {
    mocks.readCache.mockReturnValue(model('Cached citation'))
    const el = await renderAfter('<h2>Publications</h2>')
    expect(el.querySelector('.publist-heading')?.tagName).toBe('H3')
  })
})
