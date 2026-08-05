// @vitest-environment jsdom

/**
 * `src/widget/main.ts` — the iframe route — in a real DOM.
 *
 * The assertions that matter here are about the credit line. The project's
 * promise is that turning the credit off restricts nothing, so the wizard's
 * checkbox has to reach this route too; it does that by writing `credit=0`
 * into the frame's URL. The default direction is the other load-bearing half:
 * a URL that says nothing about the credit keeps it, so no existing embed
 * loses its attribution and no typo silently drops it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeConfig } from '../../core/config'
import { CREDIT_SELECTOR } from '../../core/render'
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
// `init()` against a document with no widget container, which is a no-op.
const { init, parseCreditParam } = await import('../main')

const ORCID = '0000-0003-1317-0220'

function publication(title: string): Publication {
  return {
    key: 'doi:10.1136/bmj.n71',
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
    publications: [publication(title)],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

/** Put the widget container on the page and point the URL at `search`. */
function mount(search: string): HTMLElement {
  window.history.replaceState({}, '', `/widget.html${search}`)
  document.body.innerHTML =
    '<div id="publist-widget" data-publist-state="loading">' +
    '<p class="widget-status">Loading publications…</p>' +
    '</div>'
  return document.getElementById('publist-widget')!
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
  window.history.replaceState({}, '', '/')
})

describe('parseCreditParam', () => {
  const credit = (search: string) =>
    parseCreditParam(new URLSearchParams(search))

  it('is on when the parameter is absent', () => {
    expect(credit(`?orcid=${ORCID}`)).toBe(true)
  })

  it('is off for the values the wizard and a person would write', () => {
    for (const value of ['0', 'false', 'off', 'no', 'FALSE', ' 0 ']) {
      expect(credit(`?credit=${encodeURIComponent(value)}`)).toBe(false)
    }
  })

  it('stays on for anything that does not mean off', () => {
    for (const value of ['', '1', 'true', 'yes', 'maybe']) {
      expect(credit(`?credit=${encodeURIComponent(value)}`)).toBe(true)
    }
  })
})

describe('the credit line in the frame', () => {
  it('renders exactly one credit block by default', async () => {
    const el = mount(`?orcid=${ORCID}`)
    mocks.buildList.mockResolvedValue(model('Fresh citation'))

    await init()

    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
    expect(el.textContent).toContain('Fresh citation')
    expect(el.getAttribute('data-publist-state')).toBe('ready')
  })

  it('renders none at all when the URL says credit=0', async () => {
    const el = mount(`?orcid=${ORCID}&credit=0`)
    mocks.buildList.mockResolvedValue(model('Fresh citation'))

    await init()

    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(0)
    expect(el.innerHTML).not.toContain('publist-credit')
    expect(el.innerHTML).not.toContain('yukifurukawa.jp')
    // Turning it off restricts nothing: the list itself is unchanged.
    expect(el.textContent).toContain('Fresh citation')
    expect(el.getAttribute('data-publist-state')).toBe('ready')
  })

  it('honours credit=0 for the cached render as well as the live one', async () => {
    const el = mount(`?orcid=${ORCID}&credit=false`)
    const seen: number[] = []
    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockImplementation(async () => {
      seen.push(el.querySelectorAll(CREDIT_SELECTOR).length)
      return model('Fresh citation')
    })

    await init()

    // The cached render is on screen while buildList runs; it must not flash a
    // credit line that the live render then removes.
    expect(seen).toEqual([0])
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(0)
  })

  it('keeps the credit on the cached render when nothing asked for it off', async () => {
    const el = mount(`?orcid=${ORCID}`)
    const seen: number[] = []
    mocks.readCache.mockReturnValue(model('Cached citation'))
    mocks.buildList.mockImplementation(async () => {
      seen.push(el.querySelectorAll(CREDIT_SELECTOR).length)
      return model('Fresh citation')
    })

    await init()

    expect(seen).toEqual([1])
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
  })
})
