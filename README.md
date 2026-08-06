# Publication List Generator

**Lab publication pages go stale, and a page whose newest paper is from 2022 makes an active group look dormant.** This tool builds the list from ORCID, PubMed and researchmap in the visitor's own browser, so the page is current every time someone loads it — with no server, no account, no API key and nothing to maintain.

It also formats reference lists for articles (paste PMIDs and DOIs, get Vancouver/APA/Harvard/Chicago/Nature output, copy into Word, WordPress, BibTeX or RIS).

- **Wizard:** <https://ykfrkw.github.io/publication-list/>
- **License:** MIT — see [LICENSE](LICENSE)
- **Step-by-step guide for labs:** [docs/lab-setup.md](docs/lab-setup.md)

---

## Quickstart

Generate a snippet in the [wizard](https://ykfrkw.github.io/publication-list/), or write one by hand. It looks like this:

```html
<div class="publist-embed"
  data-orcid="0000-0003-1317-0220"
  data-bold-names="Yuki Furukawa"
  data-style="vancouver">
  <!-- Snapshot generated 2026-08-05. embed.js replaces it with a live list on load. -->
  <section class="publist">
  <h3 class="publist-heading">Original Articles &amp; Reviews</h3>
  <ol class="publist-list">
  <li class="publist-item"><b>Furukawa Y</b>, Salahuddin NH, Wei Y, et al. Next-step treatment for schizophrenia non-responsive to antipsychotics: a systematic review and network meta-analysis. <em>eClinicalMedicine</em>. 2026.</li>
  <li class="publist-item">Fares-Otero NE, <b>Furukawa Y</b>, Sijbrandij M, et al. Efficacy of MDMA-assisted therapy for posttraumatic stress disorder: a systematic review and meta-analysis. <em>European Neuropsychopharmacology</em>. 2026.</li>
  </ol>
  <p class="publist-credit">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>
  </section>
</div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

Paste it into your page. That is the whole installation.

Two things about that snippet are deliberate:

- **The list is already in the HTML.** The `<section class="publist">` block is a snapshot of the list as it stood when the snippet was generated. Search engines index it, visitors with JavaScript disabled read it, and it appears instantly on a slow connection. `embed.js` replaces it with a freshly fetched list after the page loads — the snapshot is the floor, not the ceiling.
- **`embed.js` never blanks the list.** If ORCID is down, if the network fails, if the script never loads at all, whatever is in the container stays on the page.

The container gets a `data-publist-state` attribute you can style against: `loading`, `cached` (a previous run restored from `localStorage`), `ready`, or `error`.

While the refresh runs, the script adds one small "Updating…" line laid out at zero height, so nothing on your page moves and the list is neither covered nor dimmed. A container that starts genuinely empty — a hand-written snippet with no snapshot — gets a spinner instead, because there is nothing else in it to look at. Both are removed the moment the list lands, and both are `publist-` prefixed and styled from a stylesheet the script injects only if it needs one.

Every class is namespaced `publist-`, and the markup is unstyled `<section>` / `<h3>` / `<ol>` / `<li>` so it inherits your site's typography. Style it from your own stylesheet:

```css
.publist-heading { font-size: 1.1rem; margin-top: 1.5em; }
.publist-item    { margin-bottom: 0.6em; }
.publist-pmid    { color: #666; font-size: 0.9em; }
[data-publist-state="loading"] .publist { opacity: 0.7; }
```

### Pinned script URL

`https://ykfrkw.github.io/publication-list/embed.js` always serves the current build. `https://ykfrkw.github.io/publication-list/v1/embed.js` is the pinned copy: same file today, and it will keep the v1 behaviour if the format ever changes. Use the pinned URL if you would rather not be updated automatically.

---

## Getting your configuration to the page

There are three ways, and none of them requires an account, an approval, or a pull request to this repository.

### 1. Inline `data-*` attributes

Best for one person or a handful of seeds. Everything is visible in your own HTML.

```html
<div class="publist-embed"
  data-orcid="0000-0003-1317-0220,0000-0002-1825-0097"
  data-style="apa"
  data-group-by="year"
  data-from="2020">
</div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

#### Full attribute reference

Read off `src/core/config.ts`. Values are trimmed; an empty attribute is treated as absent. **An unrecognized value for an enumerated attribute is silently ignored and the default applies** — a typo in `data-review-policy` falls back to the safe `strict`, it does not error.

| Attribute | Maps to | Accepted values | Default if absent |
| --- | --- | --- | --- |
| `data-orcid` | `seeds.orcid` | Comma-separated ORCID iDs. A full `https://orcid.org/…` URL is accepted and the prefix stripped. | none |
| `data-researchmap` | `seeds.researchmap` | Comma-separated researchmap permalinks. A `https://researchmap.jp/…` URL is accepted; only the first path segment is kept. | none |
| `data-pubmed` | `seeds.pubmed[].query` | Comma-separated PubMed queries. **A query containing a comma cannot be carried this way** — use a hosted `pubs.json` instead. | none |
| `data-include` | `include` | Comma-separated `pmid:12345678` / `doi:10.1136/bmj.n71`. Pinned records are always shown. | none |
| `data-exclude` | `exclude` | Same format. Excluded records are dropped before anything else runs. | none |
| `data-bold-names` | `boldNames` | Comma-separated author names to bold. Spell them out in full (`Yuki Furukawa`, not `Furukawa Y`). | every seeded member's own name |
| `data-style` | `style` | `vancouver`, `apa`, `harvard`, `chicago`, `nature` | `vancouver` |
| `data-group-by` | `groupBy` | `category`, `year`, `none` | `category` |
| `data-preprints` | `preprints` | `include`, `exclude` | `exclude` — preprints are left off unless you ask for them |
| `data-japanese` | `japanese` | `separate`, `merge`, `hide` | `separate` |
| `data-review-policy` | `reviewPolicy` | `strict`, `auto` | `strict` |
| `data-from` | `from` | `YYYY` or `YYYY-MM`. A bare year means January of that year. | no lower bound |
| `data-to` | `to` | `YYYY` or `YYYY-MM`. A bare year means December of that year. | no upper bound |
| `data-limit` | `limit` | Positive integer. Applied after sorting, so you keep the newest N. | no limit |
| `data-config` | — | URL of a hosted `pubs.json`. See below. | none |
| `data-list` | — | Id in this repository's curated `lists/` registry. See below. | none |

What the values mean:

- **`style`** — the citation format. All five are ported from the R original; `vancouver` is the default.
- **`groupBy`** — `category` splits the list into Original Articles & Reviews / Letters / Editorials / Other Publication Types, plus a Preprints section if `preprints` is `include`. `year` gives one heading per year, newest first, with an `Undated` bucket last. `none` gives one flat numbered list (what you want for an article's reference list).
- **`preprints`** — whether preprints appear at all. **The default is `exclude`**: a publication list normally means published work, and an unlabelled manuscript sitting among journal articles overstates it. Nothing disappears quietly — every excluded preprint is named in the model's warnings, with the count and how to turn them on. `include` puts them back, in their own "Preprints" section under `groupBy: category`. Note what counts as a preprint: anything on a preprint server (medRxiv, bioRxiv, arXiv and the rest of the list in [Limitations](#limitations)), anything the source typed as a preprint, **and an F1000-family article that Crossref does not yet report as approved by referees** — see [Limitations](#limitations).
- **`japanese`** — what to do with Japanese-language records, which in practice come from researchmap. `separate` puts them in a trailing "Japanese-language publications" section. `merge` interleaves them with everything else. `hide` drops them (before `limit` is applied, so a limit of 10 still yields 10 visible entries).
- **`reviewPolicy`** — `strict` publishes only records the tool is confident about; anything a PubMed *name* search turned up stays off the page until you confirm it. `auto` publishes name-search hits immediately. Read [Limitations](#limitations) before choosing `auto`.

### 2. `data-config` — a hosted JSON file

Best for anything larger: a lab with many members, a long exclude list, or a PubMed query containing a comma. You host the file; nobody has to approve anything.

```html
<div class="publist-embed" data-config="https://example.ac.uk/pubs.json"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

The file must be served with permissive CORS. Anything that works in a browser `fetch()` from your page works here — your own web server, GitHub Pages, or a GitHub Gist raw URL (`raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *`).

The wizard has a **Download `pubs.json`** button that writes exactly this file: in the results panel always, and in the embed panel next to the field you paste the hosted URL into. That field is offered up front only when the inline attributes cannot do the job — too long to paste and read back, or containing a comma — and otherwise sits under "Keep the settings in a file instead of in the snippet".

**Precedence:** inline `data-*` attributes win over the hosted file. The two are merged shallowly, and `seeds` is merged one key at a time — so `data-orcid` on the container replaces the `seeds.orcid` array from the file, but leaves `seeds.researchmap` from the file alone. If both `data-config` and `data-list` are present, `data-config` is used and `data-list` is ignored.

### 3. `data-list` — the curated registry

```html
<div class="publist-embed" data-list="furukawa"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

The id is resolved against the script's own URL (`…/publication-list/lists/<id>.json`). This registry is small, curated, and **not open for submissions** — it exists for the maintainer's own lists and a handful of groups he was asked to host. Use `data-config` instead; it does the same thing with no gatekeeper. See [lists/README.md](lists/README.md).

---

## The iframe fallback

Some CMSes strip `<script src>` out of page content. For those, the wizard emits an `<iframe>` snippet — collapsed under "iframe snippet", because it is the fallback rather than the recommended route — pointing at a hosted widget page:

```html
<iframe class="publist-frame" title="Publication list" loading="lazy"
  src="https://ykfrkw.github.io/publication-list/widget.html?orcid=0000-0003-1317-0220&style=vancouver"
  style="display:block;width:100%;border:0;height:900px;"></iframe>
```

The snippet also carries a small inline listener that resizes the frame to its content. The widget posts `{ type: 'embed:height', height: <px> }` to the parent, and the listener validates both the message source and its origin before applying it. If your CMS strips inline `<script>` too, the iframe still works — it just keeps its fixed fallback height.

The widget reads its configuration from the **query string** rather than from `data-*` attributes, using the same vocabulary and the same coercion rules: drop the `data-` prefix and you have the parameter name. `?orcid=…&style=vancouver` means exactly what `data-orcid="…" data-style="vancouver"` means. Two conveniences the query string adds:

- **Repeated names are joined.** `?orcid=A&orcid=B` is the same as `?orcid=A,B`. For a single-valued parameter, the first occurrence wins.
- **camelCase spellings are accepted** for the hyphenated names: `groupBy`, `boldNames` and `reviewPolicy` work as well as `group-by`, `bold-names` and `review-policy`.

`?config=` and `?list=` work like their attribute counterparts. Both are validated because they come from a URL: `config` must be an `http(s)` URL, and `list` must be a bare filename so it cannot climb out of `lists/`.

One parameter has no `data-*` counterpart: **`?credit=0`** turns the credit line off inside the frame. It is how the wizard's "Include a credit link" checkbox reaches this route — see [The credit link](#the-credit-link). `credit=false`, `credit=off` and `credit=no` mean the same thing; anything else, including no parameter at all, leaves the credit on.

The trade-off against the script snippet follows from the content living in a separate document: **there is no snapshot.** The list is not in your page's HTML — see [Limitations](#limitations).

---

## Static HTML — paste once, no JavaScript

Some pages should not run anything at all: a personal CV page you maintain by hand, a departmental template where the only editable thing is a rich-text field, an intranet with a strict content policy. For those, the wizard's results panel has a **Static HTML (no auto-update)** button. It copies the finished list and nothing else:

```html
<section class="publist">
<h3 class="publist-heading">Original Articles &amp; Reviews</h3>
<ol class="publist-list">
<li class="publist-item"><b>Furukawa Y</b>, Salahuddin NH, Wei Y, et al. Next-step treatment for schizophrenia non-responsive to antipsychotics: a systematic review and network meta-analysis. <em>eClinicalMedicine</em>. 2026.</li>
</ol>
<p class="publist-credit">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>
</section>
```

No `<script>` tag, no `.publist-embed` wrapper, no `data-*` attributes — nothing for a sanitiser to strip and nothing for a browser to execute. It is the same markup, from the same renderer, as the snapshot inside the script snippet.

**It does not update itself.** That is the entire difference, and it is the reason to pick one of the other two routes if you can. Regenerate and re-paste when you have new papers; once or twice a year is still less work than maintaining the list by hand, and the page never has a stale-looking gap in the meantime because you can see exactly what is on it.

The "Include a credit link" checkbox governs this output as well — see [The credit link](#the-credit-link).

Choosing between the three:

| Route | Updates itself | In your page's HTML | Needs `<script>` |
| --- | --- | --- | --- |
| [Script snippet](#quickstart) | yes | yes (snapshot, then live) | yes |
| [iframe](#the-iframe-fallback) | yes | no | no |
| Static HTML | no | yes | no |

---

## `ListConfig` reference

The `pubs.json` schema, defined in `src/core/types.ts`. Every field except `v` and `seeds` is optional.

```ts
{
  v: 1                                  // schema version; always 1
  seeds: {
    orcid?: string[]                    // ORCID iDs
    researchmap?: string[]              // researchmap permalinks
    pubmed?: { query: string, label?: string }[]
  }
  include?: string[]                    // "pmid:12345678" | "doi:10.1136/bmj.n71"
  exclude?: string[]                    // same format
  boldNames?: string[]                  // full names to bold in the author lists
  style?: 'vancouver' | 'apa' | 'harvard' | 'chicago' | 'nature'
  from?: string                         // "YYYY" | "YYYY-MM"
  to?: string                           // "YYYY" | "YYYY-MM"
  groupBy?: 'category' | 'year' | 'none'
  preprints?: 'include' | 'exclude'      // default 'exclude'
  japanese?: 'separate' | 'merge' | 'hide'
  reviewPolicy?: 'strict' | 'auto'
  limit?: number                        // positive integer
}
```

Notes that are easy to get wrong:

- **`seeds.pubmed[].query` is a raw PubMed query string.** A query ending in `[auid]` is an ORCID identifier search and its hits are trusted outright. Any other query — including `Furukawa Y[au]` — is a name search, and its hits become *candidates*: they do not appear on the page under the default `strict` policy until you confirm them in the wizard's review queue. `label` is cosmetic; it is what the record's provenance is attributed to.
- **`preprints` defaults to `'exclude'`, and omitting the field means excluded.** A `pubs.json` written before this field existed therefore loses its preprints on the next page load. The wizard's downloaded file always writes the value out explicitly, so what you host says what you meant.
- **`include` is not just "extra papers".** It also force-confirms a record another seed already found. That is the mechanism the review queue uses: a confirmed candidate goes into `include`, a rejected one into `exclude`, and neither is ever asked about again.
- **A pinned base DOI also matches the versioned records of the same work.** `doi:10.12688/f1000research.12345` catches `.1` through `.4`.
- **Unrecognized `include` / `exclude` strings are reported, not silently dropped** — they land in the model's warnings.

### Worked example

A three-person lab. Two members have ORCID iDs, the third does not and is covered by a narrowed PubMed name search. One collaboration paper is pinned by DOI because it predates everyone's ORCID record; one same-name false positive is permanently excluded.

```json
{
  "v": 1,
  "seeds": {
    "orcid": [
      "0000-0003-1317-0220",
      "0000-0002-1825-0097"
    ],
    "researchmap": ["yk_frkw"],
    "pubmed": [
      {
        "query": "Tanaka H[au] AND (\"Univ Tokyo\"[ad]) AND 2019:2026[dp]",
        "label": "Hiroshi Tanaka"
      }
    ]
  },
  "include": [
    "doi:10.1136/bmj.n71",
    "pmid:35940841"
  ],
  "exclude": [
    "pmid:26237260"
  ],
  "boldNames": [
    "Yuki Furukawa",
    "Hiroshi Tanaka"
  ],
  "style": "vancouver",
  "groupBy": "category",
  "japanese": "separate",
  "preprints": "exclude",
  "reviewPolicy": "strict",
  "from": "2015"
}
```

Working examples live in [`lists/`](lists/).

---

## What runs where

Everything happens in the visitor's browser. There is no backend to this tool.

- No server of ours sees your page, your visitors, or your list. We host two static files (`embed.js` and the wizard) and nothing else.
- No tracking, no analytics, no cookies set by the embed.
- No account, no sign-up, no API key.
- The only network requests are from the visitor's browser directly to the public APIs listed below. Every one of them was verified to send `Access-Control-Allow-Origin: *` on 2026-08-05, which is why no proxy is needed.
- No contact email or API key is sent to OpenAlex, Crossref or PubMed. Embedding one in a public bundle would leak it and invite spam, and the "polite pool" it would buy is meaningless when every request comes from a different visitor's IP. PubMed receives only `tool=publication-list-generator`, and PubMed requests are serialized with a ≥350 ms gap to stay inside NCBI's 3 requests/second limit.
- Built lists are cached in the visitor's own `localStorage` under the `publist:` prefix, capped at 200 KB per entry with a 24-hour TTL. Nothing outside that namespace is ever touched, and a storage failure degrades to "no cache" rather than to a broken page.

### What your visitors' browsers contact

Worth stating plainly, because it is what an institutional web team will want to know and because "it all runs in the browser" is only half an answer. Running in the browser is precisely what makes the visitor, rather than a server of ours, the party talking to the upstream APIs.

When someone loads a page carrying the script snippet, their browser makes requests to hosts that are not yours. There is no proxy in front of any of them:

| Host | When | For |
| --- | --- | --- |
| `ykfrkw.github.io` | always | `embed.js` itself, plus `lists/<id>.json` if you used `data-list` |
| `pub.orcid.org` | if you seeded an ORCID iD | the works record |
| `eutils.ncbi.nlm.nih.gov` | if you seeded a PubMed query, or pinned a PMID | PMIDs, journals, dates, publication types |
| `api.researchmap.jp` | if you seeded a researchmap permalink | Japanese-language records |
| `api.openalex.org` | for any non-empty list | author names, work types, missing metadata |
| `api.crossref.org` | for F1000-family DOIs, and records OpenAlex left without authors | peer-review status, author names |

Plus whatever host you pointed `data-config` at, if you used one.

Each of those receives what any third-party resource on a web page receives: the visitor's **IP address** and **User-Agent**, and — under browsers' default referrer policy — your page's origin, not its full URL, in the `Referer` header. It is the same exposure as an embedded font, a hotlinked image or an analytics tag. The difference is that here it is the entire story, so here is the rest of it.

What those hosts do **not** receive:

- **No cookies.** The embed sets none. Every upstream call is a plain `fetch` left at the default `credentials: 'same-origin'`, so no cookies travel to any of these hosts even if a visitor has some. The list cache is `localStorage` on your own origin, under the `publist:` prefix.
- **No identifier of the visitor.** The query strings carry only what you configured — ORCID iDs, researchmap permalinks, PubMed queries, DOIs, PMIDs. Those identify the researchers whose list this is, which is the point of the list and already public. Nothing in any request identifies the person reading the page. PubMed additionally receives `tool=publication-list-generator`, a fixed string that is the same for every installation; there is no `email=` and no `api_key=` (see the note above about why).
- **Nothing reaches us.** There is no backend, no analytics, no telemetry and no error reporting anywhere in this project — not a beacon, not a pixel, not a logging endpoint. One honest caveat: `embed.js` is a static file on GitHub Pages, so GitHub serves it and sees that request the way any CDN sees a request for a script. GitHub Pages gives a repository owner no access to those logs, and we add nothing of our own. If that is still more trust than you want to place, the file is self-contained — host your own copy and the `ykfrkw.github.io` row disappears.

Two ways to narrow the exposure, both already supported:

- **The [iframe route](#the-iframe-fallback) confines the requests to a separate document.** They still happen and the upstream APIs still see the visitor's IP — an iframe is not a privacy boundary against the hosts being called — but they are issued by the widget document rather than by your page, and no script of ours runs in your page's context. The only code of ours you paste alongside it is the optional inline resize listener, which does nothing but read a height number out of a `postMessage` from the frame.
- **[Static HTML](#static-html--paste-once-no-javascript) makes no external requests at all.** No script, no frame, no image, no stylesheet — nothing in that markup causes the browser to contact anything when the page renders, including us. The DOI and PMID links inside the citations are ordinary links: they lead somewhere only when a visitor decides to click one. If your page must not talk to third parties, this is the route, and it is the reason the button exists.

---

## Limitations

This is a research tool. Here is what it does not do well.

**It can only show what is registered.** The list is assembled from ORCID, researchmap and PubMed. A paper missing from all three is missing from the list. In practice this means gaps in an ORCID record become gaps on the page, and the fix is to update ORCID, not to work around the tool. ORCID is the recall backbone: whatever a researcher has curated there is trusted and included.

**PubMed name searches catch other people.** `Furukawa Y[au]` returns every Furukawa Y in PubMed, which for a common Japanese or Chinese surname is a lot of strangers. This is why the tool separates *confirmed* records (ORCID, researchmap, explicit pins, and `[auid]` ORCID-identifier searches) from *candidates* (everything a name search found and nothing else corroborates), and why **candidates are hidden by default**. Under `reviewPolicy: 'strict'` an unreviewed candidate never reaches the published page; you approve or reject each one in the wizard, and the decision is stored so you are not asked again. The tool pre-ticks candidates that share a co-author with your confirmed set, but that is a hint, not a verdict. `reviewPolicy: 'auto'` turns the safety off — it will eventually put someone else's paper on your lab's page.

A query that returns PubMed's 200-result cap is flagged as probably too broad; narrow it with an affiliation (`[ad]`) or a date range (`[dp]`).

**Publication type classification is imperfect.** Categories (original article, preprint, letter, editorial, other) come mostly from OpenAlex work types, falling back to the type ORCID or researchmap reported. OpenAlex gets this wrong sometimes, and there is no cross-source vote to catch it. Preprint servers are detected by journal-name matching against a fixed list (medRxiv, bioRxiv, arXiv, SSRN, ChemRxiv, PsyArXiv, preprints.org, Research Square, Authorea) — a server not on that list will be miscategorised. Records that OpenAlex types as `erratum` or `paratext` are dropped from the list entirely, and the drop is reported in the warnings rather than done silently.

**Preprints are hidden by default, and an unapproved F1000 article counts as one.** `preprints` defaults to `exclude` (see [the attribute table](#full-attribute-reference)). For F1000-family open-review journals, Crossref is consulted to decide whether an article has been approved by referees (original article) or not yet (preprint) — so an F1000Research paper whose referee reports have not landed, or whose Crossref record has not caught up, is filed as a preprint and is therefore **also hidden by default**. That is the intended reading: it has been posted, not yet peer-reviewed. It is still a surprise if you were not expecting it, which is why every held-back record is named in the warnings with its count, and why turning them all back on is one setting: `preprints: 'include'`, or the wizard's "Include preprints" checkbox.

**Speed.** Measured 2026-08-05 against ORCID `0000-0003-1317-0220` (34 publications):

| Configuration | Requests | Wall time |
| --- | --- | --- |
| ORCID only | 5 | ~2.6 s |
| ORCID + researchmap + PubMed | 6 | ~4.5 s |

The bottleneck is researchmap's response time, not the number of requests. **This is not what your visitors experience**, because the pre-rendered snapshot in the snippet is on screen from the first paint and a cached list from a previous visit replaces it immediately; the live fetch swaps in when it lands.

**Author names are only as good as the source.** ORCID work summaries carry no author list at all — author names come from OpenAlex enrichment. researchmap stores short forms (`Türkmen C`) in a field that reads like a full-name field, and its author ordering varies between accounts. Bold-name matching therefore works on full names; if you give it `Furukawa Y` it cannot tell Yuki from Yuri, and the tool will warn you when a bold name lands on two different people.

**The iframe fallback carries no snapshot.** The `<iframe>` route (below) exists for CMSes that strip `<script>` tags, and it works — but its content is a separate document, so it is not in your page's HTML. Search engines do not index it as part of your page, and a visitor with JavaScript disabled sees an empty frame. Use the script snippet unless your CMS forces you not to.

---

## The credit link

The snippet the wizard generates ends with one line:

> Auto-updated with [Publication List Generator](https://yukifurukawa.jp/publication-list-generator/)

**It is optional.** There is a checkbox labelled "Include a credit link" in the wizard; untick it and the snippet contains no link at all. Nothing else changes — same output formats, same live updating, same everything. There is no reminder, no watermark and no reduced functionality. If you have already pasted a snippet, delete the `<p class="publist-credit">…</p>` line; it will not come back.

**All three routes obey the same checkbox**, with one difference in mechanism that follows from where the markup lives. In the script snippet and in the [static HTML](#static-html--paste-once-no-javascript) the credit is a line of your own HTML, so unticking the box simply does not write it. In the [iframe fallback](#the-iframe-fallback) the credit is rendered by our page rather than by your markup, so there is no line for you to delete — unticking the box appends `credit=0` to the frame's URL instead, and the widget renders no credit at all. Add or remove that parameter by hand later and it behaves the same way. A frame URL that says nothing about the credit keeps it, so nothing you have already pasted changes.

**Being straight about it:** that link is how people find this tool. It is unpaid work given away for free, and word of mouth from the pages it runs on is the only distribution it has. Keeping it is a kindness, not a condition.

Two design decisions worth stating, because they are the difference between attribution and link spam:

- **`embed.js` never creates, modifies or removes the credit link.** The link exists only in the static HTML you copied, in your own markup, where you can see it and delete it. The runtime script cannot emit one even by accident — the code path that runs on your page is called with credit rendering switched off — and when it refreshes the list it works around any `.publist-credit` node rather than replacing the container wholesale. This is enforced by unit tests: the link is never created, never changed, and never restored after you delete it.
- **The anchor text is a constant, and it is the tool's name.** It cannot be customised from the UI, because a caller-supplied anchor is keyword-stuffing waiting to happen. We are not asking you for a keyword-rich link, and there is exactly one per list.

---

## Data sources

The tool calls five public APIs, directly from the visitor's browser. Thanks to all of them for keeping open, CORS-enabled endpoints — this project could not exist without that.

| Source | Role |
| --- | --- |
| [ORCID](https://orcid.org/) (`pub.orcid.org/v3.0`) | Primary seed. The researcher's own curated works record. |
| [PubMed / NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) | Seed by ORCID identifier (`[auid]`) or by query; supplies PMIDs, journals, dates, languages and publication types. |
| [researchmap](https://researchmap.jp/) (`api.researchmap.jp`) | Seed for Japanese researchers. The only source that reliably carries Japanese-language journal articles. |
| [OpenAlex](https://openalex.org/) | Enrichment only — never a seed. Fills in author names, work types and missing metadata from DOIs, PMIDs and titles, 50 identifiers per request. |
| [Crossref](https://www.crossref.org/) | Peer-review status for F1000-family open-review journals, and full author names when OpenAlex has none. |

OpenAlex is deliberately not used as a seed: its author disambiguation is not accurate enough to decide whose paper a record is.

---

## Running it locally

```bash
git clone https://github.com/ykfrkw/publication-list.git
cd publication-list
npm install
npm run dev      # wizard on http://localhost:5173/publication-list/
npm test         # unit tests (vitest)
npm run lint
npm run build    # dist/ — wizard, widget page, lists/, embed.js and v1/embed.js
```

`src/core/` is framework-free and shared by the React wizard and the embed bundle; nothing in it may import React or touch the DOM outside `parseConfigFromDataset`. `npm run build` runs two Vite builds: the app, then the embed bundle as a single self-contained IIFE with no hashed filenames. The app build also copies `lists/*.json` into `dist/lists/`, which is what makes `data-list` / `?list=` resolve on the deployed site; the dev server does not, so test a registry entry against `npm run preview`. CI fails the deploy if `dist/embed.js` exceeds 20 KB gzipped.

## Deploying your own copy

`.github/workflows/deploy.yml` builds and publishes on every push to `main`, but GitHub Pages has to be switched on once before that works: **Settings → Pages → Source: GitHub Actions**. Without it the workflow builds and then fails at the deploy step.

The site lands at `https://ykfrkw.github.io/publication-list/` — on a fork, at `https://<your-user>.github.io/<your-repo>/`, which is also the origin your snippets' `embed.js` URL has to point at.

The same workflow fails the build if `dist/embed.js` exceeds 20 KB gzipped. That gate is deliberate: the script goes into other people's pages, so its transfer size is a promise rather than an implementation detail.

## Citing

If this tool is useful in work you publish, see [CITATION.cff](CITATION.cff).

## License

MIT. See [LICENSE](LICENSE).
