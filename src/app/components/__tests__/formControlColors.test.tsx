/**
 * @vitest-environment jsdom
 *
 * The typed value must never be the same colour as the placeholder.
 *
 * The regression this pins: Tailwind's preflight sets `color: inherit` on form
 * controls, and the shared `Input` / `Textarea` set a colour for the
 * placeholder but none for the value. Several fields — every member row, for a
 * start — sit inside a `text-muted-foreground` label, so the value inherited
 * the muted grey and came out indistinguishable from the example text next to
 * it. The owner's report was exactly that: "後から入力しても灰色と区別がつかない".
 *
 * The fix is one word (`text-foreground`), which is precisely why it is easy to
 * drop in a refactor: nothing breaks, the field just quietly goes grey again.
 * So the assertion here is that the value colour is stated *explicitly* on the
 * control, not that it happens to look right — a control with no colour class
 * is the bug, whatever it renders to today.
 *
 * jsdom has no Tailwind, so these are class-level assertions. The real computed
 * colours and their contrast ratios were measured in a browser against the
 * built bundle; see the notes in `input.tsx`.
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '../Field'
import { MemberRows } from '../MemberRows'
import { parseMemberLines } from '../../lib/parse'
import { emptyDraft, type WizardDraft } from '../../lib/wizard'

declare global {
  // React's `act` looks for this flag before it will batch test updates.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The colour the value must carry, and the one it must not be left as. */
const VALUE = 'text-foreground'
const MUTED = 'text-muted-foreground'

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

/**
 * Renders inside a muted wrapper on purpose. That is how the app uses these —
 * the member-row labels are `text-muted-foreground` — and it is the situation
 * in which an inherited colour is wrong rather than merely unstated.
 */
function render(node: ReactNode) {
  act(() => {
    root.render(<div className={MUTED}>{node}</div>)
  })
}

function classes(el: Element): string[] {
  return Array.from(el.classList)
}

describe('shared form controls', () => {
  it('sets the value colour explicitly on Input rather than inheriting it', () => {
    render(<Input placeholder="yk_frkw" readOnly value="typed" />)
    const el = container.querySelector('input')!

    expect(classes(el)).toContain(VALUE)
    // The value colour must be its own class, not the placeholder's.
    expect(classes(el)).not.toContain(MUTED)
  })

  it('sets the value colour explicitly on Textarea rather than inheriting it', () => {
    render(<Textarea placeholder="yk_frkw" readOnly value="typed" />)
    const el = container.querySelector('textarea')!

    expect(classes(el)).toContain(VALUE)
    expect(classes(el)).not.toContain(MUTED)
  })

  it('keeps the placeholder weaker than the value on both controls', () => {
    render(
      <>
        <Input placeholder="yk_frkw" readOnly value="" />
        <Textarea placeholder="yk_frkw" readOnly value="" />
      </>,
    )

    for (const el of container.querySelectorAll('input, textarea')) {
      // Two different tokens, both named. Equal tokens would be the bug back.
      expect(classes(el)).toContain(VALUE)
      expect(classes(el)).toContain(`placeholder:${MUTED}`)
    }
  })

  it('sets the value colour on the hand-rolled native select', () => {
    act(() => {
      root.render(
        <div className={MUTED}>
          <SelectField
            label="Japanese-language publications"
            value="separate"
            onChange={vi.fn()}
            options={[{ value: 'separate', label: 'Separate section' }]}
          />
        </div>,
      )
    })
    const el = container.querySelector('select')!

    expect(classes(el)).toContain(VALUE)
    expect(classes(el)).not.toContain(MUTED)
  })
})

describe('member rows', () => {
  /**
   * The rows are where the bug was actually seen, because each field is wrapped
   * in a muted label. Asserting over every control the block renders means a
   * future row that is hand-rolled instead of using `Input` is caught too.
   */
  it('gives every text field in a muted label an explicit value colour', () => {
    const draft: WizardDraft = { ...emptyDraft('lab'), members: '' }
    act(() => {
      root.render(
        <MemberRows
          draft={draft}
          update={vi.fn()}
          parsed={parseMemberLines(draft.members)}
          model={null}
        />,
      )
    })

    const fields = container.querySelectorAll(
      'input:not([type=checkbox]):not([type=radio]), textarea',
    )
    expect(fields.length).toBeGreaterThan(0)
    for (const el of fields) {
      expect(classes(el)).toContain(VALUE)
    }
  })

  it('uses the owner’s real researchmap permalink as the example', () => {
    const draft: WizardDraft = { ...emptyDraft('lab'), members: '' }
    act(() => {
      root.render(
        <MemberRows
          draft={draft}
          update={vi.fn()}
          parsed={parseMemberLines(draft.members)}
          model={null}
        />,
      )
    })

    const placeholders = Array.from(
      container.querySelectorAll('input[placeholder]'),
    ).map((el) => el.getAttribute('placeholder'))

    expect(placeholders).toContain('yk_frkw')
    expect(placeholders).not.toContain('furukawayuki')
  })
})
