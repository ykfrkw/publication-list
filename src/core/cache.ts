/**
 * `localStorage` stale-while-revalidate cache for built lists.
 *
 * Keyed by `configHash(config)` from `config.ts`, namespaced under `publist:`.
 *
 * Two rules govern everything here:
 *
 * 1. **A cache failure must never break rendering.** This code runs on other
 *    people's pages, in private windows, with cookies disabled, with storage
 *    full, and inside sandboxed iframes where merely *touching*
 *    `window.localStorage` throws a `SecurityError`. Every access is wrapped;
 *    a failure degrades to "no cache", never to an exception reaching the
 *    embed.
 * 2. **Reads return stale entries.** The point of the cache is that a visitor
 *    sees last run's list instantly while the live fetch runs. Deciding what to
 *    do with an old entry belongs to the caller, so `readCache` hands it over
 *    and `isStale` tells them how old it is.
 */

import type { ListModel } from './types'

export const CACHE_PREFIX = 'publist:'

/** Entries older than this are stale — still returned, but worth refreshing. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Payload cap. A list of a few hundred publications serializes to well under
 * this; anything bigger would crowd out the host page's own storage, and the
 * whole 5 MB origin quota belongs to them, not to us.
 */
export const MAX_CACHE_BYTES = 200_000

export interface CacheEntry {
  /** entry format version, so a future change can invalidate instead of crash */
  v: 1
  /** `Date.now()` at write time */
  savedAt: number
  model: ListModel
}

/**
 * `localStorage`, or `null` when it is unavailable.
 *
 * Not cached in a module-level variable: availability can change between calls
 * (a quota that frees up, a permission the user grants), and a stale `null`
 * would disable the cache for the life of the page.
 */
function storage(): Storage | null {
  try {
    const store = globalThis.localStorage
    return store ?? null
  } catch {
    // Accessing the property itself throws in a sandboxed iframe.
    return null
  }
}

function storageKey(key: string): string {
  return `${CACHE_PREFIX}${key}`
}

/** Is this entry past its TTL? Callers decide what that means for them. */
export function isStale(entry: CacheEntry, now: number = Date.now()): boolean {
  if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) {
    return true
  }
  return now - entry.savedAt > CACHE_TTL_MS
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<CacheEntry>
  if (entry.v !== 1) return false
  if (typeof entry.savedAt !== 'number') return false
  const model = entry.model as Partial<ListModel> | undefined
  if (typeof model !== 'object' || model === null) return false
  return Array.isArray(model.publications)
}

/**
 * Read the full entry, stale or not. `null` when absent, unreadable, or
 * written by an incompatible version.
 */
export function readCacheEntry(key: string): CacheEntry | null {
  const store = storage()
  if (!store) return null

  let raw: string | null
  try {
    raw = store.getItem(storageKey(key))
  } catch {
    return null
  }
  if (raw == null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isCacheEntry(parsed)) {
      remove(key)
      return null
    }
    return parsed
  } catch {
    // Corrupt JSON: drop it rather than keep failing on every page view.
    remove(key)
    return null
  }
}

/**
 * The cached model for `key`, **including stale ones**.
 *
 * Pair it with `readCacheEntry` + `isStale` when the age matters.
 */
export function readCache(key: string): ListModel | null {
  return readCacheEntry(key)?.model ?? null
}

function remove(key: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(storageKey(key))
  } catch {
    /* nothing useful to do */
  }
}

/** Every `publist:` key currently in storage, oldest write first. */
function ownKeysOldestFirst(store: Storage): string[] {
  const entries: { key: string; savedAt: number }[] = []
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key == null || !key.startsWith(CACHE_PREFIX)) continue
      let savedAt = 0
      try {
        const parsed: unknown = JSON.parse(store.getItem(key) ?? 'null')
        if (isCacheEntry(parsed)) savedAt = parsed.savedAt
      } catch {
        // Unparseable entries sort first — they are the best thing to evict.
      }
      entries.push({ key, savedAt })
    }
  } catch {
    return []
  }
  return entries.sort((a, b) => a.savedAt - b.savedAt).map((e) => e.key)
}

/**
 * Store a model under `key`.
 *
 * Silently does nothing when storage is unavailable or the payload is over
 * `MAX_CACHE_BYTES`. On a quota error it evicts its own oldest entries, one at
 * a time, and retries — it never touches keys outside the `publist:` namespace,
 * because the rest of that origin's storage belongs to the host page.
 */
export function writeCache(key: string, model: ListModel): void {
  const store = storage()
  if (!store) return

  let payload: string
  try {
    const entry: CacheEntry = { v: 1, savedAt: Date.now(), model }
    payload = JSON.stringify(entry)
  } catch {
    return
  }
  if (payload.length > MAX_CACHE_BYTES) return

  const target = storageKey(key)
  for (let attempt = 0; ; attempt++) {
    try {
      store.setItem(target, payload)
      return
    } catch {
      // Almost certainly QuotaExceededError. Evict our own oldest entry and
      // try again; give up once there is nothing of ours left to drop.
      const candidates = ownKeysOldestFirst(store).filter((k) => k !== target)
      if (candidates.length === 0 || attempt > 50) return
      try {
        store.removeItem(candidates[0])
      } catch {
        return
      }
    }
  }
}

/** Drop every `publist:` entry. Used by the wizard's "clear cache" action. */
export function clearCache(): void {
  const store = storage()
  if (!store) return
  for (const key of ownKeysOldestFirst(store)) {
    try {
      store.removeItem(key)
    } catch {
      return
    }
  }
}
