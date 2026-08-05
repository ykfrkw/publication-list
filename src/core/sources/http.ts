/**
 * Shared HTTP plumbing for every upstream source.
 *
 * All five upstream APIs (ORCID, PubMed E-utilities, researchmap, OpenAlex,
 * Crossref) send `Access-Control-Allow-Origin: *`, so this module runs
 * unchanged in a visitor's browser with plain `fetch` — no proxy, no server,
 * no API keys.
 *
 * Framework-free: nothing here may import React or touch the DOM beyond the
 * standard `fetch` / `AbortController` globals.
 */

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
/** First backoff step; doubles per retry (300 ms, 600 ms, …). */
const RETRY_BASE_MS = 300

export interface GetJsonOptions {
  /** Caller-owned cancellation. Aborting never triggers a retry. */
  signal?: AbortSignal
  /** Retries *after* the first attempt. Default 2. */
  retries?: number
  /** Per-attempt timeout. Default 15 s. */
  timeoutMs?: number
  headers?: Record<string, string>
}

/** Read the `status` property an HTTP failure carries, if it has one. */
export function httpStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

/** Human-readable message for a caught value, for `warnings[]`. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** True when the failure is the caller cancelling, not the upstream failing. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/** `setTimeout` as a promise, rejecting early if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal?.reason))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * `GET` a JSON document.
 *
 * Retries twice with exponential backoff on network errors and 5xx; never
 * retries a 4xx (the request itself is wrong, repeating it only burns the
 * upstream's rate budget). Each attempt gets its own 15 s timeout, layered on
 * top of the caller's `AbortSignal`.
 *
 * Throws on failure — every call site in `sources/` wraps this and turns the
 * failure into a `warnings[]` entry rather than letting it escape.
 */
export async function getJson<T>(url: string, opts: GetJsonOptions = {}): Promise<T> {
  const {
    signal,
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers,
  } = opts

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted()
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1), signal)

    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    const timer = setTimeout(
      () => controller.abort(new Error(`Request timed out after ${timeoutMs} ms: ${url}`)),
      timeoutMs,
    )
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', ...headers },
      })
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), {
          status: res.status,
        })
      }
      return (await res.json()) as T
    } catch (err) {
      // The caller cancelled: propagate immediately, no retry.
      if (signal?.aborted) throw err
      const status = httpStatus(err)
      if (status !== undefined && status < 500) throw err
      lastError = err
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`)
}

export type RateLimitedRun = <T>(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>

/**
 * Serialize calls through a single queue, leaving at least `minGapMs` between
 * the *starts* of consecutive calls. Used to honour NCBI's 3 req/s limit
 * (no API key) and to keep Crossref calls polite; the first call runs
 * immediately.
 */
export function createRateLimiter(minGapMs: number): RateLimitedRun {
  let lastStart = 0
  let chain: Promise<unknown> = Promise.resolve()

  return function run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const result = chain.then(async () => {
      const wait = minGapMs - (Date.now() - lastStart)
      if (wait > 0) await sleep(wait, signal)
      lastStart = Date.now()
      return fn()
    })
    // Keep the queue alive even when one link rejects.
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** Split `items` into consecutive slices of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
