/**
 * The wizard's loading spinner.
 *
 * Hand-written rather than pulled from an icon set: it is one element and two
 * borders, and it has to answer to `prefers-reduced-motion`, which a generic
 * icon component does not.
 *
 * Under `motion-safe` it rotates. Under `motion-reduce` the rotation is simply
 * not applied and the gap in the ring is closed, so what is left is a static
 * ring — a mark, not a stalled animation. The information a user needs while a
 * build runs comes from the stage name and the percentage next to it, both of
 * which stay put either way; the spinner is there so the panel does not read as
 * frozen, not to carry meaning of its own. Hence `aria-hidden`: the state is
 * announced by the progress bar this sits inside.
 */

import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="spinner"
      className={cn(
        'inline-block size-4 shrink-0 rounded-full border-2 border-current border-t-transparent align-[-0.2em]',
        'motion-safe:animate-spin',
        'motion-reduce:border-t-current motion-reduce:opacity-60',
        className,
      )}
    />
  )
}
