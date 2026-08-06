/**
 * @vitest-environment jsdom
 *
 * Component test for the per-member rows — the editing surface of a lab list.
 *
 * Two regressions motivated this file, in order of how badly they hid the
 * feature. The block used to render `null` until `draft.members` already had a
 * member in it, so an untouched form showed no sign that Joined / Left dates or
 * Freeze existed; and it was a view over a free-text box that was the actual
 * entry point, so naming members one at a time — the thing anyone opens the lab
 * tab to do — meant typing into a textarea and hoping.
 *
 * The rows are the entry point now, which is why `keeps the cursor where it
 * is` matters as much as the write tests: every field here round-trips through
 * a string that is parsed by shape, and a surface that loses the focus or moves
 * a value between fields mid-word is not one anybody can type into.
 *
 * Nothing in this file touches the network: the `ListModel` is a fixture, and
 * `buildList` is never called.
 */

import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListModel, Publication } from '@/core/types'
import { MemberRows } from '../MemberRows'
import { LabModeForm } from '../ModeForms'
import { parseMemberLines } from '../../lib/parse'
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
      <MemberRows
        draft={draft}
        update={update}
        parsed={parseMemberLines(draft.members)}
        model={props.model ?? null}
      />,
    )
  })
  return { update, draft }
}

/**
 * The same block, wired to real state.
 *
 * `render` above asserts on the single patch a control emits, which is the
 * right shape for "what does this write". Anything that spans keystrokes —
 * whether the focus survives one, what the box holds after five — needs the
 * draft to actually change and the component to actually re-render, because
 * that re-render is the thing being tested.
 */
function renderLive(initial = '') {
  const state = { members: initial }

  function Harness() {
    const [draft, setDraft] = useState<WizardDraft>({
      ...emptyDraft('lab'),
      members: initial,
    })
    state.members = draft.members
    const parsed = useMemo(() => parseMemberLines(draft.members), [draft.members])
    return (
      <MemberRows
        draft={draft}
        update={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        parsed={parsed}
        model={null}
      />
    )
  }

  act(() => root.render(<Harness />))
  return state
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

  /**
   * This used to assert the opposite — no inputs at all, on the grounds that a
   * disabled example row teaches the wrong thing about the real ones. It was
   * right about example rows and wrong about the entry point: the block sat
   * under a textarea that was where members were actually added, so an empty
   * form's first move was still "type into free text". The row is real, it is
   * the first member's row, and typing in it creates them.
   */
  it('opens on one real, empty row to fill in', () => {
    render({ members: '' })
    expect(input('Name — member 1').value).toBe('')
    expect(input('ORCID iD — member 1').value).toBe('')
    expect(input('researchmap — member 1').value).toBe('')
    expect(input('Joined — member 1').value).toBe('')
    expect(input('Left — member 1').value).toBe('')
    expect(container.querySelectorAll('li')).toHaveLength(1)
  })

  it('offers no Freeze on a row with nobody in it', () => {
    render({ members: '', model: model() })
    // Freezing pins a member's papers and drops their seed; a row with no
    // identifier has neither, so the button would be inert.
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    )
    expect(buttons.some((label) => label.includes('Freeze'))).toBe(false)
    expect(buttons.some((label) => label.includes('Add member'))).toBe(true)
  })

  it('gives a frozen line no row of its own', () => {
    render({ members: '# frozen 2026-08-06\t0000-0002-1825-0097' })
    // One row: the blank one. The commented-out member is out of the seed list
    // and stays that way until the `#` is deleted by hand.
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(input('ORCID iD — member 1').value).toBe('')
  })
})

describe('a row per member', () => {
  it('gives one pasted ORCID iD a Joined and a Left field', () => {
    render({ members: ORCID })
    expect(input(`Joined — ${ORCID}`).value).toBe('')
    expect(input(`Left — ${ORCID}`).value).toBe('')
    // The iD is a field now rather than a caption, so it is read off the field.
    expect(input(`ORCID iD — ${ORCID}`).value).toBe(ORCID)
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
    expect(input(`ORCID iD — ${ORCID}`).value).toBe(ORCID)
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
    expect(input('ORCID iD — Yuki Furukawa').value).toBe(ORCID)
    // …and it lands in the permalink cell, which is where it has always gone.
    expect(input('researchmap — Yuki Furukawa').value).toBe('someone@example.com')
  })
})

describe('naming a member on their row', () => {
  it('writes the name without disturbing their window token', () => {
    const { update } = render({ members: `${ORCID}\t2019-04..2023-03+36` })
    type(input(`Name — ${ORCID}`), 'Yuki Furukawa')
    expect(update).toHaveBeenCalledWith({
      members: `Yuki Furukawa\t${ORCID}\t2019-04..2023-03+36`,
    })
  })

  it('leaves the other members’ lines byte-identical', () => {
    const { update } = render({
      members: `0000-0003-1317-0220\t2019-04..\n${ORCID}\nhttps://researchmap.jp/someone`,
    })
    type(input(`Name — ${ORCID}`), 'Yuki Furukawa')
    const lines = update.mock.calls[0][0].members!.split('\n')
    expect(lines[0]).toBe('0000-0003-1317-0220\t2019-04..')
    expect(lines[1]).toBe(`Yuki Furukawa\t${ORCID}`)
    expect(lines[2]).toBe('https://researchmap.jp/someone')
  })

  it('writes a researchmap permalink onto the same line as the iD', () => {
    const { update } = render({ members: `Yuki Furukawa\t${ORCID}` })
    type(input('researchmap — Yuki Furukawa'), 'furukawayuki')
    expect(update).toHaveBeenCalledWith({
      members: `Yuki Furukawa\t${ORCID}\tfurukawayuki`,
    })
  })
})

describe('adding and removing members', () => {
  it('adds exactly one line for a member typed into the empty row', () => {
    const state = renderLive('')
    type(input('ORCID iD — member 1'), ORCID)
    expect(state.members).toBe(ORCID)
    expect(state.members.split('\n')).toHaveLength(1)
  })

  it('adds a second member below the first, and no blank line between', () => {
    const state = renderLive('0000-0003-1317-0220')
    act(() => {
      const add = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Add member'),
      )!
      add.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    type(input('ORCID iD — member 2'), ORCID)
    expect(state.members).toBe(`0000-0003-1317-0220\n${ORCID}`)
  })

  it('removes one member and leaves the others byte-identical', () => {
    const state = renderLive(
      `Yuki Furukawa\t0000-0003-1317-0220\n${ORCID}\t2019-04..2023-03\nhttps://researchmap.jp/someone`,
    )
    act(() => {
      const remove = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Remove — ${ORCID}"]`,
      )!
      remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(state.members).toBe(
      'Yuki Furukawa\t0000-0003-1317-0220\nhttps://researchmap.jp/someone',
    )
  })
})

/**
 * The row key.
 *
 * It used to be derived from the row's own identifiers — `orcid|researchmap` —
 * which was stable enough while the only editable fields were two date boxes.
 * The moment the ORCID field itself is typed into, that key changes on every
 * keystroke, React remounts the `<li>`, and the focus goes with it: the user
 * types one character per click. The key is the line index now, which nothing
 * about a line's *contents* can change, and a row that has no line yet is keyed
 * by the line it is about to become, so creating it does not move it either.
 */
describe('keeps the cursor where it is', () => {
  it('survives typing an ORCID iD one character at a time', () => {
    const state = renderLive('')
    const el = input('ORCID iD — member 1')
    el.focus()
    expect(document.activeElement).toBe(el)

    let typed = ''
    for (const ch of ORCID) {
      typed += ch
      type(el, typed)
      // The same element, still focused: a remount would have replaced it.
      expect(document.activeElement).toBe(el)
      expect(container.contains(el)).toBe(true)
      // And it shows what was typed, not what the parser made of it — half an
      // ORCID iD is a bare word, which is the shape of a permalink.
      expect(el.value).toBe(typed)
    }

    expect(state.members).toBe(ORCID)
    // Nothing was left behind in the cell the half-typed value passed through.
    expect(input(`researchmap — ${ORCID}`).value).toBe('')
  })

  it('survives typing a name into an existing member’s row', () => {
    renderLive(ORCID)
    const el = input(`Name — ${ORCID}`)
    el.focus()
    let typed = ''
    for (const ch of 'Yuki Furukawa') {
      typed += ch
      type(el, typed)
      expect(document.activeElement).toBe(el)
      expect(el.value).toBe(typed)
    }
  })
})

/**
 * The import box.
 *
 * It lives in `ModeForms`, but it is the same surface as the rows and the point
 * of the test is the relationship between the two: a paste **adds** members. It
 * used to be that the textarea was `draft.members` itself, so anything typed
 * into it replaced everything — which is fine when it is the only surface and
 * indefensible once rows are editing the same string.
 */
describe('importing a pasted list', () => {
  function labModeForm(members: string) {
    const state = { members }
    function Harness() {
      const [draft, setDraft] = useState<WizardDraft>({
        ...emptyDraft('lab'),
        members,
      })
      state.members = draft.members
      return (
        <LabModeForm
          draft={draft}
          update={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      )
    }
    act(() => root.render(<Harness />))
    return state
  }

  function importBox(): HTMLTextAreaElement {
    const el = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Members to import"]',
    )
    if (!el) throw new Error('no import box')
    return el
  }

  function typeInto(el: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set
    act(() => {
      setter?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function clickImport() {
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').startsWith('Import'),
    )
    if (!button) throw new Error('no Import button')
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    return button
  }

  it('appends the pasted members instead of replacing the list', () => {
    const state = labModeForm('Yuki Furukawa\t0000-0003-1317-0220')
    typeInto(importBox(), `Ada Lovelace\t${ORCID}\t2019-04..2023-03`)
    clickImport()
    expect(state.members).toBe(
      `Yuki Furukawa\t0000-0003-1317-0220\nAda Lovelace\t${ORCID}\t2019-04..2023-03`,
    )
  })

  it('clears the box afterwards, so a second press cannot double the list', () => {
    labModeForm('')
    typeInto(importBox(), ORCID)
    const button = clickImport()
    expect(importBox().value).toBe('')
    expect(button.disabled).toBe(true)
  })

  it('does not touch the box the rows are stored in until Import is pressed', () => {
    const state = labModeForm('0000-0003-1317-0220')
    typeInto(importBox(), ORCID)
    expect(state.members).toBe('0000-0003-1317-0220')
  })

  it('skips a member who is already on the list', () => {
    const state = labModeForm(ORCID)
    typeInto(importBox(), `${ORCID}\n0000-0003-1317-0220`)
    clickImport()
    expect(state.members).toBe(`${ORCID}\n0000-0003-1317-0220`)
  })
})
