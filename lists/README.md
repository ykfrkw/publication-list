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

## Put the configuration in the snippet instead — no approval from anyone

Everything a file here can express also fits in the embed's own `data-*` attributes, and that is the route everybody outside this registry uses:

```html
<div class="publist-embed"
  data-orcid="0000-0003-1317-0220"
  data-style="vancouver"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

Generate it in the [wizard](https://ykfrkw.github.io/publication-list/) and paste it into your page. There is no file to host, no URL to keep working and no CORS to configure — and no size at which the attributes stop coping: a long member list, a long exclude list and a PubMed query containing a comma all travel inline (commas inside a value are escaped as `%2C`).

**The snippet is also the backup.** Paste it back into the wizard — "Start from an existing snippet" — and the form fills in from it, so keeping a copy of the snippet is keeping the configuration. See the [attribute reference](../README.md#full-attribute-reference).

A previous version of this project let you point `data-config` at a `pubs.json` you hosted yourself. That route and that download are gone; the snippet does the same job with nothing to maintain.

## Contents

| File | Owner | Status |
| --- | --- | --- |
| `furukawa.json` | Yuki Furukawa (ORCID `0000-0003-1317-0220`, researchmap `yk_frkw`) | Working — 34 publications as of 2026-08-05 |
| `sleepi.json` | SLEEPI research group | Working — 5 pinned records. No PubMed seed: the group has no collective author in its records yet. The `_comment` field records the `"SLEEPI"[cn]` query and the `trust` flag to switch to once it does |

## File format

Each file is a `ListConfig` document — the same shape a snippet's `data-*` attributes project onto once parsed. See the [`ListConfig` reference](../README.md#listconfig-reference).

A file here can carry two things the attributes cannot: a `label`, `from`, `to` or `grace` on a **PubMed** seed. Everything else has an inline equivalent.

A file may carry an extra `_comment` key for maintainer notes. It is not part of the schema; `normalizeConfig()` in `src/core/config.ts` rebuilds the configuration from known keys only, so unknown keys are ignored at runtime and never reach the rendered list.

## Deployment note

These files must be served at `<site>/lists/<id>.json` for `data-list` to resolve. The app build copies every `*.json` in this directory into `dist/lists/` (the `publist-copy-lists` plugin in `vite.config.ts`), so adding an entry here and merging to `main` is all that publishing takes. `README.md` in this directory is not copied.

Note that `npm run dev` serves the app from source and does not run that copy, so `?list=…` only resolves against a built site. Check a new entry with `npm run build && npm run preview`.
