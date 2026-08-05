/**
 * Generate / Cancel, plus the progress readout.
 *
 * A real ORCID + researchmap + PubMed run takes several seconds and makes
 * calls to five different services, so this shows a spinner *and* the stage it
 * is on: the spinner says the tool is alive, and "Enriching metadata
 * (OpenAlex)" plus the percentage says how far along it is. A bare spinner
 * would answer only the first question, and several seconds of silence
 * answered neither — which is what this replaced.
 *
 * The spinner respects `prefers-reduced-motion` (see `Spinner`); when the
 * animation is suppressed the progress bar, the stage name and the percentage
 * are all still there, so nothing is only conveyed by movement.
 *
 * Cancel stays on screen for the whole run, next to the disabled Generate
 * button, so there is never a moment where the only thing to do is wait.
 */

import { PlayIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { Spinner } from './Spinner'
import type { RunState } from '../hooks/useBuildList'

export function RunBar({
  state,
  canRun,
  onRun,
  onCancel,
}: {
  state: RunState
  canRun: boolean
  onRun: () => void
  onCancel: () => void
}) {
  const running = state.status === 'running'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onRun} disabled={!canRun || running}>
          {running ? <Spinner /> : <PlayIcon />}
          {running ? 'Building…' : 'Generate list'}
        </Button>
        {running ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            <XIcon />
            Cancel
          </Button>
        ) : null}
        {!canRun ? (
          <span className="text-xs text-muted-foreground">
            Add at least one seed or identifier first.
          </span>
        ) : null}
        {state.status === 'cancelled' ? (
          <span className="text-xs text-muted-foreground">Cancelled.</span>
        ) : null}
      </div>

      {running ? (
        <Progress value={state.pct} aria-label="Build progress">
          <span className="flex min-w-0 items-center gap-2">
            <Spinner className="text-muted-foreground" />
            <ProgressLabel>{state.message}</ProgressLabel>
          </span>
          <ProgressValue />
        </Progress>
      ) : null}
    </div>
  )
}
