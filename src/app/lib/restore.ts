/**
 * Paste a snippet back in and get the settings that made it.
 *
 * The snippet already carries the whole configuration — `configToDataAttributes`
 * writes every non-default setting onto the `<div class="publist-embed">`, and
 * the iframe fallback projects the same set onto a query string — so redoing a
 * list by hand is unnecessary work. This module reads whichever of those forms
 * was pasted and hands `configToDraft` the config it found.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE PASTED TEXT IS UNTRUSTED, AND IS TREATED AS DATA THROUGHOUT
 *
 * What arrives here is markup from somewhere else — a CMS field, an email, a
 * colleague's page. It is parsed for its *attributes* and nothing else:
 *
 *   - `DOMParser.parseFromString(text, 'text/html')` builds an inert document:
 *     no script runs, no `<img src>` is fetched, no `onerror` fires.
 *   - No node from that document is ever adopted into `document`, inserted
 *     anywhere, or re-serialized. The snapshot inside the container is only
 *     ever *queried* (`querySelector`), never rendered.
 *   - `innerHTML` does not appear in this file, in either direction.
 *   - The only URL ever fetched is a `data-list` id that passes `isListId`
 *     and is resolved against `SITE_BASE`, so it cannot climb out of `lists/`.
 *     That registry holds this repository's own files; there is no route here
 *     for a paste to name an arbitrary URL and have it fetched. `isListId`
 *     lives in `core/config.ts` and is the same rule `src/widget/main.ts` and
 *     `src/embed/entry.ts` apply — one definition, three call sites.
 *
 * Nothing that comes out of here is HTML: `restoreFromPaste` returns a
 * `WizardDraft`, which is strings and enums, and every value in it has been
 * through `normalizeConfig`'s closed vocabularies.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * WHAT IT DOES NOT DO: it never builds a list. The user is left on a filled-in
 * form and presses Generate themselves. Restoring settings and spending ten
 * seconds of somebody's network on them are two different consents.
 */

import {
  isListId,
  normalizeConfig,
  parseConfigFromDataset,
  parseConfigFromSearchParams,
  type DatasetConfig,
} from '@/core/config'
import { CREDIT_SELECTOR, DISCLAIMER_SELECTOR } from '@/core/render'
import { seedWindowOf } from '@/core/seeds'
import type { ListConfig, PubmedSeed } from '@/core/types'
import { SITE_BASE } from './snippet'
import { configToDraft, pickMode, type WizardDraft } from './wizard'

/** Which of the accepted shapes the paste turned out to be. */
export type RestoreForm = 'embed' | 'iframe' | 'list'

export interface RestoreResult {
  draft: WizardDraft
  form: RestoreForm
  /**
   * Settings the paste could not carry, in plain words, one item per line.
   *
   * Reported rather than dropped in silence. A restore that quietly loses the
   * "publish without review" tick would produce a shorter list on the next
   * build with nothing on screen to say why — the failure mode this whole tool
   * is most careful about.
   */
  lost: string[]
  /** The URL a hosted config was actually fetched from, when one was. */
  fetchedFrom?: string
}

export class RestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreError'
  }
}

/** Named in every error, so a failed paste says what would have worked. */
const ACCEPTED =
  'Paste the script snippet (the <div class="publist-embed"> block) or the ' +
  'iframe snippet.'

type FetchLike = typeof globalThis.fetch

export interface RestoreOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike
}

// ──────────────────────────────────────────────────────────── the parser ──

/**
 * Read a pasted snippet, snippet fragment or config URL into a wizard draft.
 *
 * Detection order, and it is an order rather than a guess: markup is decided by
 * what is in the markup, and only a paste with no `<` in it at all is treated
 * as a URL.
 *
 *   1. blank                                  → error naming what is accepted
 *   2. contains `<`  → parsed as HTML, then
 *        `.publist-embed` / `[data-list]` → embed form
 *        `iframe[src]`                    → iframe form
 *        neither                          → error
 *   3. a lone `…/widget.html?…` URL       → iframe form
 *   4. otherwise                          → error naming what is accepted
 */
export async function restoreFromPaste(
  text: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const input = text.trim()
  if (input === '') {
    throw new RestoreError(`There is nothing to read here. ${ACCEPTED}`)
  }

  if (input.includes('<')) return await fromMarkup(input, opts)

  if (/^https?:\/\/\S+$/i.test(input)) {
    const url = toHttpUrl(input)
    if (/widget\.html$/i.test(url.pathname) && url.search !== '') {
      return await fromSearchParams(url.searchParams, opts)
    }
    // Every other URL is refused rather than fetched. A snippet carries the
    // whole configuration in its own attributes, so there is nothing a URL
    // could add — and fetching one named by a paste is a request this module
    // has no reason to make.
    throw new RestoreError(
      `Nothing here reads settings from a URL. ${ACCEPTED}`,
    )
  }

  throw new RestoreError(
    `That does not look like a snippet. ${ACCEPTED}`,
  )
}

async function fromMarkup(
  input: string,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  if (typeof DOMParser === 'undefined') {
    throw new RestoreError('This browser cannot read pasted markup.')
  }
  // `text/html` builds an inert document: no script executes and no resource
  // is loaded. Nothing below inserts a node from it anywhere.
  const doc = new DOMParser().parseFromString(input, 'text/html')

  const container =
    doc.querySelector<HTMLElement>('.publist-embed') ??
    doc.querySelector<HTMLElement>('[data-list]')
  if (container) {
    return await build(
      parseConfigFromDataset(container),
      'embed',
      readSnapshotFlags(container),
      opts,
    )
  }

  const frame = doc.querySelector<HTMLElement>('iframe[src]')
  if (frame) {
    const src = frame.getAttribute('src') ?? ''
    return await fromSearchParams(toHttpUrl(src).searchParams, opts)
  }

  throw new RestoreError(
    'No settings were found in that markup. Looked for a ' +
      '<div class="publist-embed"> and for an <iframe src="…widget.html?…">. ' +
      ACCEPTED,
  )
}

async function fromSearchParams(
  params: URLSearchParams,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  return await build(parseConfigFromSearchParams(params), 'iframe', {
    credit: parseCreditParam(params),
  }, opts)
}

/**
 * `?credit=` — the one parameter that is not part of a `ListConfig`.
 *
 * Four lines rather than an import: `src/widget/main.ts` owns the canonical
 * `parseCreditParam`, but that module self-initializes (`void init()`) and
 * pulls in the whole pipeline at import time, so the app cannot import it.
 * Same vocabulary, same direction of failure — anything unrecognized leaves the
 * credit on.
 */
const CREDIT_OFF_VALUES: readonly string[] = ['0', 'false', 'off', 'no']

function parseCreditParam(params: URLSearchParams): boolean {
  const raw = params.get('credit')
  if (raw == null) return true
  return !CREDIT_OFF_VALUES.includes(raw.trim().toLowerCase())
}

/**
 * The three snippet checkboxes, read off the pasted markup.
 *
 * None of them is in the `data-*` set — the two trailer lines are
 * presentational, the snapshot is the rendered list itself, and the
 * disclaimer's attribute only appears when it is *off* — so the markup is the
 * evidence. It is also the better evidence: the site owner may have deleted
 * any of it from their own page by hand, and what is in the paste is what is
 * on the page.
 *
 * A container with no element children is an opening `<div>` pasted on its own.
 * That says nothing about any of them, so nothing is claimed and the caller
 * falls back to the defaults.
 */
function readSnapshotFlags(el: Element): {
  credit?: boolean
  disclaimer?: boolean
  snapshot?: boolean
} {
  if (el.children.length === 0) return {}
  return {
    credit: el.querySelector(CREDIT_SELECTOR) != null,
    disclaimer: el.querySelector(DISCLAIMER_SELECTOR) != null,
    snapshot: el.querySelector(LIST_SELECTOR) != null,
  }
}

/**
 * The rendered list inside a pasted snippet.
 *
 * `renderHtml`'s own wrapper, so its presence is exactly "this snippet was
 * built with a snapshot" — and its absence, in a container that has *some*
 * children, is exactly the lightweight snippet.
 */
const LIST_SELECTOR = 'section.publist'

// ─────────────────────────────────────────── resolving a `data-list` id ──

/** Inline `data-*` / query parameters win over the registry file, as in `entry.ts`. */
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

function toHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value, SITE_BASE)
  } catch {
    throw new RestoreError(`That is not a valid URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RestoreError(
      `Only http and https URLs are fetched, and that one is ${url.protocol.replace(':', '')}: ${value}`,
    )
  }
  return url
}

async function fetchConfig(
  url: string,
  opts: RestoreOptions,
): Promise<Partial<ListConfig>> {
  const doFetch = opts.fetch ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    throw new RestoreError('This browser cannot fetch the settings file.')
  }
  let res: Response
  try {
    res = await doFetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    throw new RestoreError(`Could not reach ${url}.`)
  }
  if (!res.ok) {
    throw new RestoreError(`${url} answered HTTP ${res.status}.`)
  }
  try {
    const json = (await res.json()) as unknown
    if (json == null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('not an object')
    }
    return json as Partial<ListConfig>
  } catch {
    throw new RestoreError(`${url} is not a list configuration file.`)
  }
}

interface Flags {
  credit?: boolean
  disclaimer?: boolean
  snapshot?: boolean
}

async function build(
  parsed: DatasetConfig,
  inlineForm: RestoreForm,
  flags: Flags,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  /** Did the PubMed seeds come from inline attributes rather than a registry file? */
  const pubmedInline = (parsed.config.seeds?.pubmed?.length ?? 0) > 0

  let config: ListConfig
  let form = inlineForm
  let fetchedFrom: string | undefined
  let listId: string | undefined

  if (parsed.listId) {
    if (!isListId(parsed.listId)) {
      throw new RestoreError(`That is not a usable list id: ${parsed.listId}`)
    }
    listId = parsed.listId
    fetchedFrom = new URL(`lists/${listId}.json`, SITE_BASE).toString()
    const remote = await fetchConfig(fetchedFrom, opts)
    config = normalizeConfig(mergeConfigs(remote, parsed.config))
    form = 'list'
  } else {
    config = normalizeConfig(parsed.config)
  }

  if (!hasSource(config)) {
    throw new RestoreError(
      'Those settings name no publication source — no ORCID iD, researchmap ' +
        'permalink, PubMed query or pinned identifier — so there would be ' +
        'nothing to build. Check that the whole snippet was copied.',
    )
  }

  const draft = configToDraft(config, flags)

  return {
    draft,
    form,
    fetchedFrom,
    lost: describeLosses(config, {
      form,
      flags,
      pubmedFromFile: !pubmedInline && fetchedFrom != null,
      listId,
      fetchedFrom,
    }),
  }
}

/** Is there anything at all for the pipeline to fetch? Mirrors `widget/main.ts`. */
function hasSource(config: ListConfig): boolean {
  const { orcid, researchmap, pubmed } = config.seeds
  return Boolean(
    orcid?.length ||
      researchmap?.length ||
      pubmed?.length ||
      config.include?.length,
  )
}

// ─────────────────────────────────────────── what did not come back, and why ──

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The window fields actually set on a PubMed seed, named for the user. */
function pubmedExtras(seed: PubmedSeed): string[] {
  const out: string[] = []
  if (seed.label != null && seed.label !== '') out.push('label')
  if (seed.from != null) out.push('start date')
  if (seed.to != null) out.push('end date')
  if (seed.grace != null) out.push('grace period')
  return out
}

interface LossContext {
  form: RestoreForm
  flags: Flags
  /** the PubMed seeds were read from a fetched registry file, so `trust` survived */
  pubmedFromFile: boolean
  listId?: string
  fetchedFrom?: string
}

/**
 * Everything the restore could not put back, named specifically.
 *
 * Specific rather than a general caveat on purpose: "some settings may not have
 * been restored" is something a user can only act on by re-checking all of
 * them, which is the work this feature exists to remove.
 */
function describeLosses(config: ListConfig, ctx: LossContext): string[] {
  const lost: string[] = []
  const pubmed = config.seeds.pubmed ?? []
  const mode = pickMode(config)

  if (pubmed.length > 0 && !ctx.pubmedFromFile) {
    // `data-pubmed` / `?pubmed=` carry the query text, and `pubmed-trusted`
    // beside it carries the “publish without review” ticks by position — so
    // that one *is* restored, and is deliberately not listed here. What has
    // nowhere to go is the rest: `readConfig` in `core/config.ts` refuses to
    // invent a syntax for a name or a date range inside somebody else's search
    // string.
    lost.push(
      'Any name, start date, end date or grace period you had set on a PubMed ' +
        'query. A snippet carries the query text and the “publish without ' +
        'review” tick and nothing else, and the query box holds one query per ' +
        'line with nowhere to write them.',
    )
  }

  if (pubmed.length > 0 && ctx.pubmedFromFile) {
    const described = pubmed
      .map((seed) => ({ seed, extras: pubmedExtras(seed) }))
      .filter((entry) => entry.extras.length > 0)
    if (described.length > 0) {
      lost.push(
        `The ${described
          .map((entry) => `${entry.extras.join(', ')} on “${entry.seed.query}”`)
          .join('; ')}. The query box is one query per line and has no field ` +
          'for them, so they are gone from the form even though the file had ' +
          'them. The queries themselves and the “publish without review” ticks ' +
          'did come back.',
      )
    }
  }

  const windowedSeeds = [
    ...(config.seeds.orcid ?? []),
    ...(config.seeds.researchmap ?? []),
  ]
  const graceOnly = windowedSeeds.filter((seed) => {
    const window = seedWindowOf(seed)
    return window != null && window.from == null && window.to == null
  })
  if (graceOnly.length > 0) {
    lost.push(
      `A grace period with no start or end date on ${plural(
        graceOnly.length,
        'seed',
        'seeds',
      )}. The members box writes a grace period onto a date range, so one ` +
        'standing on its own has nowhere to go. It changed nothing on its own ' +
        'either — a grace period only extends an end date.',
    )
  }

  if (mode === 'lab') {
    const orcid = config.seeds.orcid ?? []
    const researchmap = config.seeds.researchmap ?? []
    if (orcid.length + researchmap.length > 0) {
      lost.push(
        'Your members’ names. A snippet records identifiers only, so the ' +
          `members box has come back as ${plural(
            orcid.length + researchmap.length,
            'bare identifier',
            'bare identifiers',
          )}. Typing the names back beside them changes nothing about the ` +
          'list — they are there so you can read it.',
      )
    }
    if (orcid.length > 0 && researchmap.length > 0) {
      lost.push(
        'Which ORCID iD belongs with which researchmap permalink. A member ' +
          'who had both is now on two separate lines; put them back on one ' +
          'line to freeze that person in a single step.',
      )
    }
  }

  const excluded = config.exclude ?? []
  if (excluded.length > 0) {
    lost.push(
      `The titles of the ${plural(
        excluded.length,
        'record you had removed',
        'records you had removed',
      )}. They are still removed — an identifier is all a snippet carries — so ` +
        'the removed list names them by identifier rather than by title.',
    )
  }

  if (ctx.listId) {
    lost.push(
      `The data-list id “${ctx.listId}”. The wizard has no field for it, so ` +
        `the settings were read from ${ctx.fetchedFrom} and the next snippet ` +
        'will carry them inline.',
    )
  }

  if (ctx.flags.credit === undefined) {
    lost.push(
      'Whether the credit link was switched on. It is not part of the ' +
        'settings — it is a line in the snapshot the snippet carries — and ' +
        'this paste had no snapshot to read it from, so it has been left on.',
    )
  }

  return lost
}
