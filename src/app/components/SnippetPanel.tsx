/**
 * The embed snippet generator.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CREDIT LINK — the checkbox below flips exactly one boolean, the `credit`
 * option of `renderHtml`. The anchor text and href are constants in
 * `src/core/render.ts` and are never editable from the UI. Turning the
 * checkbox off must not restrict anything: same formats, same snippet, same
 * live updating, no reminder to turn it back on.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { serializeConfig } from '@/core/config'
import type { ListModel } from '@/core/types'
import { CheckboxField, Field } from './Field'
import { CopyButton, DownloadButton } from './CopyButton'
import {
  CONFIG_FILENAME,
  INLINE_ATTR_BUDGET,
  buildEmbedSnippet,
  buildIframeSnippet,
  hasCommaHostileValues,
  inlineAttributeLength,
} from '../lib/snippet'

function SnippetBlock({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">
      <code>{value}</code>
    </pre>
  )
}

export function SnippetPanel({
  model,
  credit,
  configUrl,
  onCreditChange,
  onConfigUrlChange,
}: {
  model: ListModel
  credit: boolean
  configUrl: string
  onCreditChange: (credit: boolean) => void
  onConfigUrlChange: (url: string) => void
}) {
  const hosted = configUrl.trim() !== ''

  const snippet = useMemo(
    () => buildEmbedSnippet(model, { credit, configUrl: hosted ? configUrl : undefined }),
    [model, credit, configUrl, hosted],
  )
  const iframeSnippet = useMemo(
    () =>
      buildIframeSnippet(model.config, {
        configUrl: hosted ? configUrl : undefined,
      }),
    [model.config, configUrl, hosted],
  )
  const configJson = useMemo(() => serializeConfig(model.config), [model.config])

  const attrLength = inlineAttributeLength(model.config)
  const bulky = attrLength > INLINE_ATTR_BUDGET
  const commaHostile = hasCommaHostileValues(model.config)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embed on a website</CardTitle>
        <CardDescription>
          The snippet carries a snapshot of the list as it stands right now, so
          it is readable by search engines and by visitors with JavaScript
          turned off. The script replaces it with a freshly fetched list every
          time the page loads.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CheckboxField
          checked={credit}
          onChange={onCreditChange}
          label="Include a credit link"
          hint="Adds one line under the list: “Auto-updated with Publication List Generator”. It becomes part of your own HTML, so you can edit or delete it at any time. Everything works exactly the same with this turned off."
        />

        {bulky || commaHostile ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>This configuration is large for inline attributes</AlertTitle>
            <AlertDescription>
              <p>
                {commaHostile
                  ? 'One of your values contains a comma, which the comma-separated data attributes cannot carry.'
                  : `The inline attributes come to about ${attrLength} characters.`}{' '}
                Download <code>{CONFIG_FILENAME}</code> below, host it anywhere
                that serves it publicly — a GitHub Gist raw URL works — and paste
                the URL here to get a one-attribute snippet instead.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Field
          label="Hosted pubs.json URL (optional)"
          hint="With a URL here the snippet carries a single data-config attribute and reads everything else from that file, so you can change the list later without touching the page."
        >
          {(id) => (
            <Input
              id={id}
              value={configUrl}
              spellCheck={false}
              placeholder="https://gist.githubusercontent.com/…/pubs.json"
              onChange={(e) => onConfigUrlChange(e.currentTarget.value)}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Script snippet</h3>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={snippet} label="Copy snippet" />
              <DownloadButton
                filename={CONFIG_FILENAME}
                value={configJson}
                label="pubs.json"
                mime="application/json;charset=utf-8"
              />
            </div>
          </div>
          <SnippetBlock value={snippet} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              iframe snippet{' '}
              <span className="font-normal text-muted-foreground">
                — for a CMS that strips scripts
              </span>
            </h3>
            <CopyButton value={iframeSnippet} label="Copy iframe" />
          </div>
          <SnippetBlock value={iframeSnippet} />
        </div>
      </CardContent>
    </Card>
  )
}
