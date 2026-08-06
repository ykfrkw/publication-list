/**
 * @vitest-environment jsdom
 *
 * Component test for the per-member tenure rows.
 *
 * The regression that motivated this file is the first test in it: the whole
 * block used to render `null` until `draft.members` had a member in it, so on
 * an untouched form there was no sign that Joined / Left dates or Freeze
 * existed — and the reason anyone opens the lab tab is that a member joined or
 * left. Every other test here is about the block once it has rows.
 *
 * Nothing in this file touches the network: the `ListModel` is a fixture, and
 * `buildList` is never called.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListModel, Publication } from '@/core/types'
import { MemberRows } from '../MemberRows'
import { emptyDraft, type WizardDraft } from '../../lib/wizard'

declare global {
  // React's `act` looks for this flag before it will batch test updates.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ORCID = '0000-0002-1825-0097'

function publication(over: Partial<Publication> & { key: string }): Publication {
  return {
    title: 'Digital CBT for insomnia',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'J Test',
    year: 2024,
    sources: ['orcid'],
    seedIds: [ORCID],
    trust: 'confirmed',
    ...over,
  }
}

function model(pubs: Publication[] = [publication({ key: 'pmid:111', pmid: '111' })]): ListModel {
  return {
    config: { v: 1, seeds: { orcid: [ORCID] } },
    members: [{ id: ORCID, orcid: ORCID }],
    publications: pubs,
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-06T00:00:00.000Z',
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

function render(
  props: {
    members?: string
    model?: ListModel | null
    draft?: Partial<WizardDraft>
  } = {},
) {
  const update = vi.fn<(patch: Partial<WizardDraft>) => void>()
  const draft: WizardDraft = {
    ...emptyDraft('lab'),
    members: props.members ?? '',
    ...props.draft,
  }
  act(() => {
    root.render(
      <MemberRows draft={draft} update={update} model={props.model ?? null} />,
    )
  })
  return { update, draft }
}

function text(): string {
  return container.textContent ?? ''
}

function input(label: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )
  if (!el) throw new Error(`no input labelled "${label}"`)
  return el
}

function freezeButton(): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Freeze'),
  )
  if (!match) throw new Error('no Freeze button')
  return match
}

/** Type into a React-controlled input the way a browser does. */
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('before anything is typed', () => {
  it('still says what the block does, with no members at all', () => {
    render({ members: '' })
    // The capability, named — this is what an untouched form has to show.
    expect(text()).toContain('Joined')
    expect(text()).toContain('Left')
    expect(text()).toContain('Freeze')
    expect(text()).toMatch(/leaves/i)
  })

  it('renders no example rows to mistake for real ones', () => {
    render({ members: '' })
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('says the same thing when the box holds only a comment', () => {
    render({ members: '# nobody yet' })
    expect(text()).toContain('Freeze')
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
})

describe('a row per member', () => {
  it('gives one pasted ORCID iD a Joined and a Left field', () => {
    render({ members: ORCID })
    expect(input(`Joined — ${ORCID}`).value).toBe('')
    expect(input(`Left — ${ORCID}`).value).toBe('')
    expect(text()).toContain(ORCID)
  })

  it('shows the dates a line already carries', () => {
    render({ members: `${ORCID}\t2019-04..2023-03` })
    expect(input(`Joined — ${ORCID}`).value).toBe('2019-04')
    expect(input(`Left — ${ORCID}`).value).toBe('2023-03')
  })

  it('names the member when the line has a name on it', () => {
    render({ members: `Yuki Furukawa\t${ORCID}` })
    expect(input('Joined — Yuki Furukawa')).toBeTruthy()
  })
})

describe('Freeze needs a built list', () => {
  it('is disabled until one exists', () => {
    render({ members: ORCID, model: null })
    const button = freezeButton()
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('Generate the list first')
  })

  it('is enabled once a model is passed', () => {
    render({ members: ORCID, model: model() })
    expect(freezeButton().disabled).toBe(false)
  })

  it('states what confirming would do, without doing it', () => {
    const { update } = render({ members: ORCID, model: model() })
    act(() => {
      freezeButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(text()).toContain('Pins the 1 paper')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('typing a date edits the textarea', () => {
  it('rewrites that member’s line and leaves the others untouched', () => {
    const { update } = render({
      members: `0000-0003-1317-0220\n${ORCID}\nfurukawayuki`,
    })
    type(input(`Joined — ${ORCID}`), '2019-04')

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      members: `0000-0003-1317-0220\n${ORCID}\t2019-04..\nfurukawayuki`,
    })
  })

  it('replaces an existing window rather than adding a second one', () => {
    const { update } = render({ members: `${ORCID}\t2019-04..2023-03` })
    type(input(`Left — ${ORCID}`), '2024-03')
    expect(update).toHaveBeenCalledWith({
      members: `${ORCID}\t2019-04..2024-03`,
    })
  })

  it('clears the token when both dates are emptied', () => {
    const { update } = render({ members: `${ORCID}\t2019-04..` })
    type(input(`Joined — ${ORCID}`), '')
    expect(update).toHaveBeenCalledWith({ members: ORCID })
  })
})

/**
 * The two spellings of a window. `id@from:to` is the one a user *reads*, out of
 * the `data-orcid` attribute in their own snippet; typing it back in used to be
 * silently ignored and the `@…` tail became a bogus permalink.
 */
describe('the @ spelling from the snippet', () => {
  it('is read as a window, not as part of the identifier', () => {
    render({ members: `${ORCID}@2019-04:2023-03` })
    expect(input(`Joined — ${ORCID}`).value).toBe('2019-04')
    expect(input(`Left — ${ORCID}`).value).toBe('2023-03')
    // The identifier survives intact — the row is the member's, not a stranger's.
    expect(text()).toContain(ORCID)
  })

  it('is normalised to the canonical form only when the dates are edited', () => {
    const { update } = render({ members: `${ORCID}@2019-04:2023-03` })
    type(input(`Left — ${ORCID}`), '2024-03')
    expect(update).toHaveBeenCalledWith({
      members: `${ORCID}\t2019-04..2024-03`,
    })
  })

  it('does not swallow an email address out of a pasted column', () => {
    render({ members: `Yuki Furukawa\tsomeone@example.com\t${ORCID}` })
    expect(input('Joined — Yuki Furukawa').value).toBe('')
    expect(input('Left — Yuki Furukawa').value).toBe('')
    expect(text()).toContain(ORCID)
  })
})
