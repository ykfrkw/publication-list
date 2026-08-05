import { afterEach, describe, expect, it } from 'vitest'

import { chunk, getJson, httpStatus } from '../http'
import { httpStatusResponse, stubFetch } from './helpers'

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('chunk', () => {
  it('splits into consecutive slices', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 50)).toEqual([])
  })
})

describe('getJson', () => {
  it('retries a 5xx and returns the eventual success', async () => {
    let call = 0
    const stub = stubFetch(() => {
      call += 1
      if (call < 3) return httpStatusResponse(503, { error: 'busy' })
      return { ok: true }
    })
    restore = stub.restore

    await expect(getJson<{ ok: boolean }>('https://example.test/x')).resolves.toEqual({
      ok: true,
    })
    expect(stub.calls).toHaveLength(3)
  })

  it('does not retry a 4xx', async () => {
    const stub = stubFetch(() => httpStatusResponse(400, { error: 'bad' }))
    restore = stub.restore

    await expect(getJson('https://example.test/x')).rejects.toThrow(/HTTP 400/)
    expect(stub.calls).toHaveLength(1)
  })

  it('gives up after the retry budget and reports the last status', async () => {
    const stub = stubFetch(() => httpStatusResponse(500))
    restore = stub.restore

    const err = await getJson('https://example.test/x', { retries: 1 }).catch((e: unknown) => e)
    expect(httpStatus(err)).toBe(500)
    expect(stub.calls).toHaveLength(2)
  })

  it('propagates caller cancellation without retrying', async () => {
    const controller = new AbortController()
    const stub = stubFetch(() => {
      controller.abort()
      return httpStatusResponse(500)
    })
    restore = stub.restore

    await expect(
      getJson('https://example.test/x', { signal: controller.signal }),
    ).rejects.toThrow()
    expect(stub.calls).toHaveLength(1)
  })

  it('sends Accept: application/json', async () => {
    let seen: HeadersInit | undefined
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen = init?.headers
      return httpStatusResponse(200, {})
    }) as unknown as typeof fetch
    restore = () => {
      globalThis.fetch = original
    }

    await getJson('https://example.test/x')
    expect(seen).toMatchObject({ Accept: 'application/json' })
  })
})
