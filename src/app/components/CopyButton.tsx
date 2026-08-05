/** Copy-to-clipboard button with inline confirmation and a live region. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText, downloadText } from '../lib/clipboard'

type Feedback = 'idle' | 'copied' | 'failed'

export function CopyButton({
  value,
  label,
  variant = 'outline',
  size = 'sm',
  onCopy,
  className,
}: {
  /** Text to copy, or a thunk when building it is expensive. */
  value: string | (() => string)
  label: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  /** Custom copy action, e.g. the rich `ClipboardItem` payload. */
  onCopy?: () => Promise<void>
  className?: string
}) {
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const handle = useCallback(async () => {
    try {
      if (onCopy) await onCopy()
      else await copyText(typeof value === 'function' ? value() : value)
      setFeedback('copied')
    } catch {
      setFeedback('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback('idle'), 2000)
  }, [onCopy, value])

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void handle()}
    >
      {feedback === 'copied' ? <CheckIcon /> : <CopyIcon />}
      {/*
        The label stays put so the button keeps a stable accessible name, and
        the outcome is announced by a separate status region. Swapping the
        label itself for "Copied" would rename the control mid-interaction.
      */}
      <span>{label}</span>
      {feedback === 'idle' ? null : (
        <span aria-hidden="true" className="opacity-70">
          {feedback === 'copied' ? '· Copied' : '· Failed'}
        </span>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {feedback === 'copied'
          ? `${label}: copied to the clipboard`
          : feedback === 'failed'
            ? `${label}: could not copy`
            : ''}
      </span>
    </Button>
  )
}

export function DownloadButton({
  filename,
  value,
  label,
  mime,
  size = 'sm',
}: {
  filename: string
  value: string | (() => string)
  label: string
  mime?: string
  size?: React.ComponentProps<typeof Button>['size']
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() =>
        downloadText(filename, typeof value === 'function' ? value() : value, mime)
      }
    >
      <DownloadIcon />
      {label}
    </Button>
  )
}
