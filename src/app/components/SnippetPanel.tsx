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
 *
 * SOURCE DISCLAIMER — a second, entirely separate checkbox beside it, also on
 * by default. It must never be folded into the credit box: they say different
 * things, and a site owner who declines to advertise the tool has not thereby
 * asked the list to stop describing how it was built. It travels as the
 * `disclaimer` field of the config, so `data-disclaimer="hide"` on the script
 * snippet and `?disclaimer=hide` on the iframe both fall out of the normal
 * projection with nothing special here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AN EMPTY LIST PRODUCES NO SNIPPET AT ALL
 *
 * When `model.publications` is empty this panel emits an explanation in place
 * of the snippets, and there is nothing on it to copy. Not a warning above a
 * copyable snippet, and not a confirmation dialog: the markup for an empty list
 * is *permanently* empty on the page it is pasted into — candidates are
 * confirmed in the wizard and nowhere else, so no number of page loads can
 * resolve one — and handing that over is handing over a page that will never
 * work. It fails invisibly at the far end too, because `embed.js` deliberately
 * never blanks a list and so leaves the empty snapshot exactly where it is.
 *
 * The general form of the same problem is warned about rather than blocked: a
 * non-empty list with outstanding candidates embeds fewer records than the
 * preview shows, and the count says so beside the snippet.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ListModel } from '@/core/types'
import { CheckboxField } from './Field'
import { CopyButton } from './CopyButton'
import { buildEmbedSnippet, buildIframeSnippet } from '../lib/snippet'
import { candidatesMissingFromEmbed, diagnoseEmptyList } from '../lib/diagnose'

function SnippetBlock({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">
      <code>{value}</code>
    </pre>
  )
}

export interface SnippetPanelProps {
  /** Already carries the disclaimer choice in `model.config`; see `App.tsx`. */
  model: ListModel
  credit: boolean
  disclaimer: boolean
  /** Include the pre-rendered list in the snippet. Off by default; recommended. */
  snapshot: boolean
  onCreditChange: (credit: boolean) => void
  onDisclaimerChange: (disclaimer: boolean) => void
  onSnapshotChange: (snapshot: boolean) => void
}

/**
 * The panel, or — for a list with nothing on it — the reason there is no
 * snippet. The split is a whole component rather than a branch inside one so
 * that the empty case has no snippet in scope at all: there is no `<pre>` to
 * copy out of, no copy button to disable, and nothing for a later edit to
 * accidentally re-expose.
 */
export function SnippetPanel(props: SnippetPanelProps) {
  if (props.model.publications.length === 0) {
    return <NoSnippet model={props.model} />
  }
  return <SnippetPanelForList {...props} />
}

/**
 * What the panel says instead of a snippet.
 *
 * It names the same cause the results panel names — one diagnosis, two places
 * it is needed — and then adds the part that is specific to embedding: that an
 * embed cannot recover from this on its own.
 */
function NoSnippet({ model }: { model: ListModel }) {
  const empty = diagnoseEmptyList(model)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Embed on a website</CardTitle>
        <CardDescription>
          There is no snippet yet, because this list has no publications on it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" aria-live="polite">
          <TriangleAlertIcon />
          <AlertTitle>
            A snippet for an empty list would stay empty for ever
          </AlertTitle>
          <AlertDescription>
            <p>
              The snippet carries the list as it stands, and the script that
              refreshes it publishes only records you have confirmed. Reviewing
              happens here in the wizard and nowhere else — an embedded page has
              no review queue — so a snippet generated now would render nothing
              on your site, and no number of page loads would ever change that.
              It is withheld rather than handed over with a warning on it.
            </p>
            {empty ? (
              <p>
                <strong className="font-medium">{empty.title}.</strong>{' '}
                {empty.body}
              </p>
            ) : null}
            {empty && empty.filters.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 ps-4">
                {empty.filters.map((filter) => (
                  <li key={filter} className="break-words">
                    {filter}
                  </li>
                ))}
              </ul>
            ) : null}
            <p>
              Fix that, press Generate list again, and the snippet appears here.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

function SnippetPanelForList({
  model,
  credit,
  disclaimer,
  snapshot,
  onCreditChange,
  onDisclaimerChange,
  onSnapshotChange,
}: SnippetPanelProps) {
  const snippet = useMemo(
    () => buildEmbedSnippet(model, { credit, snapshot }),
    [model, credit, snapshot],
  )
  const iframeSnippet = useMemo(
    () => buildIframeSnippet(model.config, { credit }),
    [model.config, credit],
  )

  /**
   * How much smaller the embedded list will be than the one on screen.
   *
   * The preview above shows the confirmed list *and* a review queue; the embed
   * shows the confirmed list. Someone who has just read a queue of their own
   * papers has every reason to assume the snippet below carries them, and it
   * does not — so the difference is stated as a number, next to the thing it is
   * a difference from.
   */
  const unconfirmed = candidatesMissingFromEmbed(model)
  const published = model.publications.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embed on a website</CardTitle>
        <CardDescription>
          Paste this into any page. The script fetches the list fresh every time
          the page loads, so it never goes out of date.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/*
          Unticked by default and labelled as recommended, which is a deliberate
          pair rather than a contradiction: the snapshot is worth having, and it
          is also most of the snippet's bulk. Someone who wants the small
          version should get it by not reading this box; someone who reads it
          should be told plainly that ticking it is the better answer, and what
          not ticking it costs. The three costs are named on the spot rather
          than left to a link, because the box is where the decision is taken.
        */}
        <CheckboxField
          checked={snapshot}
          onChange={onSnapshotChange}
          label="Include the list itself in the snippet (recommended)"
          hint="Without it the list is not in your page’s HTML: search engines do not read it, a visitor with JavaScript turned off sees nothing, and the list appears only once the fetch finishes. Ticking this makes the snippet much longer."
        />

        <CheckboxField
          checked={credit}
          onChange={onCreditChange}
          label="Include a credit link"
          hint="Adds one line under the list: “Auto-updated with Publication List Generator”. It becomes part of your own HTML, so you can edit or delete it at any time. Everything works exactly the same with this turned off."
        />

        {/*
          Its own box, next to the credit and never merged with it: the two
          lines make different claims, and someone who drops the credit has not
          asked the page to stop saying where its contents came from.
        */}
        <CheckboxField
          checked={disclaimer}
          onChange={onDisclaimerChange}
          label="Say where the list came from"
          hint="Adds one line under the list noting that it is compiled automatically from ORCID, PubMed and researchmap, and inherits anything those records get wrong. Worth keeping on a page other people read: it tells them a missing paper is a gap in a database rather than a claim about you."
        />

        {unconfirmed > 0 ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>
              {unconfirmed} {unconfirmed === 1 ? 'record' : 'records'} in the
              review queue {unconfirmed === 1 ? 'is' : 'are'} not in this
              snippet
            </AlertTitle>
            <AlertDescription>
              <p>
                It carries the {published}{' '}
                {published === 1 ? 'publication' : 'publications'} on your list.
                A candidate is never in an embed, however often the page is
                reloaded: confirming it in the review queue above is the only
                thing that adds it, and that can only be done here. Decide on
                them before you paste this, or paste it now and regenerate
                afterwards.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {/*
          The one solid button in this panel, and the only solid button in the
          whole output area. Copying this snippet is what the tool is for — the
          results panel above is a row of peer export formats, none of which is
          being asked for over the others, so none of them is promoted. See the
          note in `ResultsPanel.tsx`.
        */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Script snippet</h3>
            <CopyButton value={snippet} label="Copy snippet" variant="default" />
          </div>
          <SnippetBlock value={snippet} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Keep this snippet somewhere you can find it — it is the whole
            configuration. Pasting it back into{' '}
            <strong className="font-medium text-foreground">
              Start from an existing snippet
            </strong>{' '}
            at the top of this page fills the form in again, so there is nothing
            else to save.
          </p>
        </div>

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
