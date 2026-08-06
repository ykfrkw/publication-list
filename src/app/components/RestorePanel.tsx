/**
 * "Start from an existing snippet" — the paste-it-back panel.
 *
 * It sits above the mode tabs because that is the order of the decision: if
 * you already have a snippet, you are not choosing a mode, you are reopening
 * one you chose before.
 *
 * Two rules it holds to:
 *
 *   - **Nothing is generated.** Applying a paste fills the form and stops. The
 *     user reads what came back, fixes whatever the report says was lost, and
 *     presses Generate list themselves. See `restore.ts`.
 *   - **Work in progress is confirmed before it is replaced.** A restore
 *     overwrites every field, and `draftHasContent` is the test for whether
 *     there is anything there to overwrite.
 */

import { useState } from 'react'
import { ClipboardPasteIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RestoreError, restoreFromPaste, type RestoreResult } from '../lib/restore'
import { MODES, draftHasContent, type WizardDraft } from '../lib/wizard'

/** What each detected form is called in the confirmation message. */
const FORM_LABEL: Record<RestoreResult['form'], string> = {
  embed: 'script snippet',
  iframe: 'iframe snippet',
  list: 'hosted list',
}

export interface RestorePanelProps {
  draft: WizardDraft
  /** Adopt the restored draft. Must not start a build. */
  onRestore: (draft: WizardDraft) => void
  /** Injected in tests. */
  confirm?: (message: string) => boolean
}

export function RestorePanel({ draft, onRestore, confirm }: RestorePanelProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const restored = await restoreFromPaste(text)
      const ask = confirm ?? globalThis.confirm?.bind(globalThis)
      if (
        draftHasContent(draft) &&
        ask &&
        !ask(
          'Replace everything on this form with the settings from that snippet?',
        )
      ) {
        return
      }
      setResult(restored)
      onRestore(restored.draft)
    } catch (err) {
      setError(
        err instanceof RestoreError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'That could not be read.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Start from an existing snippet{' '}
        <span className="font-normal text-muted-foreground">
          — paste one back in to get its settings
        </span>
      </summary>
      <div className="flex flex-col gap-3 pt-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Paste the snippet you put on your site — the script one or the iframe
          one — and the form below is filled in from it. The snippet carries the
          whole configuration, so it is the only thing you need to keep. Nothing
          is fetched from ORCID or PubMed and no list is built: your settings
          appear below, and you press{' '}
          <strong className="font-medium text-foreground">Generate list</strong>{' '}
          when they look right.
        </p>
        <Textarea
          aria-label="Snippet to restore"
          className="min-h-24 font-mono text-xs"
          spellCheck={false}
          placeholder={'<div class="publist-embed" data-orcid="0000-…">…'}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || text.trim() === ''}
            onClick={() => void apply()}
          >
            <ClipboardPasteIcon />
            {busy ? 'Reading…' : 'Restore settings'}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <TriangleAlertIcon />
            <AlertTitle>That paste could not be read</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <Alert aria-live="polite">
            <AlertTitle>
              Settings restored from the {FORM_LABEL[result.form]} — opened in{' '}
              {MODES.find((mode) => mode.value === result.draft.mode)?.label ??
                result.draft.mode}
            </AlertTitle>
            <AlertDescription>
              <p>
                Nothing has been built yet. Check the form below, then press
                Generate list.
                {result.fetchedFrom ? ` Settings read from ${result.fetchedFrom}.` : ''}
              </p>
              {result.lost.length > 0 ? (
                <>
                  <p className="font-medium text-foreground">
                    What a snippet could not carry, so you may want to set it
                    again:
                  </p>
                  <ul className="flex list-disc flex-col gap-1 ps-4">
                    {result.lost.map((item) => (
                      <li key={item} className="break-words">
                        {item}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Every setting the snippet carries came back.</p>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </details>
  )
}
