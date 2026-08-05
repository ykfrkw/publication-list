/**
 * Clipboard and download helpers.
 *
 * The rich-text path is a port of `publication-list-generator/app.R:375-412`:
 * a `ClipboardItem` carrying `text/html` and `text/plain` together, so pasting
 * into Word keeps the formatting and pasting into a plain-text field does not
 * come out as tag soup. Word is the reason this tool exists in the R version's
 * workflow, so the fallback path is ported too rather than dropped.
 */

import type { ClipboardPayload } from '@/core/render'

/** Copy plain text. Falls back to a hidden textarea + `execCommand`. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Permission denied or an insecure context: fall through.
  }
  legacyCopy(() => {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    return area
  })
}

/**
 * Copy the Word payload: HTML and plain text in one `ClipboardItem`.
 *
 * The fallback selects a hidden, rendered copy of the HTML and runs
 * `document.execCommand('copy')`, which is what the R version does and the
 * only thing that works in Safari's older permission model and in Firefox,
 * where `ClipboardItem` support arrived late.
 */
export async function copyRich(payload: ClipboardPayload): Promise<void> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
        }),
      ])
      return
    }
  } catch {
    // Fall through to the selection-based path.
  }

  const copied = legacyCopyHtml(payload.html)
  if (!copied) await copyText(payload.plain)
}

/** Render `html` off-screen, select it, and `execCommand('copy')`. */
function legacyCopyHtml(html: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const holder = document.createElement('div')
  holder.innerHTML = html
  holder.style.position = 'fixed'
  holder.style.left = '-9999px'
  holder.style.top = '0'
  document.body.appendChild(holder)

  let ok = false
  try {
    const range = document.createRange()
    range.selectNodeContents(holder)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    ok = document.execCommand('copy')
    selection?.removeAllRanges()
  } catch {
    ok = false
  } finally {
    document.body.removeChild(holder)
  }
  return ok
}

function legacyCopy(makeNode: () => HTMLTextAreaElement): void {
  if (typeof document.execCommand !== 'function') return
  const node = makeNode()
  node.style.position = 'fixed'
  node.style.left = '-9999px'
  document.body.appendChild(node)
  try {
    node.select()
    document.execCommand('copy')
  } catch {
    /* nothing else to try */
  } finally {
    document.body.removeChild(node)
  }
}

/** Trigger a download of `text` as `filename`. */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Give the navigation a tick before revoking, or Safari cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
