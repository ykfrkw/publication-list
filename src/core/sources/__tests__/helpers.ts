/**
 * Test-only helpers: fixture loading and a `fetch` stub.
 *
 * The fixtures under `./fixtures/` were captured from the live APIs on
 * 2026-08-05 and trimmed to a handful of records. Tests never touch the
 * network — `globalThis.fetch` is replaced for the duration of each test.
 */

import { vi } from 'vitest'

// `import.meta.glob` rather than `node:fs`: `tsconfig.app.json` pins
// `types: ["vite/client"]`, so Node's typings are not in scope here, and the
// app config also has `resolveJsonModule` off, so a static JSON import would
// not typecheck either.
const FIXTURES = import.meta.glob('./fixtures/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

/** Load a captured API response. Each caller gets its own copy. */
export function loadFixture<T>(name: string): T {
  const data = FIXTURES[`./fixtures/${name}`]
  if (data === undefined) {
    throw new Error(`Unknown fixture "${name}". Available: ${Object.keys(FIXTURES).join(', ')}`)
  }
  return structuredClone(data) as T
}

export interface FetchStub {
  /** Every URL the code under test requested, in order. */
  calls: string[]
  restore: () => void
}

export type FetchHandler = (url: string) => unknown | Promise<unknown>

/** JSON body, or an explicit HTTP status. */
export function httpStatusResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Replace `globalThis.fetch`. The handler receives the request URL and returns
 * either a plain object (serialized as a 200 JSON body) or a `Response`.
 */
export function stubFetch(handler: FetchHandler): FetchStub {
  const original = globalThis.fetch
  const calls: string[] = []

  const stub = vi.fn(async (input: unknown): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    const result = await handler(url)
    if (result instanceof Response) return result
    return httpStatusResponse(200, result)
  })

  globalThis.fetch = stub as unknown as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}
