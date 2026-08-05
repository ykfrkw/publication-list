/**
 * The wizard shell.
 *
 * Holds one `WizardDraft`, projects it onto a `ListConfig` through
 * `draftToConfig`, and hands that to `useBuildList`. Everything with real
 * logic lives in `lib/` as plain functions; this file wires them to controls.
 *
 * Two behaviours worth knowing about:
 *
 *   - The draft is written to `localStorage` on every edit, so a half-built
 *     lab list survives a reload. Built lists are cached separately by
 *     `core/cache.ts`, keyed by `configHash`.
 *   - Editing an input while a build is in flight cancels the build. The
 *     alternative is showing the user a list assembled from a configuration
 *     they have already changed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookTextIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  SparklesIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { configHash } from '@/core/config'
import { parseNameList } from './lib/parse'
import {
  EXAMPLE_ORCID,
  MODES,
  type WizardDraft,
  type WizardMode,
  clearDraft,
  draftToConfig,
  emptyDraft,
  exampleDraft,
  hasNameQuery,
  isRunnable,
  loadDraft,
  saveDraft,
} from './lib/wizard'
import { useBuildList } from './hooks/useBuildList'
import {
  ArticleModeForm,
  LabModeForm,
  PersonModeForm,
} from './components/ModeForms'
import { SharedOptions } from './components/SharedOptions'
import { RunBar } from './components/RunBar'
import { WarningsPanel } from './components/WarningsPanel'
import { ReviewQueue } from './components/ReviewQueue'
import { ResultsPanel } from './components/ResultsPanel'
import { SnippetPanel } from './components/SnippetPanel'

export default function App() {
  const [draft, setDraft] = useState<WizardDraft>(() => loadDraft() ?? emptyDraft())
  const { state, run, cancel, reset } = useBuildList()

  const config = useMemo(() => draftToConfig(draft), [draft])
  const hash = configHash(config)
  const runnable = isRunnable(draft)

  // Persist on every edit. Cheap: the draft is a handful of strings.
  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  // A build in flight belongs to the config that started it. If the inputs
  // change underneath it, the result would be a list nobody asked for.
  const runningHash = useRef<string | null>(null)
  useEffect(() => {
    if (state.status !== 'running') {
      runningHash.current = null
      return
    }
    if (runningHash.current == null) runningHash.current = hash
    else if (runningHash.current !== hash) {
      runningHash.current = null
      cancel()
    }
  }, [hash, state.status, cancel])

  const update = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  const setMode = useCallback((mode: WizardMode) => {
    setDraft((prev) =>
      prev.mode === mode
        ? prev
        : {
            ...prev,
            mode,
            // A reference list is a flat numbered list; a CV is grouped.
            groupBy: mode === 'article' ? 'none' : 'category',
          },
    )
  }, [])

  const start = useCallback(() => {
    runningHash.current = hash
    void run(draftToConfig(draft))
  }, [draft, hash, run])

  const startExample = useCallback(() => {
    const next = exampleDraft()
    const nextConfig = draftToConfig(next)
    setDraft(next)
    runningHash.current = configHash(nextConfig)
    void run(nextConfig)
  }, [run])

  const startOver = useCallback(() => {
    reset()
    clearDraft()
    setDraft(emptyDraft(draft.mode))
  }, [draft.mode, reset])

  const model = state.model
  const boldNames = useMemo(() => parseNameList(draft.boldNames), [draft.boldNames])
  const showQueue =
    model != null && (model.candidates.length > 0 || hasNameQuery(model.config))

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-tight font-semibold sm:text-3xl">
          Publication List Generator
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Build a formatted publication list from ORCID, PubMed and researchmap,
          then paste it into an article or embed it on a lab website where it
          keeps itself up to date. No account, no server, nothing to install.
        </p>
      </header>

      <Tabs
        value={draft.mode}
        onValueChange={(value) => setMode(value as WizardMode)}
      >
        <TabsList className="w-full">
          {MODES.map((mode) => (
            <TabsTrigger
              key={mode.value}
              value={mode.value}
              // The three labels only just fit at 360 px at the default size.
              className="text-xs sm:text-sm"
            >
              {mode.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {MODES.map((mode) => (
          <TabsContent key={mode.value} value={mode.value}>
            <Card>
              <CardHeader>
                <CardTitle>{mode.label}</CardTitle>
                <CardDescription>{mode.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {mode.value === 'article' ? (
                  <ArticleModeForm draft={draft} update={update} />
                ) : null}
                {mode.value === 'person' ? (
                  <PersonModeForm draft={draft} update={update} />
                ) : null}
                {mode.value === 'lab' ? (
                  <LabModeForm draft={draft} update={update} />
                ) : null}

                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Formatting and filters
                  </summary>
                  <div className="pt-4">
                    <SharedOptions draft={draft} update={update} />
                  </div>
                </details>

                <RunBar
                  state={state}
                  canRun={runnable}
                  onRun={start}
                  onCancel={cancel}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {state.status === 'error' && state.error ? (
        <Alert variant="destructive">
          <AlertTitle>The build failed</AlertTitle>
          <AlertDescription>
            <p>{state.error}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {model == null && state.status !== 'running' ? (
        <EmptyState onTryExample={startExample} />
      ) : null}

      {model != null ? (
        <>
          {state.fromCache ? (
            <Alert>
              <AlertTitle>Showing your last result</AlertTitle>
              <AlertDescription>
                <p>
                  This list was cached in your browser and is being refreshed.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <WarningsPanel warnings={model.warnings} />

          {showQueue ? (
            <ReviewQueue
              candidates={model.candidates}
              suggested={model.suggested}
              style={model.config.style ?? 'vancouver'}
              boldNames={model.config.boldNames ?? boldNames}
              reviewPolicy={model.config.reviewPolicy ?? 'strict'}
              include={draft.include}
              exclude={draft.exclude}
              onApply={({ include, exclude }) => {
                const next = { ...draft, include, exclude }
                const nextConfig = draftToConfig(next)
                setDraft(next)
                runningHash.current = configHash(nextConfig)
                void run(nextConfig)
              }}
            />
          ) : null}

          <ResultsPanel model={model} />

          <SnippetPanel
            model={model}
            credit={draft.credit}
            configUrl={draft.configUrl}
            onCreditChange={(credit) => update({ credit })}
            onConfigUrlChange={(configUrl) => update({ configUrl })}
          />

          <div>
            <Button type="button" variant="ghost" size="sm" onClick={startOver}>
              <RotateCcwIcon />
              Start over
            </Button>
          </div>
        </>
      ) : null}

      <footer className="mt-auto flex flex-col gap-1 pt-6 text-xs text-muted-foreground">
        <p>
          Every request goes straight from your browser to ORCID, PubMed,
          researchmap, OpenAlex and Crossref. Nothing is uploaded anywhere, and
          your draft stays in this browser.
        </p>
        <p>
          <a
            className="underline underline-offset-2"
            href="https://yukifurukawa.jp/publication-list-generator/"
          >
            About this tool
            <ExternalLinkIcon className="ms-1 inline size-3 align-[-0.1em]" />
          </a>
          <span className="ms-2 opacity-60">config {hash}</span>
        </p>
      </footer>
    </div>
  )
}

function EmptyState({ onTryExample }: { onTryExample: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing built yet</CardTitle>
        <CardDescription>
          Paste some identifiers or an ORCID iD above and press Generate list.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <p>
            <strong className="text-foreground">Reference list</strong> — paste
            the PMIDs and DOIs you cite, get numbered output for WordPress, Word
            or Markdown.
          </p>
          <p>
            <strong className="text-foreground">My publications</strong> — seed
            it with your ORCID iD and get a snippet that updates itself.
          </p>
          <p>
            <strong className="text-foreground">Lab or group</strong> — paste a
            member list and review anything the tool is not sure about.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onTryExample}>
            <SparklesIcon />
            Try it with ORCID {EXAMPLE_ORCID}
          </Button>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <BookTextIcon className="size-3" />
            Loads a real list from the public ORCID API.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
