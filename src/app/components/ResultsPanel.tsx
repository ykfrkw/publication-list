/**
 * The rendered list plus one control per output format.
 *
 * Every format comes from `src/core/render.ts`. Nothing here re-implements
 * citation formatting, grouping or escaping — the whole point of that module
 * is that the wizard's Markdown and the embed script's HTML are the same list.
 *
 * The preview carries no credit block: this is a preview inside the tool, not a
 * page anyone publishes. The credit belongs to the copyable output, and only
 * there.
 *
 * The preview itself is `PreviewList` — the same groups and citations as every
 * other output, composed in JSX so each publication can carry a Remove control.
 * See the header of that file for why it is not `renderHtml`. Everything the
 * buttons in this panel copy or download still comes from `core/render.ts` and
 * has no idea the controls exist.
 *
 * The source disclaimer is different and *does* appear in the preview: it is a
 * `ListConfig` field rather than a snippet option, so it is part of the list
 * being previewed. Its checkbox reaches here through `model.config` — see the
 * `outputModel` comment in `App.tsx` — which is what makes ticking the box
 * change the preview, the static HTML and the snippet at once.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE STATIC HTML OUTPUT
 *
 * `renderHtml(model, { credit })` and nothing else: no `.publist-embed`
 * wrapper, no `data-*` attributes, no `<script>` tag. It is a finished list to
 * paste once into a CMS or a hand-written page, and it never updates itself —
 * which is the whole trade and why the control says so out loud.
 *
 * It takes the same `credit` boolean as the embed snippets, from the same
 * single checkbox in `SnippetPanel`. There is deliberately no second credit
 * control here, and this file does not build the anchor: the markup is a
 * constant in `src/core/render.ts`, the same one every other route emits.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { TriangleAlertIcon, Undo2Icon } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { serializeConfig } from '@/core/config'
import {
  renderBibtex,
  renderClipboard,
  renderHtml,
  renderMarkdown,
  renderRis,
  renderWordpressBlocks,
} from '@/core/render'
import type { ListModel, Publication } from '@/core/types'
import { CopyButton, DownloadButton } from './CopyButton'
import { PreviewList } from './PreviewList'
import { copyRich } from '../lib/clipboard'
import { diagnoseEmptyList } from '../lib/diagnose'
import { CONFIG_FILENAME } from '../lib/snippet'
import type { RemovedEntry } from '../lib/wizard'

export function ResultsPanel({
  model,
  credit,
  onRemove,
  removed = [],
  onRestore,
}: {
  model: ListModel
  /** The "Include a credit link" checkbox, shared with the embed snippets. */
  credit: boolean
  /** Take one publication off the list. Omit to render a read-only preview. */
  onRemove?: (pub: Publication) => void
  /** Everything currently excluded, so a removal is never invisible. */
  removed?: RemovedEntry[]
  /** Undo one removal. */
  onRestore?: (ref: string) => void
}) {
  const staticHtml = useMemo(() => renderHtml(model, { credit }), [model, credit])
  const count = model.publications.length
  const empty = useMemo(() => diagnoseEmptyList(model), [model])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Your list{' '}
          <Badge variant="secondary">
            {count} publication{count === 1 ? '' : 's'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Generated {new Date(model.generatedAt).toLocaleString()} from{' '}
          {model.members.length > 0
            ? `${model.members.length} profile${model.members.length === 1 ? '' : 's'}`
            : 'the identifiers you pasted'}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/*
          First thing in the panel, above the copy buttons, because an empty
          list is the one result where every control below it is a trap: each
          one copies an empty list, and the snippet copies one that would stay
          empty on the page for ever. What is wrong and what fixes it are in
          `../lib/diagnose.ts` — three causes, three different remedies.
        */}
        {empty ? (
          <Alert variant="destructive" aria-live="polite">
            <TriangleAlertIcon />
            <AlertTitle>{empty.title}</AlertTitle>
            <AlertDescription>
              <p>{empty.body}</p>
              {empty.filters.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 ps-4">
                  {empty.filters.map((filter) => (
                    <li key={filter} className="break-words">
                      {filter}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <CopyButton
            label="Copy All (for Word)"
            variant="default"
            value=""
            onCopy={() => copyRich(renderClipboard(model))}
          />
          <CopyButton
            label="WordPress blocks"
            value={() => renderWordpressBlocks(model)}
          />
          <CopyButton label="Static HTML (no auto-update)" value={staticHtml} />
          <CopyButton label="Markdown" value={() => renderMarkdown(model)} />
          <CopyButton label="BibTeX" value={() => renderBibtex(model)} />
          <CopyButton label="RIS" value={() => renderRis(model)} />
          <DownloadButton
            filename="publications.bib"
            value={() => renderBibtex(model)}
            label=".bib"
            mime="application/x-bibtex;charset=utf-8"
          />
          <DownloadButton
            filename="publications.ris"
            value={() => renderRis(model)}
            label=".ris"
            mime="application/x-research-info-systems;charset=utf-8"
          />
          <DownloadButton
            filename={CONFIG_FILENAME}
            value={() => serializeConfig(model.config)}
            label={CONFIG_FILENAME}
            mime="application/json;charset=utf-8"
          />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Static HTML</strong> is
          the finished list as plain markup — no script, no attributes, paste it
          anywhere. It is a snapshot of today and will not update itself; for a
          list that keeps itself current, use the embed snippet below.
        </p>

        <Separator />

        <RemovedList entries={removed} onRestore={onRestore} />

        {count === 0 ? (
          // The alert at the top of this panel has already said what is wrong
          // and what to do about it; a second, vaguer paragraph down here would
          // only compete with it.
          <p className="text-sm text-muted-foreground">
            There is nothing to preview.
          </p>
        ) : (
          // The disclaimer gets spacing here and nothing else: its size and its
          // muting arrive on the element itself, from the same constants the
          // copied output carries, so the preview cannot show one treatment
          // while the snippet pastes another.
          <div className="publist-preview text-sm leading-relaxed [&_.publist-disclaimer]:mt-4 [&_.publist-heading]:mt-4 [&_.publist-heading]:mb-1.5 [&_.publist-heading]:font-medium [&_.publist-heading:first-child]:mt-0 [&_.publist-subheading]:mt-3 [&_.publist-subheading]:mb-1 [&_.publist-subheading]:text-xs [&_.publist-subheading]:font-medium [&_.publist-subheading]:text-muted-foreground [&_a]:underline [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:ps-5">
            <PreviewList model={model} onRemove={onRemove} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * What has been taken off the list, and how to put it back.
 *
 * This exists because the alternative is a paper silently missing from
 * somebody's CV. A removal is one click and its effect is invisible — the
 * record is simply not there any more — so the count is stated in words, every
 * entry is named, and each one has an undo. The `<details>` is closed by
 * default but its summary is not: "3 removed" is on screen whether or not
 * anyone opens it.
 *
 * It lists everything in `exclude`, not only what the Remove button put there,
 * because `exclude` is the whole set of records being kept off the page —
 * rejections from the review queue and hand-edited config entries included. See
 * `removedEntries` in `../lib/wizard.ts`.
 */
function RemovedList({
  entries,
  onRestore,
}: {
  entries: RemovedEntry[]
  onRestore?: (ref: string) => void
}) {
  if (entries.length === 0 || onRestore == null) return null

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {entries.length} removed
      </summary>
      <div className="flex flex-col gap-2 pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          These are kept off the list and out of everything you copy or embed,
          whatever else pins them. Undo puts one back where it was.
        </p>
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li
              key={entry.ref}
              className="flex items-start gap-2 rounded-md border border-border p-2"
            >
              <div className="flex min-w-0 grow flex-col">
                <span className="text-sm leading-snug">{entry.label}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {entry.ref}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Undo removing “${entry.label}”`}
                onClick={() => onRestore(entry.ref)}
              >
                <Undo2Icon />
                Undo
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
