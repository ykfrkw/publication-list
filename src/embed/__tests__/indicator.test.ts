// @vitest-environment jsdom

/**
 * The embed script's loading indicator.
 *
 * The rule this file exists to hold in place: a spinner appears **only** when
 * the container starts empty. When the pasted snippet carries a snapshot, the
 * visitor is already reading a complete list, and replacing it with a spinner
 * would take working content off the page and make a healthy site look broken.
 *
 * The credit assertions are here too, in their own right: whatever the
 * indicator does, it must not go near a `.publist-credit` node — checked by
 * identity, as in `entry.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeConfig } from '../../core/config'
import { CREDIT_HTML, CREDIT_SELECTOR } from '../../core/render'
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

const { init } = await import('../entry')

const ORCID = '0000-0003-1317-0220'

const SPINNER = '.publist-spinner'
const INDICATOR = '.publist-indicator'

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

const SNAPSHOT_LIST =
  '<ol class="publist-list"><li>Snapshot citation, 2019.</li></ol>'

function mount(inner: string): HTMLElement {
  document.body.innerHTML =
    `<div class="publist-embed" data-orcid="${ORCID}">${inner}</div>`
  return document.querySelector<HTMLElement>('.publist-embed')!
}

/**
 * Run `init()` and capture the container as it looked while the live fetch was
 * still in flight — which is the only moment any of this is on screen.
 */
async function observeDuringBuild(
  el: HTMLElement,
  look: () => void,
): Promise<void> {
  mocks.buildList.mockImplementation(async () => {
    look()
    return model('Fresh citation')
  })
  await init()
  void el
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

describe('a container that starts empty', () => {
  it('shows a spinner while the list is being fetched', async () => {
    const el = mount('')
    let spinners = -1
    let text = ''

    await observeDuringBuild(el, () => {
      spinners = el.querySelectorAll(SPINNER).length
      text = el.textContent ?? ''
    })

    expect(spinners).toBe(1)
    expect(text).toContain('Loading publications')
  })

  it('marks that indicator as the empty-container one, not the quiet one', async () => {
    const el = mount('')
    let className = ''

    await observeDuringBuild(el, () => {
      className = el.querySelector(INDICATOR)?.className ?? ''
    })

    expect(className).toContain('publist-indicator-empty')
    expect(className).not.toContain('publist-indicator-refresh')
  })

  it('counts a container holding nothing but a credit line as empty', async () => {
    const el = mount(CREDIT_HTML)
    const credit = el.querySelector(CREDIT_SELECTOR)!
    let spinners = -1

    await observeDuringBuild(el, () => {
      spinners = el.querySelectorAll(SPINNER).length
    })

    expect(spinners).toBe(1)
    // …and the credit itself was never touched on the way.
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
  })

  it('takes the indicator away once the list arrives', async () => {
    const el = mount('')
    mocks.buildList.mockResolvedValue(model('Fresh citation'))

    await init()

    expect(el.querySelector(INDICATOR)).toBeNull()
    expect(el.querySelector(SPINNER)).toBeNull()
    expect(el.textContent).toContain('Fresh citation')
    expect(el.getAttribute('data-publist-state')).toBe('ready')
  })
})

describe('a container that starts with a snapshot', () => {
  it('never spins, and keeps the snapshot on screen throughout', async () => {
    const el = mount(SNAPSHOT_LIST)
    let spinners = -1
    let text = ''

    await observeDuringBuild(el, () => {
      spinners = el.querySelectorAll(SPINNER).length
      text = el.textContent ?? ''
    })

    expect(spinners).toBe(0)
    expect(text).toContain('Snapshot citation')
  })

  it('says it is updating, quietly, and takes that away when it is done', async () => {
    const el = mount(SNAPSHOT_LIST)
    let className = ''
    let text = ''

    await observeDuringBuild(el, () => {
      className = el.querySelector(INDICATOR)?.className ?? ''
      text = el.querySelector(INDICATOR)?.textContent ?? ''
    })

    expect(className).toContain('publist-indicator-refresh')
    expect(text).toBe('Updating…')
    expect(el.querySelector(INDICATOR)).toBeNull()
  })

  it('does not spin when the snapshot sits in the rendered section with a credit', async () => {
    const el = mount(
      `<section class="publist">${SNAPSHOT_LIST}${CREDIT_HTML}</section>`,
    )
    const credit = el.querySelector(CREDIT_SELECTOR)!
    let spinners = -1
    let creditDuring: Element | null = null

    await observeDuringBuild(el, () => {
      spinners = el.querySelectorAll(SPINNER).length
      creditDuring = el.querySelector(CREDIT_SELECTOR)
    })

    expect(spinners).toBe(0)
    expect(creditDuring).toBe(credit)
    expect(el.querySelector(CREDIT_SELECTOR)).toBe(credit)
    expect(el.querySelectorAll(CREDIT_SELECTOR).length).toBe(1)
  })

  it('stops spinning as soon as a cached list lands in an empty container', async () => {
    const el = mount('')
    let spinners = -1
    let className = ''

    mocks.readCache.mockReturnValue(model('Cached citation'))
    await observeDuringBuild(el, () => {
      spinners = el.querySelectorAll(SPINNER).length
      className = el.querySelector(INDICATOR)?.className ?? ''
    })

    expect(spinners).toBe(0)
    expect(className).toContain('publist-indicator-refresh')
  })
})

describe('when the fetch fails', () => {
  it('leaves no indicator behind on a snapshot', async () => {
    const el = mount(SNAPSHOT_LIST)
    const before = el.innerHTML

    mocks.buildList.mockRejectedValue(new Error('network is down'))
    await init()

    expect(el.querySelector(INDICATOR)).toBeNull()
    expect(el.innerHTML).toBe(before)
    expect(el.getAttribute('data-publist-state')).toBe('error')
  })

  it('leaves no spinner spinning forever in an empty container', async () => {
    const el = mount('')

    mocks.buildList.mockRejectedValue(new Error('network is down'))
    await init()

    expect(el.querySelector(SPINNER)).toBeNull()
    expect(el.querySelector(INDICATOR)).toBeNull()
    expect(el.getAttribute('data-publist-state')).toBe('error')
  })
})

describe('the injected stylesheet', () => {
  it('is scoped so it cannot collide with the host page', async () => {
    const el = mount('')
    mocks.buildList.mockResolvedValue(model('Fresh citation'))
    await init()
    void el

    const style = document.getElementById('publist-embed-style')
    expect(style).not.toBeNull()
    const css = style?.textContent ?? ''

    // Every rule is qualified by the container class and every class it names
    // is `publist-` prefixed, keyframes included.
    for (const selector of css.split('{')[0].split(',')) {
      expect(selector.trim().startsWith('.publist-embed')).toBe(true)
    }
    expect(css).toContain('@keyframes publist-spin')
    expect(css.match(/\.(?!publist-)[a-z]/)).toBeNull()
    // Motion is opt-in, and the reduced-motion branch is a static mark.
    expect(css).toContain('prefers-reduced-motion:no-preference')
    expect(css).toContain('prefers-reduced-motion:reduce')
  })
})
