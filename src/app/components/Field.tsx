/** Label + hint + control, wired together so the label is always real. */

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldProps {
  label: string
  hint?: React.ReactNode
  className?: string
  /** Receives the id to put on the control, so the `<label for>` resolves. */
  children: (id: string) => React.ReactNode
}

export function Field({ label, hint, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A native `<select>` with a real `<label>`.
 *
 * Native rather than the vendored base-ui `Select`: this form has six of these
 * and they have to work with a keyboard, with a screen reader, and inside the
 * OS picker on a 360 px phone. A native control does all three for free, and
 * nothing here needs the custom popup's styling.
 */
export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  hint?: React.ReactNode
  value: T
  onChange: (value: T) => void
  /**
   * `disabled` greys one choice out while leaving it visible. Used where an
   * option is unavailable because of another control rather than removed
   * outright — a vanishing option is a control the user cannot reason about.
   */
  options: readonly { value: T; label: string; disabled?: boolean }[]
  className?: string
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value as T)}
          // `text-foreground` for the same reason as `Input` and `Textarea`:
          // preflight makes form controls inherit their colour, and a selected
          // option must never come out in the muted grey used for hints.
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/**
 * A native checkbox with a real `<label>`.
 *
 * Deliberately not a styled div: the review queue can hold dozens of these and
 * they must be reachable with Tab, toggled with Space, and announced by a
 * screen reader without any ARIA glue.
 */
export function CheckboxField({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  hint?: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="leading-snug font-normal">
          {label}
        </Label>
        {hint ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  )
}
