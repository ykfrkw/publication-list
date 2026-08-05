/**
 * @vitest-environment jsdom
 *
 * Component test for the review queue: rendered with a real DOM, driven by
 * real clicks on real checkboxes.
 *
 * `buildList` is never called here — the candidates are a fixture. Nothing in
 * this file touches the network.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Publication } from '@/core/types'
import { ReviewQueue } from '../ReviewQueue'

declare global {
  // React's `act` looks for this flag before it will batch test updates.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function candidate(over: Partial<Publication> & { key: string }): Publication {
  return {
    title: 'Untitled',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'J Test',
    year: 2024,
    sources: ['pubmed'],
    seedIds: ['Furukawa Y[au]'],
    trust: 'candidate',
    ...over,
  }
}

const CANDIDATES: Publication[] = [
  candidate({
    key: 'pmid:111',
    pmid: '111',
    title: 'Digital CBT for insomnia',
    journal: 'Sleep Medicine Reviews',
    year: 2023,
  }),
  candidate({
    key: 'doi:10.1/x',
    doi: '10.1/x',
    title: 'Something by a namesake',
    journal: 'Journal of Other Things',
    year: 2019,
  }),
]

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
  props: Omit<Partial<React.ComponentProps<typeof ReviewQueue>>, 'onApply'> = {},
) {
  const onApply = vi.fn<(next: { include: string[]; exclude: string[] }) => void>()
  act(() => {
    root.render(
      <ReviewQueue
        candidates={CANDIDATES}
        suggested={[]}
        style="vancouver"
        boldNames={['Yuki Furukawa']}
        reviewPolicy="strict"
        include={[]}
        exclude={[]}
        {...props}
        onApply={onApply}
      />,
    )
  })
  return { onApply }
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[id^="candidate-"]'),
  )
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function buttonWithText(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  )
  if (!match) throw new Error(`no button containing "${text}"`)
  return match
}

describe('ReviewQueue rendering', () => {
  it('shows a checkbox, the citation, the journal and the year per candidate', () => {
    render()
    expect(checkboxes()).toHaveLength(2)
    const text = container.textContent ?? ''
    expect(text).toContain('Digital CBT for insomnia')
    expect(text).toContain('Sleep Medicine Reviews')
    expect(text).toContain('2023')
    expect(text).toContain('PMID 111')
  })

  it('pairs every checkbox with a real label', () => {
    render()
    for (const box of checkboxes()) {
      expect(container.querySelector(`label[for="${box.id}"]`)).not.toBeNull()
    }
  })

  it('pre-checks exactly the candidates the pipeline suggested', () => {
    render({ suggested: ['doi:10.1/x'] })
    const [first, second] = checkboxes()
    expect(first.checked).toBe(false)
    expect(second.checked).toBe(true)
  })

  it('says how many candidates are being kept off the published list', () => {
    render()
    expect(container.textContent).toContain(
      '2 of these are not on your published list',
    )
    expect(container.textContent).toContain(
      'stays off the published list until you confirm it',
    )
  })

  it('says the opposite when the policy is set to publish immediately', () => {
    render({ reviewPolicy: 'auto' })
    expect(container.textContent).toContain(
      'already visible on your published list',
    )
  })
})

describe('check / uncheck → include / exclude', () => {
  it('confirms a checked candidate and rejects the rest', () => {
    const { onApply } = render()
    click(checkboxes()[0])
    click(buttonWithText('Confirm 1, reject 1'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      include: ['pmid:111'],
      exclude: ['doi:10.1/x'],
    })
  })

  it('moves a candidate from include to exclude when it is unchecked', () => {
    const { onApply } = render({ include: ['pmid:111'] })
    // Seeded from `include`, so it starts checked.
    expect(checkboxes()[0].checked).toBe(true)

    click(checkboxes()[0])
    click(buttonWithText('Confirm 0, reject 2'))

    expect(onApply).toHaveBeenCalledWith({
      include: [],
      exclude: ['pmid:111', 'doi:10.1/x'],
    })
  })

  it('moves a candidate from exclude to include when it is checked', () => {
    const { onApply } = render({ exclude: ['doi:10.1/x'] })
    expect(checkboxes()[1].checked).toBe(false)

    click(checkboxes()[1])
    click(buttonWithText('Confirm 1, reject 1'))

    expect(onApply).toHaveBeenCalledWith({
      include: ['doi:10.1/x'],
      exclude: ['pmid:111'],
    })
  })

  it('leaves decisions about records outside the queue untouched', () => {
    const { onApply } = render({ include: ['pmid:999'], exclude: ['pmid:888'] })
    click(buttonWithText('Confirm 0, reject 2'))

    const call = onApply.mock.calls[0][0] as {
      include: string[]
      exclude: string[]
    }
    expect(call.include).toEqual(['pmid:999'])
    expect(call.exclude).toEqual(['pmid:888', 'pmid:111', 'doi:10.1/x'])
  })

  it('checks and clears every candidate with the bulk controls', () => {
    render()
    click(buttonWithText('Select all'))
    expect(checkboxes().every((b) => b.checked)).toBe(true)
    click(buttonWithText('Select none'))
    expect(checkboxes().every((b) => !b.checked)).toBe(true)
  })

  it('restores the pipeline suggestion with "Select suggested"', () => {
    render({ suggested: ['pmid:111'] })
    click(buttonWithText('Select all'))
    click(buttonWithText('Select suggested'))
    const [first, second] = checkboxes()
    expect(first.checked).toBe(true)
    expect(second.checked).toBe(false)
  })

  it('disables a candidate that has neither a DOI nor a PMID', () => {
    render({
      candidates: [candidate({ key: 'title:orphan', title: 'No identifiers' })],
    })
    expect(checkboxes()[0].disabled).toBe(true)
    expect(container.textContent).toContain('cannot be pinned')
  })

  it('renders nothing when the queue is empty', () => {
    render({ candidates: [] })
    expect(container.textContent).toBe('')
  })
})
