/**
 * Embed entry point — built by vite.embed.config.ts into a single
 * self-contained IIFE at dist/embed.js (and dist/v1/embed.js).
 *
 * This script is injected into other people's pages. It must stay
 * framework-free and small (< 20KB gzip); import only from `src/core`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HARD CONSTRAINT — CREDIT LINKS ARE OFF LIMITS
 *
 * This script MUST NOT create, modify or remove any element matching
 * `.publist-credit`, under any code path, ever.
 *
 * The credit link exists only in the static HTML the wizard emits, so it
 * lives in the site owner's own markup where they can see and delete it. A
 * distributed script that injects links at runtime is exactly the pattern
 * Google's link-spam policy names. When this script replaces the snapshot
 * list, it must leave any `.publist-credit` node untouched — not preserve and
 * re-insert it, but simply never touch it.
 *
 * The two mechanisms that enforce this:
 *
 *   1. `renderHtml(model, { credit: false })` — the runtime path cannot emit a
 *      credit block even by accident.
 *   2. `replaceListContent()` never assigns `innerHTML` on the container and
 *      never removes the node chain that holds the credit. It removes the
 *      other children individually and inserts the new list before that chain,
 *      so the existing credit node survives *by identity*.
 *
 * Unit tests pin all three behaviours: the link is never created, never
 * changed, and never restored after the site owner deletes it.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { configHash, normalizeConfig, parseConfigFromDataset } from '../core/config'
import { readCache, writeCache } from '../core/cache'
import { buildList } from '../core/pipeline'
import { CREDIT_SELECTOR, renderHtml } from '../core/render'
import type { ListConfig } from '../core/types'

const CONTAINER_SELECTOR = '.publist-embed'
const STATE_ATTRIBUTE = 'data-publist-state'
const HYDRATED_FLAG = 'data-publist-hydrated'

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

async function fetchJson(url: string): Promise<Partial<ListConfig>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as Partial<ListConfig>
}

/** Inline `data-*` attributes win over anything the remote config says. */
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
 * Replace the list content while leaving any `.publist-credit` node exactly
 * where it is — same node, same parent, same attributes.
 *
 * `innerHTML` is never used on the container: assigning it would destroy and
 * recreate the credit node, which is the one thing this script must not do.
 * Children are removed individually, except the direct child that *is* or
 * *contains* the credit node; if the credit sits inside a wrapper (the wizard's
 * snapshot puts it inside `<section class="publist">`), that wrapper is pruned
 * the same way, recursively, so only the credit chain survives.
 */
function replaceListContent(el: HTMLElement, html: string): void {
  const credit = el.querySelector(CREDIT_SELECTOR)

  let anchor: ChildNode | null = null
  if (credit) {
    for (const child of Array.from(el.childNodes)) {
      if (child === credit || child.contains(credit)) {
        anchor = child
        break
      }
    }
  }

  for (const child of Array.from(el.childNodes)) {
    if (child === anchor) continue
    el.removeChild(child)
  }
  if (anchor && anchor !== credit) pruneKeepingCredit(anchor, credit as Node)

  const template = document.createElement('template')
  template.innerHTML = html
  if (anchor) el.insertBefore(template.content, anchor)
  else el.appendChild(template.content)
}

/** Strip everything under `node` except the chain leading to `credit`. */
function pruneKeepingCredit(node: Node, credit: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child === credit) continue
    if (child.contains(credit)) {
      pruneKeepingCredit(child, credit)
      continue
    }
    node.removeChild(child)
  }
}

async function loadConfig(el: HTMLElement): Promise<ListConfig> {
  const parsed = parseConfigFromDataset(el)

  let remote: Partial<ListConfig> = {}
  if (parsed.configUrl) {
    remote = await fetchJson(parsed.configUrl)
  } else if (parsed.listId && SCRIPT_SRC) {
    const url = new URL(`lists/${parsed.listId}.json`, SCRIPT_SRC).toString()
    remote = await fetchJson(url)
  }

  return normalizeConfig(mergeConfigs(remote, parsed.config))
}

async function hydrate(el: HTMLElement): Promise<void> {
  // The pre-rendered snapshot in the container is the fallback for every
  // failure below: it is only ever replaced once there is something better.
  setState(el, 'loading')

  const config = await loadConfig(el)
  const key = configHash(config)

  const cached = readCache(key)
  if (cached) {
    // Stale-while-revalidate: show last run's list immediately, then refresh.
    replaceListContent(el, renderHtml(cached, { credit: false }))
    setState(el, 'cached')
  }

  const model = await buildList(config)
  writeCache(key, model)
  replaceListContent(el, renderHtml(model, { credit: false }))
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
        // whatever is in the container right now stays there.
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
