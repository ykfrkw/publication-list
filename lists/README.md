# The `lists/` registry

Files here back the `data-list` attribute:

```html
<div class="publist-embed" data-list="furukawa"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

`data-list="furukawa"` resolves to `lists/furukawa.json` relative to the script's own URL, and the embed reads that file as its `ListConfig`.

## This registry is curated and closed to submissions

It holds the maintainer's own lists and a small number of groups he was asked to host. **Please do not open a pull request to add yourself** — it will be declined, and not because there is anything wrong with your list. Reviewing configurations is human work, and a registry that grows without bound becomes a maintenance burden that would eventually be dropped. Better to not promise it.

Nothing is lost by being outside it. There is no feature, no badge and no ranking here.

## Host your own configuration instead — no approval from anyone

Use `data-config` with a URL you control:

```html
<div class="publist-embed" data-config="https://example.ac.uk/pubs.json"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

That is the identical mechanism. The embed fetches your JSON instead of one of these files and behaves exactly the same way afterwards.

To produce the file, generate your list in the [wizard](https://ykfrkw.github.io/publication-list/) and press **Download `pubs.json`**. Then put it anywhere that serves it publicly with permissive CORS — your own web server, GitHub Pages, or a GitHub Gist raw URL (`raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *`).

You do not need an account with this project, permission from its maintainer, or a pull request. Editing your own `pubs.json` later updates every page that points at it.

If you would rather not host a file at all, put the configuration straight into the embed's `data-*` attributes. See the [attribute reference](../README.md#full-attribute-reference).

## Contents

| File | Owner | Status |
| --- | --- | --- |
| `furukawa.json` | Yuki Furukawa (ORCID `0000-0003-1317-0220`, researchmap `yk_frkw`) | Working — 34 publications as of 2026-08-05 |
| `sleepi.json` | SLEEPI research group | Working — 5 pinned records. No PubMed seed: the group has no collective author in its records yet. The `_comment` field records the `"SLEEPI"[cn]` query and the `trust` flag to switch to once it does |

## File format

Each file is a `ListConfig` document — the same schema as a hosted `pubs.json`. See the [`ListConfig` reference](../README.md#listconfig-reference).

A file may carry an extra `_comment` key for maintainer notes. It is not part of the schema; `normalizeConfig()` in `src/core/config.ts` rebuilds the configuration from known keys only, so unknown keys are ignored at runtime and never reach the rendered list.

## Deployment note

These files must be served at `<site>/lists/<id>.json` for `data-list` to resolve. The app build copies every `*.json` in this directory into `dist/lists/` (the `publist-copy-lists` plugin in `vite.config.ts`), so adding an entry here and merging to `main` is all that publishing takes. `README.md` in this directory is not copied.

Note that `npm run dev` serves the app from source and does not run that copy, so `?list=…` only resolves against a built site. Check a new entry with `npm run build && npm run preview`.
