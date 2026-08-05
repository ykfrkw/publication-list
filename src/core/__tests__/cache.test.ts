/**
 * `cache.ts` — TTL, staleness, and (mostly) what happens when `localStorage`
 * misbehaves. The failure modes are the point: this code runs in private
 * windows, with cookies disabled, in sandboxed iframes and against a full
 * quota, and none of those may reach the embed as an exception.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  CACHE_PREFIX,
  CACHE_TTL_MS,
  MAX_CACHE_BYTES,
  clearCache,
  isStale,
  readCache,
  readCacheEntry,
  writeCache,
} from '../cache'
import { normalizeConfig } from '../config'
import type { ListModel, Publication } from '../types'

/** Minimal in-memory `Storage`. */
class MemoryStorage {
  map = new Map<string, string>()
  /** when set, `setItem` throws it (quota simulation) */
  failSet: Error | null = null
  /** when true, `getItem` throws */
  failGet = false

  get length(): number {
    return this.map.size
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('getItem is not available')
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw this.failSet
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function install(store: MemoryStorage | null): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })
}

/** Reading the property itself throws — a sandboxed iframe does this. */
function installThrowing(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('SecurityError: access to localStorage is denied')
    },
    configurable: true,
  })
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

function publication(key: string): Publication {
  return {
    key,
    title: 'A title',
    authors: ['Furukawa Y'],
    authorsFull: ['Yuki Furukawa'],
    journal: 'BMJ',
    year: 2024,
    sources: ['orcid'],
    seedIds: ['0000-0003-1317-0220'],
    trust: 'confirmed',
    category: 'original',
  }
}

function model(): ListModel {
  return {
    config: normalizeConfig({ seeds: { orcid: ['0000-0003-1317-0220'] } }),
    members: [],
    publications: [publication('doi:10.1136/bmj.n71')],
    candidates: [],
    warnings: [],
    generatedAt: '2026-08-05T00:00:00.000Z',
  }
}

describe('read / write round trip', () => {
  it('stores and returns a model under the publist: namespace', () => {
    const store = new MemoryStorage()
    install(store)

    writeCache('abcd1234', model())

    expect([...store.map.keys()]).toEqual([`${CACHE_PREFIX}abcd1234`])
    expect(readCache('abcd1234')?.publications[0].key).toBe('doi:10.1136/bmj.n71')
  })

  it('returns null for a key that was never written', () => {
    install(new MemoryStorage())
    expect(readCache('missing')).toBeNull()
    expect(readCacheEntry('missing')).toBeNull()
  })

  it('survives a JSON round trip of the suggested-candidate list', () => {
    install(new MemoryStorage())
    const withSuggested: ListModel = { ...model(), suggested: ['pmid:1', 'pmid:2'] }
    writeCache('k', withSuggested)
    expect(readCache('k')?.suggested).toEqual(['pmid:1', 'pmid:2'])
  })
})

describe('TTL and staleness', () => {
  it('reports a fresh entry as not stale', () => {
    install(new MemoryStorage())
    writeCache('k', model())
    const entry = readCacheEntry('k')
    expect(entry).not.toBeNull()
    expect(isStale(entry!)).toBe(false)
  })

  it('reports an entry past the 24 h TTL as stale', () => {
    install(new MemoryStorage())
    writeCache('k', model())
    const entry = readCacheEntry('k')!
    expect(isStale(entry, entry.savedAt + CACHE_TTL_MS + 1)).toBe(true)
    expect(isStale(entry, entry.savedAt + CACHE_TTL_MS - 1)).toBe(false)
  })

  it('still returns a stale entry — the caller decides', () => {
    const store = new MemoryStorage()
    install(store)
    writeCache('k', model())

    const raw = JSON.parse(store.map.get(`${CACHE_PREFIX}k`)!) as {
      savedAt: number
    }
    raw.savedAt = Date.now() - CACHE_TTL_MS * 10
    store.map.set(`${CACHE_PREFIX}k`, JSON.stringify(raw))

    const entry = readCacheEntry('k')!
    expect(isStale(entry)).toBe(true)
    expect(readCache('k')).not.toBeNull()
  })
})

describe('graceful degradation', () => {
  it('does nothing when localStorage is absent', () => {
    install(null)
    expect(() => writeCache('k', model())).not.toThrow()
    expect(readCache('k')).toBeNull()
  })

  it('does nothing when touching localStorage throws', () => {
    installThrowing()
    expect(() => writeCache('k', model())).not.toThrow()
    expect(readCache('k')).toBeNull()
    expect(() => clearCache()).not.toThrow()
  })

  it('swallows a getItem failure', () => {
    const store = new MemoryStorage()
    install(store)
    writeCache('k', model())
    store.failGet = true
    expect(readCache('k')).toBeNull()
  })

  it('drops a corrupt entry instead of failing on every page view', () => {
    const store = new MemoryStorage()
    install(store)
    store.map.set(`${CACHE_PREFIX}k`, '{not json')

    expect(readCache('k')).toBeNull()
    expect(store.map.has(`${CACHE_PREFIX}k`)).toBe(false)
  })

  it('rejects an entry written by an incompatible version', () => {
    const store = new MemoryStorage()
    install(store)
    store.map.set(`${CACHE_PREFIX}k`, JSON.stringify({ v: 2, savedAt: 1, model: {} }))
    expect(readCache('k')).toBeNull()
  })
})

describe('size cap and quota pruning', () => {
  it('skips a payload above the cap rather than evicting the host page', () => {
    const store = new MemoryStorage()
    install(store)

    const big: ListModel = {
      ...model(),
      warnings: [' '.repeat(MAX_CACHE_BYTES + 1000)],
    }
    writeCache('k', big)
    expect(store.map.size).toBe(0)
  })

  it('prunes its own oldest entries on a quota error and leaves other keys alone', () => {
    const store = new MemoryStorage()
    install(store)

    store.map.set('someone-elses-key', 'do not touch me')
    store.map.set(
      `${CACHE_PREFIX}old`,
      JSON.stringify({ v: 1, savedAt: 1000, model: { publications: [] } }),
    )
    store.map.set(
      `${CACHE_PREFIX}newer`,
      JSON.stringify({ v: 1, savedAt: 9000, model: { publications: [] } }),
    )

    // Fail once, then succeed — the retry must land after one eviction.
    let calls = 0
    const realSet = store.setItem.bind(store)
    store.setItem = (key: string, value: string) => {
      calls++
      if (calls === 1) throw new Error('QuotaExceededError')
      realSet(key, value)
    }

    writeCache('fresh', model())

    expect(store.map.has(`${CACHE_PREFIX}old`)).toBe(false)
    expect(store.map.has(`${CACHE_PREFIX}newer`)).toBe(true)
    expect(store.map.has(`${CACHE_PREFIX}fresh`)).toBe(true)
    expect(store.map.get('someone-elses-key')).toBe('do not touch me')
  })

  it('gives up rather than looping when there is nothing left to evict', () => {
    const store = new MemoryStorage()
    install(store)
    store.failSet = new Error('QuotaExceededError')

    expect(() => writeCache('k', model())).not.toThrow()
    expect(store.map.size).toBe(0)
  })
})

describe('clearCache', () => {
  it('removes only publist: keys', () => {
    const store = new MemoryStorage()
    install(store)
    writeCache('a', model())
    writeCache('b', model())
    store.map.set('unrelated', 'keep')

    clearCache()

    expect([...store.map.keys()]).toEqual(['unrelated'])
  })
})
