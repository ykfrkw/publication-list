/**
 * The embed snippet generator.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CREDIT LINK — the checkbox below flips exactly one boolean. It reaches the
 * script snippet as the `credit` option of `renderHtml` and the iframe snippet
 * as `credit=0` in the frame's URL, so both routes obey it. The anchor text
 * and href are constants in `src/core/render.ts` and are never editable from
 * the UI. Turning the checkbox off must not restrict anything: same formats,
 * same snippets, same live updating, no reminder to turn it back on.
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

/**
 * The hosted-`pubs.json` route, explained where it is used.
 *
 * Two sentences, because the concept is not guessable from a URL field: what
 * the file is, where it can live, and the thing that makes it worth the
 * trouble — one file to edit instead of one snippet to re-paste per page.
 */
function HostedConfig({
  configUrl,
  configJson,
  onConfigUrlChange,
}: {
  configUrl: string
  configJson: string
  onConfigUrlChange: (url: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        <code>{CONFIG_FILENAME}</code> is this list’s settings as a file. Put it
        anywhere that serves a URL — your own web server, or a GitHub Gist raw
        URL, which needs no setup — and paste that URL below: the snippet
        shrinks to a single <code>data-config</code> attribute that reads the
        file. After that, editing the one file changes the list on every page it
        is embedded in, with nothing to re-paste.
      </p>
      <Field
        label="Hosted pubs.json URL"
        hint="Leave this blank to keep the settings inline in the snippet."
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
      <div>
        <DownloadButton
          filename={CONFIG_FILENAME}
          value={configJson}
          label={`Download ${CONFIG_FILENAME}`}
          mime="application/json;charset=utf-8"
        />
      </div>
    </div>
  )
}

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
        credit,
      }),
    [model.config, credit, configUrl, hosted],
  )
  const configJson = useMemo(() => serializeConfig(model.config), [model.config])

  const attrLength = inlineAttributeLength(model.config)
  const bulky = attrLength > INLINE_ATTR_BUDGET
  const commaHostile = hasCommaHostileValues(model.config)
  /**
   * Show the hosted-config route up front only when the inline attributes
   * genuinely cannot carry the configuration: too long to paste and read back
   * (`INLINE_ATTR_BUDGET`), or containing a comma, which a comma-joined
   * attribute would split. A URL the user has already pasted counts too —
   * hiding the field that produced the snippet on screen would be baffling.
   *
   * For the common case, one ORCID iD and a style, none of that applies and
   * the route is noise.
   */
  const needsHosted = bulky || commaHostile || hosted

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

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Script snippet</h3>
            <CopyButton value={snippet} label="Copy snippet" />
          </div>
          <SnippetBlock value={snippet} />
        </div>

        {/*
          The hosted-config route earns its place only when the inline
          attributes cannot do the job — see `needsHosted`. Otherwise it sits
          behind a disclosure: still one click away, not competing with the
          snippet the visitor actually came for.
        */}
        {needsHosted ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {bulky || commaHostile ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>
                  {commaHostile
                    ? 'One of your values cannot travel in an inline attribute'
                    : 'This configuration is large for inline attributes'}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {commaHostile
                      ? 'A value here contains a comma, and the data attributes are comma-separated, so the snippet above would split it in two.'
                      : `The inline attributes come to about ${attrLength} characters, which is more than anyone can read back in a CMS field.`}{' '}
                    Use the hosted file below instead.
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
            <HostedConfig
              configUrl={configUrl}
              configJson={configJson}
              onConfigUrlChange={onConfigUrlChange}
            />
          </div>
        ) : (
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Keep the settings in a file instead of in the snippet
            </summary>
            <div className="pt-4">
              <HostedConfig
                configUrl={configUrl}
                configJson={configJson}
                onConfigUrlChange={onConfigUrlChange}
              />
            </div>
          </details>
        )}

        {/*
          Collapsed by default: the iframe is the fallback for a CMS that
          strips scripts, not the route to recommend. Same disclosure pattern
          as "Formatting and filters" in App.tsx.
        */}
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            iframe snippet{' '}
            <span className="font-normal text-muted-foreground">
              — if your CMS strips <code>&lt;script&gt;</code> tags
            </span>
          </summary>
          <div className="flex flex-col gap-2 pt-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Same list, built the same way, in a frame served from this site.
              The trade is that the list is not in your page’s HTML, so search
              engines do not index it as part of your page. Use the script
              snippet above unless it does not survive your CMS.
            </p>
            <div className="flex justify-end">
              <CopyButton value={iframeSnippet} label="Copy iframe" />
            </div>
            <SnippetBlock value={iframeSnippet} />
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
