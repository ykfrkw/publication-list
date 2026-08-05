/**
 * The rendered list plus one control per output format.
 *
 * Every format comes from `src/core/render.ts`. Nothing here re-implements
 * citation formatting, grouping or escaping — the whole point of that module
 * is that the wizard's Markdown and the embed script's HTML are the same list.
 *
 * The preview is rendered with `credit: false`: this is a preview inside the
 * tool, not a page anyone publishes. The credit block belongs to the copyable
 * snippet, and only there.
 */

import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import type { ListModel } from '@/core/types'
import { CopyButton, DownloadButton } from './CopyButton'
import { copyRich } from '../lib/clipboard'
import { CONFIG_FILENAME } from '../lib/snippet'

export function ResultsPanel({ model }: { model: ListModel }) {
  const previewHtml = useMemo(() => renderHtml(model, { credit: false }), [model])
  const count = model.publications.length

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

        <Separator />

        {count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing came back. Check the warnings above — with the default review
            policy, records that only a name search found are held back until you
            confirm them in the review queue.
          </p>
        ) : (
          <div
            className="publist-preview text-sm leading-relaxed [&_.publist-heading]:mt-4 [&_.publist-heading]:mb-1.5 [&_.publist-heading]:font-medium [&_.publist-heading:first-child]:mt-0 [&_a]:underline [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:ps-5"
            // Escaped upstream by `format.ts`; the only markup in here is
            // <section>/<h3>/<ol>/<li>, <b>, <em> and doi.org / PubMed links.
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </CardContent>
    </Card>
  )
}
