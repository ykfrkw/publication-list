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
  <h4 class="publist-subheading">2026</h4>
  <ol class="publist-list">
  <li class="publist-item"><b>Furukawa Y</b>, Salahuddin NH, Wei Y, et al. Next-step treatment for schizophrenia non-responsive to antipsychotics: a systematic review and network meta-analysis. <em>eClinicalMedicine</em>. 2026.</li>
  <li class="publist-item">Fares-Otero NE, <b>Furukawa Y</b>, Sijbrandij M, et al. Efficacy of MDMA-assisted therapy for posttraumatic stress disorder: a systematic review and meta-analysis. <em>European Neuropsychopharmacology</em>. 2026.</li>
  </ol>
  </section>
  <p class="publist-disclaimer" style="font-size:0.8em;opacity:0.75">Compiled automatically from ORCID, PubMed and researchmap; errors or omissions in those records appear here too.</p>
  <p class="publist-credit" style="font-size:0.8em;opacity:0.75">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>
</div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

Paste it into your page. That is the whole installation.

Two things about that snippet are deliberate:

- **The list can be in the HTML already.** The `<section class="publist">` block is a snapshot of the list as it stood when the snippet was generated. Search engines index it, visitors with JavaScript disabled read it, and it appears instantly on a slow connection. `embed.js` replaces it with a freshly fetched list after the page loads — the snapshot is the floor, not the ceiling. The wizard offers it as a tick box (recommended, off by default, because it is most of the snippet's length); without it the container starts empty and the script fills it in. Either way the two small-print lines sit **outside** the section, so leaving the snapshot out never takes them with it.
- **`embed.js` never blanks the list.** If ORCID is down, if the network fails, if the script never loads at all, whatever is in the container stays on the page.

The container gets a `data-publist-state` attribute you can style against: `loading`, `cached` (a previous run restored from `localStorage`), `ready`, or `error`.

While the refresh runs, the script adds one small "Updating…" line laid out at zero height, so nothing on your page moves and the list is neither covered nor dimmed. A container that starts genuinely empty — a hand-written snippet with no snapshot — gets a spinner instead, because there is nothing else in it to look at. Both are removed the moment the list lands, and both are `publist-` prefixed and styled from a stylesheet the script injects only if it needs one.

Every class is namespaced `publist-`, and the markup is unstyled `<section>` / `<h3>` / `<h4>` / `<ol>` / `<li>` so it inherits your site's typography. Style it from your own stylesheet:

```css
.publist-heading    { font-size: 1.1rem; margin-top: 1.5em; }
.publist-subheading { font-size: 0.9rem; margin-top: 1em; opacity: 0.75; }
.publist-item       { margin-bottom: 0.6em; }
.publist-pmid       { color: #666; font-size: 0.9em; }
[data-publist-state="loading"] .publist { opacity: 0.7; }
```

Two elements are the exception. The last two lines — `.publist-disclaimer` and `.publist-credit` — arrive with `style="font-size:0.8em;opacity:0.75"` on them, so they read as small print on your page without needing any stylesheet of ours. `em` and `opacity` rather than a pixel size and a grey, so they stay in proportion to your body text and stay legible on a dark background. An inline style outranks your stylesheet, so if you want them to look like something else, edit the `style` attribute in the snippet — it is in your markup — or override it with `!important`.

### Pinned script URL

`https://ykfrkw.github.io/publication-list/embed.js` always serves the current build. `https://ykfrkw.github.io/publication-list/v1/embed.js` is the pinned copy: same file today, and it will keep the v1 behaviour if the format ever changes. Use the pinned URL if you would rather not be updated automatically.

---

## Coming back to a list you already made

**The snippet is the configuration.** Keep the block you pasted into your site — that is the whole of it, and there is nothing else to save. Every setting travels in the `data-*` attributes, so a copy of the snippet in a text file, an email to yourself, or the page it is already living on is a complete backup.

To pick it up again, **paste it back into the wizard** — "Start from an existing snippet", above the mode tabs — and the form fills in from it. The whole snippet works, and so does the opening `<div>` on its own or an iframe snippet.

Nothing is built until you press Generate, so you can see what came back and adjust it first. If anything could not be recovered, the wizard names it rather than quietly returning a different list — the cases are a PubMed query's label and dates (the transports carry the query text and the review tick only), member names and the pairing of an ORCID iD with a researchmap permalink, and the titles of records you had removed.

A URL is not accepted, and nothing is fetched from one. The wizard used to read settings out of a hosted `pubs.json` named by the paste; that route is gone, along with the file. See [Getting your configuration to the page](#getting-your-configuration-to-the-page).

## Getting your configuration to the page

There are two ways. Neither requires an account, an approval, or a pull request to this repository — and for all but a handful of lists, the first is the only one you need.

### 1. Inline `data-*` attributes

The normal route, for a person and for a lab alike. Everything is visible in your own HTML, and the snippet is the only thing you have to keep.

```html
<div class="publist-embed"
  data-orcid="0000-0003-1317-0220,0000-0002-1825-0097"
  data-style="apa"
  data-group-by="category"
  data-from="2020">
</div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

#### Full attribute reference

Read off `src/core/config.ts`. Values are trimmed; an empty attribute is treated as absent. **An unrecognized value for an enumerated attribute is silently ignored and the default applies** — a typo in `data-review-policy` falls back to the safe `strict`, it does not error.

| Attribute | Maps to | Accepted values | Default if absent |
| --- | --- | --- | --- |
| `data-orcid` | `seeds.orcid` | Comma-separated ORCID iDs. A full `https://orcid.org/…` URL is accepted and the prefix stripped. A member's time in the group may be appended as `iD@from:to:grace` — see [Seed time windows](#seed-time-windows). | none |
| `data-researchmap` | `seeds.researchmap` | Comma-separated researchmap permalinks. A `https://researchmap.jp/…` URL is accepted; only the first path segment is kept. Takes the same `@from:to:grace` suffix. | none |
| `data-pubmed` | `seeds.pubmed[].query` | Comma-separated PubMed queries. A comma **inside** a query is written `%2C` and read back as a comma, so `Furukawa Y[au] AND (Tokyo, Japan[ad])` travels intact — see [Commas inside a value](#commas-inside-a-value). The query text only: a PubMed seed's `label`, `from`, `to` and `grace` have nowhere to go on either transport. Its `trust` does travel, beside it, in `data-pubmed-trusted`. | none |
| `data-pubmed-trusted` | `seeds.pubmed[].trust` | Comma-separated **zero-based positions** within `data-pubmed` whose hits are published without review — `data-pubmed-trusted="0,2"` trusts the first and third query. Kept out of the query string itself so nothing has to be escaped inside somebody's search syntax. An index that is not a whole number, or points past the end of the list, is ignored, and that query falls back to needing review. | none — every query's hits are candidates |
| `data-include` | `include` | Comma-separated `pmid:12345678` / `doi:10.1136/bmj.n71`. Pinned records are shown whatever else the configuration says — except `exclude`. | none |
| `data-exclude` | `exclude` | Same format. Excluded records are dropped, **including pinned ones**: `exclude` outranks `include`. | none |
| `data-bold-names` | `boldNames` | Comma-separated author names to bold. Spell them out in full (`Yuki Furukawa`, not `Furukawa Y`). | every seeded member's own name |
| `data-style` | `style` | `vancouver`, `apa`, `harvard`, `chicago`, `nature` | `vancouver` |
| `data-group-by` | `groupBy` | `category-year`, `category`, `year`, `none` | `category-year` |
| `data-heading-level` | `headingLevel` | `auto`, or `2`–`5`. The level the publication-type headings render at; the year dividers always sit one level below (never past `<h6>`). `auto` measures the host page — see below. Anything else, `1` and `6` included, is an unrecognized value and falls back to the default. | `auto` — **except in a snippet with the list baked into it, where the wizard writes an explicit `3`** |
| `data-preprints` | `preprints` | `include`, `exclude` | `exclude` — preprints are left off unless you ask for them |
| `data-japanese` | `japanese` | `separate`, `merge`, `hide` | `separate` |
| `data-review-policy` | `reviewPolicy` | `strict`, `auto` | `strict` |
| `data-disclaimer` | `disclaimer` | `show`, `hide` | `show` — the list says it was compiled automatically |
| `data-from` | `from` | `YYYY` or `YYYY-MM`. A bare year means January of that year. | no lower bound |
| `data-to` | `to` | `YYYY` or `YYYY-MM`. A bare year means December of that year. | no upper bound |
| `data-limit` | `limit` | Positive integer. Applied after sorting, so you keep the newest N. | no limit |
| `data-list` | — | Id in this repository's curated `lists/` registry. See below. | none |

What the values mean:

- **`style`** — the citation format. All five are ported from the R original; `vancouver` is the default.
- **`groupBy`** — **the default is `category-year`**, which is two levels: an `<h3>` per publication type — Original Articles & Reviews / Letters / Editorials / Other Publication Types, plus Preprints if `preprints` is `include` — and inside each of those an `<h4>` per publication year, newest first, with an `Undated` bucket last *within its own type*. It answers both of the questions a publication page gets asked, what kind of work this is and how recent it is, without the reader scanning dates down the citations. The other three give you one level or none: `category` is the type headings alone, `year` the year headings alone, and `none` one flat numbered list — which is what you want for an article's reference list, where the numbers are what the prose cites. Each heading starts its own `<ol>`, so the numbering restarts under it; only `none` produces a single unbroken sequence. Under `japanese: separate` the Japanese-language section stays last, undivided, whichever of the four you pick.
- **`headingLevel`** — what level the type headings come out at, so the list fits the outline of the page it is pasted into. **The default is `auto`, and automatic measures the host page**: `embed.js` takes the last heading that comes before the container in document order and renders one level below it, clamped to 2–5 — under an `<h2>` the sections are `<h3>`, under an `<h1>` they stay `<h2>` rather than claiming the page title's level, and under an `<h5>` or `<h6>` they stop at `<h5>` so the year dividers still have an `<h6>` to sit on. Headings inside the container are ignored, so a baked-in list is never measured against itself. With no preceding heading at all — a list at the top of a page — it falls back to `3`. **A snapshot changes the default to an explicit `3`.** The wizard bakes that copy of the list before it knows what page it will be pasted into, and a level that later shifted on load would leave exactly the readers the snapshot exists for — crawlers, and visitors with JavaScript off — holding the wrong outline permanently; so with the box ticked the level is resolved once and written into both the baked markup and `data-heading-level`, and the wizard's "Heading level" select disables Automatic and shows the number you will get. Un-tick the box and the stored choice is still `auto`.
- **`preprints`** — whether preprints appear at all. **The default is `exclude`**: a publication list normally means published work, and an unlabelled manuscript sitting among journal articles overstates it. Nothing disappears quietly — every excluded preprint is named in the model's warnings, with the count and how to turn them on. `include` puts them back, in their own "Preprints" section under `groupBy: category`. Note what counts as a preprint: anything on a preprint server (medRxiv, bioRxiv, arXiv and the rest of the list in [Limitations](#limitations)), anything the source typed as a preprint, **and an F1000-family article that Crossref does not yet report as approved by referees** — see [Limitations](#limitations).
- **`japanese`** — what to do with Japanese-language records, which in practice come from researchmap. `separate` puts them in a trailing "Japanese-language publications" section. `merge` interleaves them with everything else. `hide` drops them (before `limit` is applied, so a limit of 10 still yields 10 visible entries).
- **`reviewPolicy`** — `strict` publishes only records the tool is confident about; anything a PubMed *name* search turned up stays off the page until you confirm it. `auto` publishes name-search hits immediately. Read [Limitations](#limitations) before choosing `auto`.
- **`include`** — the way to put specific papers on the list. A pinned PMID or DOI is confirmed outright: it is published whatever found it, it is exempt from the seed time windows, and it appears in an embed. This is what a PubMed query cannot do — **a candidate never appears in an embed**, and there is no review queue on an embedded page to change that. If you know which papers you want, pin them rather than searching for them.
- **`disclaimer`** — the one-line note under the list saying it was compiled automatically from ORCID, PubMed and researchmap and inherits their errors. **On by default**, and worth leaving on: it is what tells a reader that a missing paper is a gap in a database rather than a claim about the group. `hide` removes it. It is a separate switch from [the credit link](#the-credit-link) in both directions — turning either off leaves the other alone.

#### Commas inside a value

Six attributes are comma-separated lists, and a realistic PubMed query contains a comma: `Furukawa Y[au] AND (Tokyo, Japan[ad])`. So every value is escaped on the way out and unescaped on the way in, for exactly two characters:

| written | read back |
| --- | --- |
| `%` | `%25` |
| `,` | `%2C` |

Nothing else is touched — quotes, brackets, spaces and `&` are left as they are. `%2C` in a value you type comes back as the literal text `%2C`, not as a comma, because the `%` was escaped first. The same rule applies to the iframe's query string; `src/core/config.ts` holds both halves so the two transports cannot drift apart.

This is why there is no size or shape of configuration that the snippet cannot carry, and why there is no longer a hosted-file route.

### 2. `data-list` — the curated registry

```html
<div class="publist-embed" data-list="furukawa"></div>
<script src="https://ykfrkw.github.io/publication-list/embed.js" defer></script>
```

The id is resolved against the script's own URL (`…/publication-list/lists/<id>.json`), and is validated first: it must be a bare filename — letters, digits, dot, dash, underscore, starting with a letter or digit — so it cannot climb out of `lists/`. All three consumers (the embed script, the widget and the wizard's restore) apply the same check, from one definition in `src/core/config.ts`.

This registry is small, curated, and **not open for submissions** — it exists for the maintainer's own lists and a handful of groups he was asked to host. Everyone else uses the snippet above, which carries the same settings with no gatekeeper and nothing to host. See [lists/README.md](lists/README.md).

**Precedence:** inline `data-*` attributes win over the registry file. The two are merged shallowly, and `seeds` is merged one key at a time — so `data-orcid` on the container replaces the `seeds.orcid` array from the file, but leaves `seeds.researchmap` from the file alone.

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
- **camelCase spellings are accepted** for every hyphenated name: `groupBy`, `boldNames`, `reviewPolicy`, `headingLevel` and `pubmedTrusted` work as well as `group-by`, `bold-names`, `review-policy`, `heading-level` and `pubmed-trusted`.

`?list=` works like its attribute counterpart, and is validated the same way and by the same function: a bare filename, so it cannot climb out of `lists/`. There is deliberately no parameter that names an arbitrary URL for the widget to fetch.

One parameter has no `data-*` counterpart: **`?credit=0`** turns the credit line off inside the frame. It is how the wizard's "Include a credit link" checkbox reaches this route — see [The credit link](#the-credit-link). `credit=false`, `credit=off` and `credit=no` mean the same thing; anything else, including no parameter at all, leaves the credit on.

The source disclaimer needs no such special case: `disclaimer` is an ordinary configuration field, so **`?disclaimer=hide`** works here exactly as `data-disclaimer="hide"` does on the script snippet. The two switches do not touch each other — `?credit=0` leaves the disclaimer, `?disclaimer=hide` leaves the credit.

The trade-off against the script snippet follows from the content living in a separate document: **there is no snapshot.** The list is not in your page's HTML — see [Limitations](#limitations).

---

## Static HTML — paste once, no JavaScript

Some pages should not run anything at all: a personal CV page you maintain by hand, a departmental template where the only editable thing is a rich-text field, an intranet with a strict content policy. For those, the wizard's results panel has a **Static HTML (no auto-update)** button. It copies the finished list and nothing else:

```html
<section class="publist">
<h3 class="publist-heading">Original Articles &amp; Reviews</h3>
<h4 class="publist-subheading">2026</h4>
<ol class="publist-list">
<li class="publist-item"><b>Furukawa Y</b>, Salahuddin NH, Wei Y, et al. Next-step treatment for schizophrenia non-responsive to antipsychotics: a systematic review and network meta-analysis. <em>eClinicalMedicine</em>. 2026.</li>
</ol>
<p class="publist-disclaimer" style="font-size:0.8em;opacity:0.75">Compiled automatically from ORCID, PubMed and researchmap; errors or omissions in those records appear here too.</p>
<p class="publist-credit" style="font-size:0.8em;opacity:0.75">Auto-updated with <a href="https://yukifurukawa.jp/publication-list-generator/">Publication List Generator</a></p>
</section>
```

No `<script>` tag, no `.publist-embed` wrapper, no `data-*` attributes — nothing for a sanitiser to strip and nothing for a browser to execute. It is the same markup, from the same renderer, as the snapshot inside the script snippet.

**It does not update itself.** That is the entire difference, and it is the reason to pick one of the other two routes if you can. Regenerate and re-paste when you have new papers; once or twice a year is still less work than maintaining the list by hand, and the page never has a stale-looking gap in the meantime because you can see exactly what is on it.

The "Include a credit link" checkbox governs this output as well — see [The credit link](#the-credit-link).

Choosing between the three:

| Route | Updates itself | In your page's HTML | Needs `<script>` |
| --- | --- | --- | --- |
| [Script snippet](#quickstart) | yes | optional — tick the box for a snapshot, then live | yes |
| [iframe](#the-iframe-fallback) | yes | no | no |
| Static HTML | no | yes | no |

---

## `ListConfig` reference

The `ListConfig` document, defined in `src/core/types.ts`. Every field except `v` and `seeds` is optional. This is the shape a `lists/*.json` registry file has on disk, and the shape every `data-*` attribute set projects onto once it is parsed.

```ts
{
  v: 1                                  // schema version; always 1
  seeds: {
    // Seed = string | { id: string, from?: string, to?: string, grace?: number }
    orcid?: Seed[]                      // ORCID iDs
    researchmap?: Seed[]                // researchmap permalinks
    pubmed?: {
      query: string, label?: string,
      trust?: 'confirmed' | 'candidate',   // default 'candidate'
      from?: string, to?: string, grace?: number
    }[]
  }
  include?: string[]                    // "pmid:12345678" | "doi:10.1136/bmj.n71"
  exclude?: string[]                    // same format
  boldNames?: string[]                  // full names to bold in the author lists
  style?: 'vancouver' | 'apa' | 'harvard' | 'chicago' | 'nature'
  from?: string                         // "YYYY" | "YYYY-MM"
  to?: string                           // "YYYY" | "YYYY-MM"
  groupBy?: 'category-year' | 'category' | 'year' | 'none'  // default 'category-year'
  headingLevel?: 'auto' | 2 | 3 | 4 | 5 // default 'auto'; 3 when a snapshot is baked
  preprints?: 'include' | 'exclude'     // default 'exclude'
  japanese?: 'separate' | 'merge' | 'hide'
  reviewPolicy?: 'strict' | 'auto'
  disclaimer?: 'show' | 'hide'          // default 'show'
  limit?: number                        // positive integer
}
```

Notes that are easy to get wrong:

- **`seeds.pubmed[].query` is a raw PubMed query string.** A query ending in `[auid]` is an ORCID identifier search and its hits are trusted outright. Any other query — including `Furukawa Y[au]` — is a name search, and its hits become *candidates*: they do not appear on the page under the default `strict` policy until you confirm them in the wizard's review queue. `label` is cosmetic; it is what the record's provenance is attributed to.
- **`seeds.pubmed[].trust` opts one query out of review, and defaults to `'candidate'`.** Set it to `'confirmed'` and every hit — including hits the query has not made yet — goes straight into `publications` and therefore into an embed, with no review step. It is an assertion by whoever wrote the config that the query returns their group's work and nobody else's, so run it on PubMed and read the results first. It is deliberately never inferred: `[auid]` is promoted automatically because an ORCID iD is a unique identifier, whereas every other PubMed author field holds a **name**, including `[cn]` — two groups can share an acronym, and a free-text `SLEEPI` search already returns an unrelated SLEEP-I trial. Anything other than the exact string `'confirmed'` is dropped and the seed is reviewed, so a typo fails safe. `exclude` still outranks it, which is how a wrong hit comes off. **On the inline routes it travels beside the query rather than inside it** — `data-pubmed-trusted="0,2"` / `?pubmed-trusted=0,2`, the zero-based positions within `data-pubmed` — because a flag hidden in the query text could be mistaken for part of the search. The wizard writes both attributes in one pass, so the positions always line up.
- **A group is found with `[cn]`, not `[au]`.** PubMed files a collective author — a study group, a trial consortium — in its own field. Measured against the live API on 2026-08-06: `"RECOVERY Collaborative Group"[au]` returns 0 records; `"RECOVERY Collaborative Group"[cn]` returns 18, translated by PubMed as `[Author - Corporate]`. **An `[au]` search returning nothing is not evidence that the group is absent from PubMed** — check `[cn]` before concluding that. If `[cn]` is empty too, the journals never supplied a collective name for those articles and no query will reach them; pin the papers by PMID or DOI instead. The wizard hints at this when a query looks like a group name in `[au]`.
- **`groupBy` defaults to `'category-year'`, and omitting the field means type headings with year dividers inside them.** The default has changed before, so a registry file that leaves the field out regroups itself when it changes again. Write the value out if you want it pinned. The wizard's snippet does not have this problem: it writes `data-group-by` whenever the value is not the current default, so a snippet always renders what you saw.
- **`headingLevel` defaults to `'auto'`, and `'auto'` is answered by the page, not by the config.** Only `embed.js` can answer it, because only it runs inside the document the list was pasted into; every other renderer — the static HTML export, the iframe widget, the wizard preview — resolves `'auto'` to `3`. The one place the setting is decided rather than copied is the wizard's snippet builder, which collapses `'auto'` to an explicit `3` when it bakes the list into the snippet, so the baked headings and the live ones cannot drift. See [the attribute table](#full-attribute-reference).
- **`disclaimer` defaults to `'show'`, and omitting the field means shown.** A registry file written before this field existed therefore gains the source note on the next page load. That is the intended direction: the note is only ever absent because someone decided it should be.
- **`preprints` defaults to `'exclude'`, and omitting the field means excluded.** A registry file written before this field existed therefore loses its preprints on the next page load. The wizard's snippet writes `data-preprints` out explicitly whenever preprints are on, so a snippet says what you meant.
- **`include` is not just "extra papers".** It also force-confirms a record another seed already found. That is the mechanism the review queue uses: a confirmed candidate goes into `include`, a rejected one into `exclude`, and neither is ever asked about again.
- **`exclude` wins over `include`.** A reference in both lists is dropped. Excluding is the corrective act — it is how a pin gets undone — and pins are no longer only ever typed one at a time: [freezing a member](docs/lab-setup.md#when-someone-joins-or-leaves) writes their whole publication list into `include` in one click. So getting one of those wrong has to be recoverable without hand-editing a twenty-entry list, and "take this off my page" always works — in the wizard it is the **Remove** control on the publication's own line, and what it removed is listed above the list with an **Undo**. It is not silent: a pin an exclude cancels is named in the model's warnings, once, with the count and the references, so a configuration you inherited tells you its two lists disagree rather than quietly picking a side.
- **A pinned base DOI also matches the versioned records of the same work.** `doi:10.12688/f1000research.12345` catches `.1` through `.4`. An exclude is read as generously, and across identifiers: excluding a work by PMID cancels a pin that names it by DOI.
- **Unrecognized `include` / `exclude` strings are reported, not silently dropped** — they land in the model's warnings.

### Seed time windows

A seed may be a bare string or an object bounding it to the period its owner was part of the group. **A bare string means exactly what it always meant** — no window, no filtering — so every configuration written before this existed keeps its behaviour untouched, and a list with no departed members never needs the object form.

```json
{
  "seeds": {
    "orcid": [
      "0000-0003-1317-0220",
      { "id": "0000-0002-1825-0097", "from": "2019-04", "to": "2023-03" },
      { "id": "0000-0001-2345-6789", "to": "2021-09", "grace": 36 }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | the ORCID iD, researchmap permalink, or a PubMed seed's `label ?? query` |
| `from` | `YYYY` or `YYYY-MM`. Omit for an open start. |
| `to` | `YYYY` or `YYYY-MM`. **Omit for a member who is still here** — no end at all. |
| `grace` | months after `to` in which a paper still counts. Default **24**; `0` makes `to` hard. |

A publication contributed by a windowed seed is kept when its year-month falls in `[from, to + grace]`.

**The 24-month default reflects typical publication lag** — the gap between finishing work in a group and seeing it in print, through submission, review, revision and production. It is a pragmatic estimate chosen to be forgiving, not a rule derived from anything, and a group that knows its own field's timelines should set `grace` deliberately.

Four rules worth knowing, because they are what keep this from removing real work:

- **Filtering is per seed, not per publication.** A paper co-authored by a departed student and a current member keeps the current member's seed and stays on the list. Only a record that has lost *every* seed is removed. (Concretely: the out-of-window ids are dropped from the record's `seedIds`, and the record goes only when that leaves none.)
- **Pinned records are exempt.** Anything in `include` is never removed by a window. An explicit identifier outranks a date rule — and that is also what makes freezing a member safe. The exemption does not extend to a record you have also excluded: `exclude` outranks `include`, so a pin you have taken back is not held in place by it.
- **Removals are reported.** Every record a window drops is named and counted in the model's warnings, with the window responsible, and so is the number of records another member's window rescued.
- **An undated record is kept.** A record with no usable year cannot be placed inside or outside a window, and missing metadata is not a reason to take work off a CV.

**How a window travels:**

| Route | Carries a window on `seeds.orcid` / `seeds.researchmap` | Carries one on `seeds.pubmed` |
| --- | --- | --- |
| `lists/*.json` (`data-list`) | yes, as the object above | yes |
| `data-orcid` / `data-researchmap` | yes, as `id@from:to:grace` | — |
| `?orcid=` / `?researchmap=` (iframe) | yes, same encoding | no |

The inline encoding is positional and every field is optional: `0000-0002-1825-0097@2019-04:2023-03`, `…@2019-04` (still here), `…@:2023-03` (open start), `…@2019-04:2023-03:0` (no grace). It contains no commas, so it survives the comma-joined attributes unchanged, and a value whose tail is not *exactly* a window is left alone entirely — an id containing an `@` is never reinterpreted.

The one thing that does not travel inline is a window on a **PubMed** seed, for the same reason `label` does not: the attribute's value is a raw PubMed query, and reading part of one as a date range would be a guess about somebody else's search syntax. A windowed PubMed seed can therefore only come from a `lists/*.json` registry file. The wizard never produces one, so it cannot lose one; when it reads one it says so rather than dropping it silently.

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
  "groupBy": "category-year",
  "japanese": "separate",
  "preprints": "exclude",
  "reviewPolicy": "strict",
  "disclaimer": "show",
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

**A group name belongs in `[cn]`, and `[au]` returning nothing proves nothing about it.** PubMed keeps collective authors in a separate field: `"RECOVERY Collaborative Group"[au]` → 0 records, `"RECOVERY Collaborative Group"[cn]` → 18 (live API, 2026-08-06). A group that searches `[au]`, finds nothing and concludes it is not indexed has been misled by a field name, so the wizard hints at the shape. `[cn]` is still a *name* rather than an identifier, though, so it is not auto-trusted the way `[auid]` is — a search that genuinely returns only your group's work is opted out of review per query with [`seeds.pubmed[].trust`](#listconfig-reference), which is an assertion you make after reading the results, not something the tool infers.

**A candidate never appears in an embed.** Reviewing happens in the wizard and nowhere else: an embedded page has no queue and nobody at the other end of a page load to work through one, so under the default `strict` policy an unconfirmed candidate is absent from the embed permanently, not temporarily. This has two consequences worth stating outright. First, the wizard preview is a superset of what the page will show — the preview has a review queue under it, the page does not — so a list with outstanding candidates embeds fewer records than you are looking at, and the wizard says so with the count beside the snippet. Second, a list whose records are *all* unconfirmed candidates embeds nothing at all, for ever; the wizard diagnoses that case and refuses to generate a snippet for it rather than handing over markup that would render an empty list on someone's site. **If you know which papers you want, pin them by PMID or DOI** — `include` entries are confirmed outright and are the only route that reliably puts a named paper into an embed.

**Publication type classification is imperfect.** Categories (original article, preprint, letter, editorial, other) come mostly from OpenAlex work types, falling back to the type ORCID or researchmap reported. OpenAlex gets this wrong sometimes, and there is no cross-source vote to catch it. Preprint servers are detected by journal-name matching against a fixed list (medRxiv, bioRxiv, arXiv, SSRN, ChemRxiv, PsyArXiv, preprints.org, Research Square, Authorea) — a server not on that list will be miscategorised. Records that OpenAlex types as `erratum` or `paratext` are dropped from the list entirely, and the drop is reported in the warnings rather than done silently.

**Preprints are hidden by default, and an unapproved F1000 article counts as one.** `preprints` defaults to `exclude` (see [the attribute table](#full-attribute-reference)). For F1000-family open-review journals, Crossref is consulted to decide whether an article has been approved by referees (original article) or not yet (preprint) — so an F1000Research paper whose referee reports have not landed, or whose Crossref record has not caught up, is filed as a preprint and is therefore **also hidden by default**. That is the intended reading: it has been posted, not yet peer-reviewed. It is still a surprise if you were not expecting it, which is why every held-back record is named in the warnings with its count, and why turning them all back on is one setting: `preprints: 'include'`, or the wizard's "Include preprints" checkbox.

**Speed.** Measured 2026-08-05 against ORCID `0000-0003-1317-0220` (34 publications):

| Configuration | Requests | Wall time |
| --- | --- | --- |
| ORCID only | 5 | ~2.6 s |
| ORCID + researchmap + PubMed | 6 | ~4.5 s |

The bottleneck is researchmap's response time, not the number of requests. **This is largely not what your visitors experience**: a cached list from a previous visit is on screen immediately, and with the snapshot box ticked the pre-rendered list is there from the first paint; the live fetch swaps in when it lands. A first-time visitor to a snippet with no snapshot does wait for it, which is one of the reasons the box is recommended.

**Author names are only as good as the source.** ORCID work summaries carry no author list at all — author names come from OpenAlex enrichment. researchmap stores short forms (`Türkmen C`) in a field that reads like a full-name field, and its author ordering varies between accounts. Bold-name matching therefore works on full names; if you give it `Furukawa Y` it cannot tell Yuki from Yuri, and the tool will warn you when a bold name lands on two different people.

**Group membership is not something the sources know.** Neither ORCID nor PubMed will tell you that a student left your lab in 2023, so nothing here can work it out on its own. The reliable answer is to [freeze a member](docs/lab-setup.md#when-someone-joins-or-leaves) when they go, which converts their work so far into explicit pins and removes the seed — no inference involved. Freezing pins whatever is on the list at that moment, so it can pin something that does not belong there; excluding the record afterwards removes it, because `exclude` outranks `include`. [Seed time windows](#seed-time-windows) are the fallback for when nobody remembers to, and they are a rule about dates: a paper genuinely delayed past the grace period drops off, and a paper the departed member wrote elsewhere but dated inside the window stays. Both outcomes are reported in the warnings, and neither can happen to a pinned record. Affiliation-based filtering — asking OpenAlex which institution an author gave *on that paper* — is the semantically correct answer and is deliberately not implemented: the institution data varies in quality and its accuracy has not been measured here.

**The iframe fallback carries no snapshot.** The `<iframe>` route (below) exists for CMSes that strip `<script>` tags, and it works — but its content is a separate document, so it is not in your page's HTML. Search engines do not index it as part of your page, and a visitor with JavaScript disabled sees an empty frame. Use the script snippet unless your CMS forces you not to.

---

## The credit link

The snippet the wizard generates ends with one line:

> Auto-updated with [Publication List Generator](https://yukifurukawa.jp/publication-list-generator/)

**It is optional.** There is a checkbox labelled "Include a credit link" in the wizard; untick it and the snippet contains no link at all. Nothing else changes — same output formats, same live updating, same everything. There is no reminder, no watermark and no reduced functionality. If you have already pasted a snippet, delete the `<p class="publist-credit">…</p>` line; it will not come back.

**All three routes obey the same checkbox**, with one difference in mechanism that follows from where the markup lives. In the script snippet and in the [static HTML](#static-html--paste-once-no-javascript) the credit is a line of your own HTML, so unticking the box simply does not write it. In the [iframe fallback](#the-iframe-fallback) the credit is rendered by our page rather than by your markup, so there is no line for you to delete — unticking the box appends `credit=0` to the frame's URL instead, and the widget renders no credit at all. Add or remove that parameter by hand later and it behaves the same way. A frame URL that says nothing about the credit keeps it, so nothing you have already pasted changes.

**Being straight about it:** that link is how people find this tool. It is unpaid work given away for free, and word of mouth from the pages it runs on is the only distribution it has. Keeping it is a kindness, not a condition.

Two design decisions worth stating, because they are the difference between attribution and link spam:

- **`embed.js` never creates, modifies or removes the credit link.** The link exists only in the static HTML you copied, in your own markup, where you can see it and delete it. The runtime script cannot emit one even by accident — the code path that runs on your page is called with credit rendering switched off — and when it refreshes the list it works around any `.publist-credit` node rather than replacing the container wholesale. This is enforced by unit tests: the link is never created, never changed, and never restored after you delete it. The same is true of the `.publist-disclaimer` node beside it, for a plainer reason: what you pasted is yours, and a script of ours putting back a line you deleted would be overruling you on your own page.
- **The anchor text is a constant, and it is the tool's name.** It cannot be customised from the UI, because a caller-supplied anchor is keyword-stuffing waiting to happen. We are not asking you for a keyword-rich link, and there is exactly one per list.

---

## The source disclaimer

The list also ends with one line saying where it came from:

> Compiled automatically from ORCID, PubMed and researchmap; errors or omissions in those records appear here too.

It is on by default. It is there because the person reading your lab page has no way of knowing that a missing paper is a gap in ORCID rather than a statement about your group, and because a list nobody typed out should say so.

**It is a separate switch from the credit link, in both directions.** The wizard has its own checkbox for it ("Say where the list came from"), and turning the credit off leaves the disclaimer in place, exactly as turning the disclaimer off leaves the credit. They say different things: one is attribution for a tool, the other is a statement about the list's provenance. Set `disclaimer: 'hide'` — or `data-disclaimer="hide"`, or `?disclaimer=hide` — if you would rather carry the caveat somewhere else on the page in your own words.

It carries no link, so it can never function as a second credit. Like the credit, it lives in the static markup you paste and `embed.js` neither creates it nor removes it.

The Word output has its own, longer version of the same note, in red at the top of what you paste — that one is addressed to you rather than to your readers, and it ends by asking you to check the list over.

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
