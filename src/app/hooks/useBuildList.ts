/**
 * Runs `buildList` for the wizard: progress, cancellation and the cache.
 *
 * The rules this encodes:
 *
 *   - One run at a time. Starting a run aborts the previous one.
 *   - The `AbortController` is aborted on unmount, and by `cancel()` — which
 *     `App.tsx` also calls when the inputs change while a run is in flight, so
 *     a list is never assembled from a config the user has already edited.
 *   - Progress is reported as a stage name, not a spinner. An ORCID +
 *     researchmap run takes seconds and the user deserves to know which of the
 *     five upstreams it is waiting on.
 *   - The cache is `core/cache.ts`, keyed by `configHash`. No second layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { configHash } from '@/core/config'
import { readCacheEntry, writeCache, isStale } from '@/core/cache'
import { buildList } from '@/core/pipeline'
import type { ListConfig, ListModel } from '@/core/types'

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface RunState {
  status: RunStatus
  /** 0–100 */
  pct: number
  /** current stage, e.g. "Enriching metadata (OpenAlex)" */
  message: string
  model: ListModel | null
  /** true while `model` is a cached result being refreshed in the background */
  fromCache: boolean
  error: string | null
}

const IDLE: RunState = {
  status: 'idle',
  pct: 0,
  message: '',
  model: null,
  fromCache: false,
  error: null,
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

export interface UseBuildList {
  state: RunState
  /** Build `config`. Aborts any run already in flight. */
  run: (config: ListConfig) => Promise<void>
  /** Abort the run in flight, if any. */
  cancel: () => void
  /** Drop the current result and go back to the empty state. */
  reset: () => void
  /** Replace the model in place, without a rebuild (used by the review queue). */
  setModel: (model: ListModel) => void
}

export function useBuildList(): UseBuildList {
  const [state, setState] = useState<RunState>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  /** Guards against a slow earlier run overwriting a later one's result. */
  const runIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    if (!controllerRef.current) return
    controllerRef.current.abort()
    controllerRef.current = null
    if (!mountedRef.current) return
    setState((prev) =>
      prev.status === 'running'
        ? { ...prev, status: 'cancelled', message: 'Cancelled' }
        : prev,
    )
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(IDLE)
  }, [])

  const setModel = useCallback((model: ListModel) => {
    setState((prev) => ({ ...prev, model, fromCache: false }))
  }, [])

  const run = useCallback(async (config: ListConfig) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const runId = ++runIdRef.current

    const key = configHash(config)
    const cached = readCacheEntry(key)

    setState({
      status: 'running',
      pct: cached ? 5 : 0,
      message: cached
        ? 'Showing the last result while it refreshes'
        : 'Starting',
      model: cached?.model ?? null,
      fromCache: cached != null && isStale(cached),
      error: null,
    })

    try {
      const model = await buildList(config, {
        signal: controller.signal,
        onProgress: (pct, message) => {
          if (!mountedRef.current || runId !== runIdRef.current) return
          setState((prev) =>
            prev.status === 'running' ? { ...prev, pct, message } : prev,
          )
        },
      })
      if (!mountedRef.current || runId !== runIdRef.current) return
      writeCache(key, model)
      setState({
        status: 'done',
        pct: 100,
        message: 'Done',
        model,
        fromCache: false,
        error: null,
      })
    } catch (err) {
      if (!mountedRef.current || runId !== runIdRef.current) return
      if (isAbort(err)) {
        setState((prev) => ({ ...prev, status: 'cancelled', message: 'Cancelled' }))
        return
      }
      setState((prev) => ({
        ...prev,
        status: 'error',
        message: '',
        error: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [])

  return { state, run, cancel, reset, setModel }
}
