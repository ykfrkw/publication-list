/**
 * `ListModel.warnings`, shown.
 *
 * These are not diagnostics for the developer. They carry the things a
 * researcher must know about their own list: how many records were dropped as
 * errata, which pinned DOI could not be resolved, which upstream failed, and
 * whether a bold name is ambiguous between two people. A tool that silently
 * drops publications from someone's CV is worse than one that fails loudly,
 * so this panel is never collapsed by default and never truncated.
 */

import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <Alert variant="destructive" aria-live="polite">
      <TriangleAlertIcon />
      <AlertTitle>
        {warnings.length === 1
          ? '1 thing needs your attention'
          : `${warnings.length} things need your attention`}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 ps-4">
          {warnings.map((warning, i) => (
            <li key={`${i}-${warning.slice(0, 32)}`} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
