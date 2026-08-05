/**
 * The candidate review queue.
 *
 * `buildList` returns `candidates` — records a PubMed *name* query turned up
 * that no trusted seed confirms. Under the default `strict` policy they are
 * NOT on the published list. That is the safe default (a lab page must not
 * sprout a stranger's papers because they share a surname), but it is only
 * safe if the user knows it is happening, so the count of undecided candidates
 * is stated in plain words rather than implied by a badge.
 *
 * Each row shows the full citation, the journal and the year: a title alone is
 * not enough to tell your own paper from a namesake's.
 *
 * Applying the queue writes decisions into `include` / `exclude`, so they
 * persist into the saved config and the same record is never asked about
 * twice — see `applyReviewDecisions` in `../lib/wizard.ts`.
 */

import { useMemo, useState } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatCitation } from '@/core/format'
import type { CitationStyle, Publication } from '@/core/types'
import {
  applyReviewDecisions,
  candidateRef,
  initialChecked,
  unreviewedCount,
} from '../lib/wizard'

export interface ReviewQueueProps {
  candidates: Publication[]
  suggested?: string[]
  style: CitationStyle
  boldNames: string[]
  reviewPolicy: 'strict' | 'auto'
  include: string[]
  exclude: string[]
  onApply: (next: { include: string[]; exclude: string[] }) => void
}

export function ReviewQueue({
  candidates,
  suggested,
  style,
  boldNames,
  reviewPolicy,
  include,
  exclude,
  onApply,
}: ReviewQueueProps) {
  const [checked, setChecked] = useState<Set<string>>(() =>
    initialChecked(candidates, suggested, include, exclude),
  )

  // Re-seed when a rebuild returns a different candidate set, using the
  // render-phase adjustment React recommends over an effect. Keyed on the
  // candidate keys, so re-rendering with the same list (a parent state change,
  // a style tweak) does not throw away ticking the user is halfway through.
  const identity = useMemo(() => candidates.map((c) => c.key).join('|'), [candidates])
  const [seen, setSeen] = useState(identity)
  if (identity !== seen) {
    setSeen(identity)
    setChecked(initialChecked(candidates, suggested, include, exclude))
  }

  const undecided = unreviewedCount(candidates, include, exclude)
  const suggestedKeys = useMemo(() => new Set(suggested ?? []), [suggested])

  if (candidates.length === 0) return null

  const toggle = (key: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const apply = () => {
    const result = applyReviewDecisions(include, exclude, candidates, checked)
    onApply({ include: result.include, exclude: result.exclude })
  }

  const confirming = checked.size
  const rejecting = candidates.length - confirming

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review queue ({candidates.length})</CardTitle>
        <CardDescription>
          These came from a PubMed author-name search, so they may belong to
          someone with a similar name. Tick the ones that are yours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>
            {reviewPolicy === 'strict'
              ? `${undecided} of these ${undecided === 1 ? 'is' : 'are'} not on your published list`
              : 'Review policy is set to “publish immediately”'}
          </AlertTitle>
          <AlertDescription>
            {reviewPolicy === 'strict' ? (
              <p>
                Under the default review policy, a candidate stays off the
                published list until you confirm it here. Confirm the ones that
                are yours and reject the rest — each decision is remembered, so
                you will not be asked about the same paper again.
              </p>
            ) : (
              <p>
                Every candidate below is already visible on your published list,
                confirmed or not. Switch the review policy back to “hold for
                review” if you would rather check them first.
              </p>
            )}
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setChecked(new Set(candidates.map((c) => c.key)))}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setChecked(new Set())}
          >
            Select none
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setChecked(new Set(candidates.filter((c) => suggestedKeys.has(c.key)).map((c) => c.key)))
            }
          >
            Select suggested
          </Button>
          <Button type="button" size="sm" className="ms-auto" onClick={apply}>
            Confirm {confirming}, reject {rejecting}
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {candidates.map((pub) => {
            const ref = candidateRef(pub)
            const isChecked = checked.has(pub.key)
            return (
              <li
                key={pub.key}
                className="flex items-start gap-2.5 rounded-lg border border-border p-2.5"
              >
                <input
                  type="checkbox"
                  id={`candidate-${pub.key}`}
                  checked={isChecked}
                  disabled={ref == null}
                  onChange={(e) => toggle(pub.key, e.currentTarget.checked)}
                  className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
                />
                <label
                  htmlFor={`candidate-${pub.key}`}
                  className="flex min-w-0 flex-col gap-1"
                >
                  <span
                    className="text-sm leading-relaxed [&_a]:underline"
                    // Every field is escaped by `format.ts`; the only markup
                    // here is <b>, <em> and one doi.org link.
                    dangerouslySetInnerHTML={{
                      __html: formatCitation(pub, style, boldNames),
                    }}
                  />
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {pub.journal ? <span>{pub.journal}</span> : null}
                    {pub.year ? <span>· {pub.year}</span> : null}
                    {pub.pmid ? <span>· PMID {pub.pmid}</span> : null}
                    {suggestedKeys.has(pub.key) ? (
                      <Badge variant="secondary">Suggested</Badge>
                    ) : null}
                    {ref == null ? (
                      <Badge variant="destructive">
                        No DOI or PMID — cannot be pinned
                      </Badge>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
