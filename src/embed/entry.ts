/**
 * Embed entry point — built by vite.embed.config.ts into a single
 * self-contained IIFE at dist/embed.js (and dist/v1/embed.js).
 *
 * This script is injected into other people's pages. It must stay
 * framework-free and small (< 20KB gzip); import only from `src/core`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HARD CONSTRAINT — THE TWO TRAILER LINES ARE OFF LIMITS
 *
 * This script MUST NOT create, modify or remove any element matching
 * `.publist-credit` or `.publist-disclaimer`, under any code path, ever.
 *
 * The credit link exists only in the static HTML the wizard emits, so it
 * lives in the site owner's own markup where they can see and delete it. A
 * distributed script that injects links at runtime is exactly the pattern
 * Google's link-spam policy names. When this script replaces the snapshot
 * list, it must leave any `.publist-credit` node untouched — not preserve and
 * re-insert it, but simply never touch it.
 *
 * The source disclaimer is a different kind of line — it makes no link and
 * carries no ranking value — but it lives in the same place, in the pasted
 * snippet, and so it gets the same treatment for a plainer reason: whatever
 * the site owner pasted is theirs. If they deleted the line, a script of ours
 * putting it back would be overruling them on their own page. So this file
 * treats both nodes identically, and neither is ever injected or removed.
 *
 * The two mechanisms that enforce this:
 *
 *   1. `renderHtml(model, { credit: false, disclaimer: false })` — the runtime
 *      path cannot emit either line even by accident.
 *   2. `replaceListContent()` never assigns `innerHTML` on the container and
 *      never removes the node chain that holds them. It removes the other
 *      children individually and inserts the new list before that chain, so
 *      the existing nodes survive *by identity*.
 *
 * Unit tests pin all three behaviours for both: the line is never created,
 * never changed, and never restored after the site owner deletes it.
 *
 * The loading indicator added below lives *outside* those nodes and is removed
 * by class name only, so it cannot reach either of them.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE MOSTLY DOES NOT SHOW A SPINNER
 *
 * The pasted snippet carries a pre-rendered snapshot, so in the normal case
 * the visitor is already reading a complete, correct publication list while
 * the refresh runs behind it. Swapping that for a spinner would take working
 * content off the screen and make a healthy page look broken — the opposite of
 * what a loading indicator is for. So:
 *
 *   - Snapshot or cache present → the list stays exactly where it is. The
 *     refresh is exposed through `data-publist-state` (which a host stylesheet
 *     can key off) plus one small "Updating…" line. That line is laid out at
 *     zero height so nothing on the page moves when it appears or goes, and it
 *     neither covers nor dims the list.
 *   - Container genuinely empty (a hand-written snippet with no snapshot, and
 *     no cached run to fall back on) → there is nothing to protect and a blank
 *     box to explain, so this is the one case that gets a real spinner.
 * ──────────────────────────────────────────────────────────────────────────
 */

import {
  configHash,
  isListId,
  normalizeConfig,
  parseConfigFromDataset,
} from '../core/config'
import { readCache, writeCache } from '../core/cache'
import { buildList } from '../core/pipeline'
import { CREDIT_SELECTOR, DISCLAIMER_SELECTOR, renderHtml } from '../core/render'
import type { ListConfig } from '../core/types'

const CONTAINER_SELECTOR = '.publist-embed'

/**
 * Everything in the pasted snippet this script must never touch.
 *
 * One selector rather than two code paths: the credit and the disclaimer are
 * preserved by the same mechanism, and a third trailer line added later should
 * only have to be named here.
 */
const PRESERVED_SELECTOR = `${CREDIT_SELECTOR}, ${DISCLAIMER_SELECTOR}`

/** Render options for every runtime render. Both trailer lines suppressed. */
const RUNTIME_RENDER = { credit: false, disclaimer: false } as const
const STATE_ATTRIBUTE = 'data-publist-state'
const HYDRATED_FLAG = 'data-publist-hydrated'

/** Loading-indicator hooks. Everything this script adds carries one of these. */
const INDICATOR_CLASS = 'publist-indicator'
const SPINNER_CLASS = 'publist-spinner'
const STYLE_ID = 'publist-embed-style'

/** Styling hook for the host page: `[data-publist-state="loading"] { … }`. */
type EmbedState = 'loading' | 'ready' | 'error' | 'cached'

/**
 * Where this script was served from — the base for `data-list` lookups.
 * Read at module scope because `document.currentScript` is only set while the
 * script is executing.
 */
const SCRIPT_SRC = currentScriptSrc()

function currentScriptSrc(): string | undefined {
  const current = document.currentScript as HTMLScriptElement | null
  if (current?.src) return current.src
  // `type="module"` and a few CMS loaders leave `currentScript` null.
  const scripts = Array.from(document.querySelectorAll('script[src]'))
  for (const script of scripts) {
    const src = (script as HTMLScriptElement).src
    if (src && /embed\.js(\?|#|$)/.test(src)) return src
  }
  return undefined
}

function setState(el: HTMLElement, state: EmbedState): void {
  el.setAttribute(STATE_ATTRIBUTE, state)
}

// ─────────────────────────────────────────────────── loading indicator ──

/**
 * The indicator's stylesheet, injected once and only if an indicator is
 * actually built.
 *
 * Every selector is prefixed `publist-` and qualified by the container class,
 * and the one keyframe name is prefixed too, so nothing here can collide with
 * — or leak into — the host page's own styles. No asset, no second request, no
 * dependency: two borders and a rotation.
 *
 * `em` and `currentColor` throughout, so the indicator inherits the size and
 * colour of whatever it lands in rather than imposing this project's design on
 * someone else's page.
 */
const INDICATOR_CSS = [
  '.publist-embed .publist-indicator{margin:0;opacity:.65;font-size:.8125em;line-height:1.5}',
  // Zero height, visible overflow: the line appears in the whitespace under
  // the list without displacing a single pixel of the page around it.
  //
  // `float` rather than `display:block`, and this is not cosmetic. An in-flow
  // block appended after the list becomes the container's last in-flow child,
  // which stops the list's own bottom margin collapsing out through the
  // container — measured at +16px of shift on a plain host page even though
  // the element itself is 0px tall. A float is out of flow, so the list stays
  // the last in-flow child and the collapse is unchanged: measured at exactly
  // 0px of shift. With no height it also cannot intrude on anything that
  // follows.
  '.publist-embed .publist-indicator-refresh{float:left;width:100%;height:0;overflow:visible}',
  '.publist-embed .publist-indicator-empty{display:flex;align-items:center;gap:.55em;padding:.4em 0;font-size:.9375em;opacity:.75}',
  '.publist-embed .publist-spinner{flex:none;display:inline-block;width:.9em;height:.9em;border:2px solid currentColor;border-top-color:transparent;border-radius:50%}',
  '@media (prefers-reduced-motion:no-preference){.publist-embed .publist-spinner{animation:publist-spin .75s linear infinite}}',
  // Without the rotation a gapped ring reads as a stalled spinner; close it
  // and what is left is a static mark beside the text that carries the message.
  '@media (prefers-reduced-motion:reduce){.publist-embed .publist-spinner{border-top-color:currentColor;opacity:.45}}',
  '@keyframes publist-spin{to{transform:rotate(360deg)}}',
].join('')

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = INDICATOR_CSS
  ;(document.head ?? document.documentElement).appendChild(style)
}

/** The preserved nodes currently present in a container, in document order. */
function preservedNodes(el: HTMLElement): Element[] {
  return Array.from(el.querySelectorAll(PRESERVED_SELECTOR))
}

/**
 * Is there already something in the container worth keeping on screen?
 *
 * "Something" means a snapshot: any element, or any text, that is not part of
 * a preserved trailer line. A container holding nothing but a credit and a
 * disclaimer counts as empty — the visitor has no list to read either way.
 *
 * This has to be asked *before* an indicator is inserted, or the indicator
 * would answer for itself.
 */
function hasContent(el: HTMLElement): boolean {
  const preserved = preservedNodes(el)
  for (const node of Array.from(el.querySelectorAll('*'))) {
    // Skip the preserved nodes, their descendants, and any wrapper holding
    // one: a wrapper that also holds a list is caught by that list's own
    // element.
    if (
      preserved.some(
        (keep) => node === keep || keep.contains(node) || node.contains(keep),
      )
    ) {
      continue
    }
    return true
  }
  let text = el.textContent ?? ''
  for (const keep of preserved) {
    const keepText = keep.textContent ?? ''
    if (keepText) text = text.replace(keepText, '')
  }
  return text.trim() !== ''
}

/**
 * Remove anything this script added.
 *
 * By class name, and by a class name only this script writes — which is what
 * keeps it structurally incapable of removing a `.publist-credit` node.
 */
function clearIndicator(el: HTMLElement): void {
  for (const node of Array.from(el.querySelectorAll(`.${INDICATOR_CLASS}`))) {
    node.parentNode?.removeChild(node)
  }
}

/**
 * Show that a refresh is in flight.
 *
 * `spinner: true` is only ever passed for a container that started empty; see
 * the note at the top of this file for why the snapshot case gets a line of
 * text instead.
 *
 * Appended last, so it sits after the list and after any credit block rather
 * than between them.
 */
function showIndicator(el: HTMLElement, spinner: boolean): void {
  clearIndicator(el)
  ensureStyles()

  const box = document.createElement('div')
  box.className = `${INDICATOR_CLASS} ${INDICATOR_CLASS}-${spinner ? 'empty' : 'refresh'}`
  // Announced politely: a refresh the visitor did not ask for must not steal
  // focus or interrupt a screen reader mid-sentence.
  box.setAttribute('role', 'status')

  if (spinner) {
    const mark = document.createElement('span')
    mark.className = SPINNER_CLASS
    mark.setAttribute('aria-hidden', 'true')
    box.appendChild(mark)
    box.appendChild(document.createTextNode('Loading publications…'))
  } else {
    box.textContent = 'Updating…'
  }

  el.appendChild(box)
}

async function fetchJson(url: string): Promise<Partial<ListConfig>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as Partial<ListConfig>
}

/** Inline `data-*` attributes win over anything the `data-list` file says. */
function mergeConfigs(
  base: Partial<ListConfig>,
  override: Partial<ListConfig>,
): Partial<ListConfig> {
  return {
    ...base,
    ...override,
    seeds: { ...(base.seeds ?? {}), ...(override.seeds ?? {}) },
  }
}

/**
 * Replace the list content while leaving every `.publist-credit` and
 * `.publist-disclaimer` node exactly where it is — same node, same parent, same
 * attributes.
 *
 * `innerHTML` is never used on the container: assigning it would destroy and
 * recreate those nodes, which is the one thing this script must not do.
 * Children are removed individually, except the direct children that *are* or
 * *contain* a preserved node; if a preserved node sits inside a wrapper (the
 * wizard's snapshot puts both inside `<section class="publist">`), that wrapper
 * is pruned the same way, recursively, so only the preserved chains survive.
 */
function replaceListContent(el: HTMLElement, html: string): void {
  const preserved = preservedNodes(el)

  // The direct children that carry a preserved node, in document order. The
  // new list is inserted before the first of them, so it lands above the
  // trailer lines rather than after them.
  const anchors: ChildNode[] = []
  for (const child of Array.from(el.childNodes)) {
    if (preserved.some((keep) => child === keep || child.contains(keep))) {
      anchors.push(child)
    }
  }

  for (const child of Array.from(el.childNodes)) {
    if (anchors.includes(child)) continue
    el.removeChild(child)
  }
  for (const anchor of anchors) {
    if (!preserved.includes(anchor as Element)) pruneKeepingNodes(anchor, preserved)
  }

  const template = document.createElement('template')
  template.innerHTML = html
  if (anchors.length > 0) el.insertBefore(template.content, anchors[0])
  else el.appendChild(template.content)
}

/** Strip everything under `node` except the chains leading to `keep`. */
function pruneKeepingNodes(node: Node, keep: readonly Element[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (keep.includes(child as Element)) continue
    if (keep.some((target) => child.contains(target))) {
      pruneKeepingNodes(child, keep)
      continue
    }
    node.removeChild(child)
  }
}

async function loadConfig(el: HTMLElement): Promise<ListConfig> {
  const parsed = parseConfigFromDataset(el)

  let remote: Partial<ListConfig> = {}
  if (parsed.listId != null) {
    // Checked before it is interpolated into a path, with the same rule the
    // widget and the wizard's restore use — `isListId` in `core/config.ts`.
    // Without it `data-list="../../secrets"` resolves to `<site>/secrets.json`
    // and is fetched: `new URL()` walks `..` like any other path.
    //
    // Thrown rather than ignored, because a snippet naming an unusable id is a
    // broken snippet and quietly rendering it from the inline attributes would
    // hide that. `hydrate`'s caller catches it, warns on the console and leaves
    // the pasted snapshot on the page — so a visitor still sees the list.
    if (!isListId(parsed.listId)) {
      throw new Error(`not a known list id: ${parsed.listId}`)
    }
    // No base URL means the script tag could not be located, so there is
    // nothing to resolve against; the inline attributes stand on their own.
    if (SCRIPT_SRC) {
      const url = new URL(`lists/${parsed.listId}.json`, SCRIPT_SRC).toString()
      remote = await fetchJson(url)
    }
  }

  return normalizeConfig(mergeConfigs(remote, parsed.config))
}

async function hydrate(el: HTMLElement): Promise<void> {
  // The pre-rendered snapshot in the container is the fallback for every
  // failure below: it is only ever replaced once there is something better.
  setState(el, 'loading')
  // Asked before anything is inserted, and remembered: a container that began
  // empty is the only one that gets a spinner.
  showIndicator(el, !hasContent(el))

  const config = await loadConfig(el)
  const key = configHash(config)

  const cached = readCache(key)
  if (cached) {
    // Stale-while-revalidate: show last run's list immediately, then refresh.
    replaceListContent(el, renderHtml(cached, RUNTIME_RENDER))
    setState(el, 'cached')
    // There is a list on screen now even if there was not a moment ago, and
    // the live fetch is still running — so downgrade to the quiet indicator.
    showIndicator(el, false)
  }

  const model = await buildList(config)
  writeCache(key, model)
  replaceListContent(el, renderHtml(model, RUNTIME_RENDER))
  clearIndicator(el)
  setState(el, 'ready')
}

/**
 * Hydrate every embed container on the page.
 *
 * Returns a promise that settles once all of them have finished, which is what
 * the unit tests await; nothing on a real page depends on the return value.
 */
function init(): Promise<void> {
  const containers = document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR)
  const pending: Promise<void>[] = []
  for (const el of Array.from(containers)) {
    if (el.hasAttribute(HYDRATED_FLAG)) continue
    el.setAttribute(HYDRATED_FLAG, '')
    pending.push(
      hydrate(el).catch((err: unknown) => {
        // A network blip must never blank out a lab's publication list:
        // whatever is in the container right now stays there. The indicator
        // does not: a permanent "Updating…" would be a lie.
        clearIndicator(el)
        setState(el, 'error')
        console.warn('[publication-list] could not refresh the list', err)
      }),
    )
  }
  return Promise.all(pending).then(() => undefined)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init(), { once: true })
} else {
  void init()
}

// Exported for the unit tests; the IIFE build has no consumers for these.
export { init, replaceListContent }
