/**
 * Generate / Cancel, plus the progress readout.
 *
 * A real ORCID + researchmap + PubMed run takes several seconds and makes
 * calls to five different services, so this reports the stage it is on rather
 * than a spinner: "Enriching metadata (OpenAlex)" tells the user the tool is
 * alive and roughly how much is left, and a spinner tells them nothing.
 */

import { Loader2Icon, PlayIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
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
          {running ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
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
          <ProgressLabel>{state.message}</ProgressLabel>
          <ProgressValue />
        </Progress>
      ) : null}
    </div>
  )
}
