/**
 * iframe fallback page (widget.html).
 *
 * Stub: renders nothing yet. The real implementation reads the config from
 * the URL query string, runs the same core pipeline as the embed script, and
 * writes the list into #publist-widget. Height reporting to the parent frame
 * is handled by /embed-height.js, loaded separately from widget.html.
 */

const root = document.getElementById('publist-widget')
if (root) {
  root.textContent = 'Publication list widget — not implemented yet.'
}
