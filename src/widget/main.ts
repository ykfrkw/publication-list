/**
 * iframe fallback page (widget.html) — the embed path for CMSes that strip
 * `<script src>` out of post bodies.
 *
 * Same job as `src/embed/entry.ts`, one transport swapped: the config arrives
 * in the URL query string instead of in `data-*` attributes on a container.
 * `parseConfigFromSearchParams` and `parseConfigFromDataset` are two adapters
 * over one coercion routine in `core/config.ts`, so the two embed paths cannot
 * disagree about what a given config means.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE CREDIT LINK IS ALLOWED HERE, AND ONLY HERE AT RUNTIME
 *
 * `entry.ts` renders with `{ credit: false }` and may not go near a
 * `.publist-credit` node, because it runs *inside the host page's document*:
 * a distributed script that injects a link into someone else's markup is
 * precisely the pattern Google's link-spam policy names.
 *
 * This document is not that. It is served from our own origin and rendered in
 * its own browsing context; the host page's markup contains an `<iframe>` and
 * nothing else. The credit is therefore first-party content on our own page —
 * the same status it has on the wizard — and carries nothing into the host's
 * document at all. Hence the credit may be rendered here.
 *
 * It is still opt-out, because the project's promise about the credit is that
 * turning it off restricts nothing. `?credit=0` in the frame's URL is the
 * iframe route's equivalent of unticking the wizard's checkbox; the wizard
 * writes it into the `src` it emits. The default is on, so a hand-written
 * iframe URL — and every URL written before this parameter existed — keeps it.
 *
 * The source disclaimer is not in that argument at all. It is an ordinary
 * `ListConfig` field, so `?disclaimer=hide` turns it off through the same
 * parser as every other parameter, and it is on by default. The two are
 * separate switches in both directions: `?credit=0` leaves the disclaimer,
 * `?disclaimer=hide` leaves the credit.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Height reporting to the parent is handled by /embed-height.js, loaded
 * separately from widget.html; it observes this container and posts
 * `{ type: 'embed:height', height: <int> }`.
 */

import {
  configHash,
  normalizeConfig,
  parseConfigFromSearchParams,
} from '../core/config'
import { readCache, writeCache } from '../core/cache'
import { buildList } from '../core/pipeline'
import { renderHtml } from '../core/render'
import type { ListConfig, ListModel } from '../core/types'

const ROOT_ID = 'publist-widget'
const STATE_ATTRIBUTE = 'data-publist-state'

/** Also a styling hook: `[data-publist-state="loading"] { … }` in widget.html. */
type WidgetState = 'loading' | 'cached' | 'ready' | 'empty' | 'error'

/** A registry id addresses `lists/<id>.json` next to this page — keep it a filename. */
const LIST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

function setState(el: HTMLElement, state: WidgetState): void {
  el.setAttribute(STATE_ATTRIBUTE, state)
}

/**
 * Replace the container's contents with a message.
 *
 * Built with `textContent`, never `innerHTML`: the detail line can carry a
 * fetch error mentioning a URL that came out of the query string.
 */
function showMessage(
  el: HTMLElement,
  className: string,
  text: string,
  detail?: string,
): void {
  el.textContent = ''
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  el.appendChild(p)
  if (detail) {
    const small = document.createElement('p')
    small.className = 'widget-error-detail'
    small.textContent = detail
    el.appendChild(small)
  }
}

/**
 * Values of `?credit=` that mean "off". Anything else — including a typo and
 * including no parameter at all — leaves the credit on, so a malformed URL
 * fails towards attribution rather than away from it.
 */
const CREDIT_OFF_VALUES: readonly string[] = ['0', 'false', 'off', 'no']

/**
 * `?credit=` — the one query parameter that is not part of the `ListConfig`.
 *
 * It is deliberately not in `CONFIG_PARAM_NAMES`: it says how to render this
 * page, not what to put on it, it never travels in a `pubs.json`, and it has
 * no `data-*` counterpart — `entry.ts` renders with the credit off on every
 * code path and must stay that way.
 */
export function parseCreditParam(params: URLSearchParams): boolean {
  const raw = params.get('credit')
  if (raw == null) return true
  return !CREDIT_OFF_VALUES.includes(raw.trim().toLowerCase())
}

/**
 * Render the list, credit block included unless `?credit=0` said otherwise and
 * the source disclaimer included unless the config said `disclaimer: 'hide'`.
 *
 * `innerHTML` is safe and correct here in a way it is not in `entry.ts`: this
 * document is ours, so there is no host markup to preserve, and every value
 * `renderHtml` interpolates has already gone through `escapeHtml`/`escapeUrl`
 * in `core/format.ts`. Replacing wholesale is also what guarantees exactly one
 * `.publist-credit` once the cached render is overwritten by the live one.
 */
function showList(el: HTMLElement, model: ListModel, credit: boolean): void {
  el.innerHTML = renderHtml(model, { credit })
}

/**
 * Fetch a `Partial<ListConfig>` from a URL.
 *
 * `entry.ts` has an equivalent private helper. The two are not shared because
 * `core/` is deliberately network-free outside `core/sources/`, and neither
 * embed target may import from the other.
 */
async function fetchJson(url: string): Promise<Partial<ListConfig>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as Partial<ListConfig>
}

/** Inline query parameters win over anything the remote config says. */
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
 * Resolve `?config=` / `?list=` into a partial config.
 *
 * Both pointers come from the query string, i.e. from whoever wrote the iframe
 * `src`, so both are checked before use: `config` must be http(s), and `list`
 * must look like a bare filename so it cannot climb out of `lists/`.
 */
async function loadRemote(
  configUrl: string | undefined,
  listId: string | undefined,
): Promise<Partial<ListConfig>> {
  if (configUrl) {
    let url: URL
    try {
      url = new URL(configUrl, document.baseURI)
    } catch {
      throw new Error(`config is not a valid URL: ${configUrl}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`config must be an http(s) URL: ${configUrl}`)
    }
    return await fetchJson(url.toString())
  }

  if (listId) {
    if (!LIST_ID_PATTERN.test(listId)) {
      throw new Error(`not a known list id: ${listId}`)
    }
    return await fetchJson(
      new URL(`lists/${listId}.json`, document.baseURI).toString(),
    )
  }

  return {}
}

/** Is there anything at all for the pipeline to fetch? */
function hasSource(config: ListConfig): boolean {
  const { orcid, researchmap, pubmed } = config.seeds
  return Boolean(
    orcid?.length ||
      researchmap?.length ||
      pubmed?.length ||
      config.include?.length,
  )
}

async function run(el: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const parsed = parseConfigFromSearchParams(params)
  const credit = parseCreditParam(params)

  const remote = await loadRemote(parsed.configUrl, parsed.listId)
  const config = normalizeConfig(mergeConfigs(remote, parsed.config))

  if (!hasSource(config)) {
    setState(el, 'empty')
    showMessage(
      el,
      'widget-status',
      'No publication source was given.',
      'Add an orcid, researchmap, pubmed, include, config or list parameter to this page’s URL.',
    )
    return
  }

  const key = configHash(config)

  // Stale-while-revalidate, same as the JS embed: last run's list appears
  // immediately, then the live fetch replaces it.
  let servedFromCache = false
  const cached = readCache(key)
  if (cached) {
    showList(el, cached, credit)
    setState(el, 'cached')
    servedFromCache = true
  }

  const model = await buildList(config, {
    onProgress: (_pct, message) => {
      // Only while the frame still shows the loading line: once a cached list
      // is on screen, replacing it with progress text would be a downgrade.
      if (servedFromCache) return
      // The text span, not the whole line: the line also holds the spinner
      // that shipped in widget.html, and writing `textContent` on the parent
      // would delete it. Falling back to `.widget-status` keeps this working
      // for a container that was written without the span.
      const status =
        el.querySelector('.widget-status-text') ?? el.querySelector('.widget-status')
      if (status) status.textContent = `${message}…`
    },
  })

  writeCache(key, model)
  showList(el, model, credit)
  setState(el, 'ready')
}

function init(): Promise<void> {
  const el = document.getElementById(ROOT_ID)
  if (!el) return Promise.resolve()

  setState(el, 'loading')
  return run(el).catch((err: unknown) => {
    // A blank frame inside someone's page is the worst outcome — it reads as a
    // broken site. Say what happened in plain words instead.
    setState(el, 'error')
    showMessage(
      el,
      'widget-error',
      'The publication list could not be loaded.',
      err instanceof Error ? err.message : String(err),
    )
    console.warn('[publication-list] widget failed', err)
  })
}

void init()

// Exported for tests; the built page has no consumer for these.
export { init, mergeConfigs }
