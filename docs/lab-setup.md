# Add an auto-updating publication list to your lab website

A publication page that has to be edited by hand stops being edited. Within a year or two it reads as though the group stopped working. This guide sets up a list that rebuilds itself from ORCID, PubMed and researchmap every time somebody loads the page — no server, no account, no cron job, nothing to renew.

Budget about twenty minutes for a lab of five to ten people, most of which is collecting ORCID iDs.

---

## Before you start

You need:

- **The ORCID iD of each member you want on the list.** This is the one piece of homework, and it is the part that determines how good the result is.
- **The ability to paste HTML into your website.** A "Custom HTML" block, a raw-HTML widget, a page template — whatever your CMS calls it. If your CMS strips `<script>` tags, read [that section](#my-cms-strips-script-tags) first.

You do not need an account with anything, an API key, a server, or permission from the maintainers of this tool.

---

## Step 1 — Collect the ORCID iDs

An ORCID iD looks like `0000-0003-1317-0220`. Ask each member for theirs, or look them up at <https://orcid.org/orcid-search/search>.

Two things are worth checking while you are at it, because they decide what your page will show:

- **Is the member's ORCID works record actually populated?** Open `https://orcid.org/<their-iD>` and count. Many researchers register an iD and never add anything. A paper that is not in ORCID (and not in PubMed or researchmap) will not appear on your page — the tool can only show what has been registered somewhere. Members can auto-populate their record from Crossref, Scopus or Europe PMC in a few clicks from their ORCID account; that is a far better use of ten minutes than any workaround here.
- **Do any members have a researchmap profile?** If your group is in Japan, collect those permalinks too (the last part of `https://researchmap.jp/<permalink>`). researchmap is the only source in this tool that reliably carries Japanese-language journal articles.

Put it in a spreadsheet, one member per row, name in one column and identifier in another. You will paste it straight in.

## Step 2 — Generate the list

Open the wizard: <https://ykfrkw.github.io/publication-list/>

1. Choose the **Lab or group** mode.
2. Paste your member list into the members box. One member per line. It accepts a bare ORCID iD, an `https://orcid.org/…` URL, a researchmap permalink, or a row copied out of Excel in either column order — identifiers are found by shape, so `Name<TAB>ORCID` and `ORCID<TAB>Name` both work. Lines starting with `#` are ignored, and a header row is discarded. Each member then gets a row underneath with optional **Joined** / **Left** dates and a **Freeze** button; ignore both for now and read [When someone joins or leaves](#when-someone-joins-or-leaves) when your first member moves on.
3. Optionally add **pinned papers**: PMIDs and DOIs, pasted in any mixture of lines, commas and spaces. Use this for anything that predates a member's ORCID record, or for a paper credited to the group rather than to an individual.
4. Optionally add a **PubMed query** for a member who has no ORCID iD. See [that troubleshooting entry](#a-member-has-no-orcid-id) for how to write one that does not drown you in strangers.
5. Set the options you care about: citation style, grouping (a section per publication type with a year divider inside each to start with, or one of those two levels on its own, or one flat list), a `from` year if you only want recent work, whether Japanese-language records get their own section, and whether to **include preprints** — that box is unticked, so preprints stay off the page unless you ask for them.
6. Put the members' names in **bold names** so their own names are bolded in each citation. Spell them out in full — `Yuki Furukawa`, not `Furukawa Y`. Short forms cannot distinguish Yuki from Yuri, and the tool will warn you when a bold name lands on two different people.
7. Press **Generate**.

Read the warnings panel. It tells you which sources failed, which pinned identifiers could not be retrieved, which records were dropped as errata, and which preprints were held back — named, so you can see at a glance whether anything you expected to publish is on that list rather than on the page.

## Step 3 — Review the candidates

If you used a PubMed name search, you will get a **review queue**: papers that a name search found and that nothing else corroborates. They are *not* on your page yet.

Go through them and tick the ones that belong to your group. The tool pre-ticks candidates that share a co-author with the papers it is already sure about, but check them — that is a hint, not a verdict.

This is a one-time cost per paper. Your ticks become an `include` list and your rejections an `exclude` list, both stored in the configuration, so the same paper is never presented to you twice. New papers matching the query will show up as candidates on a future visit to the wizard; already-decided ones will not.

A rejection is the stronger of the two. If a paper somehow ends up in both lists — you pinned it by hand, or freezing pinned it for you, and later decided against it — `exclude` wins and the paper is off the page. That is deliberate: taking something off your publication list should never depend on finding where it was put on.

Records that come from ORCID, from researchmap, from a pinned PMID/DOI, or from a PubMed `[auid]` (ORCID-identifier) search never enter the queue. They are trusted outright.

## Step 4 — Paste it into your site

In the **Embed on a website** panel, copy the script snippet and paste it into a Custom HTML block on your publications page.

That is it. There is nothing to install and nothing to schedule.

A few things worth knowing about what you just pasted:

- **The list is inside the snippet.** The `<section class="publist">` block is a snapshot of the list as it stands now. It is in your page's HTML, so search engines index it and visitors with JavaScript disabled still see it. The script replaces it with a freshly fetched list on load.
- **It fails safe.** If the script cannot load, or an upstream API is down, the snapshot stays on the page. Your publication list never goes blank.
- **The credit link is one line and it is optional.** Untick "Include a credit link" before copying, or delete the `<p class="publist-credit">…</p>` line afterwards. Nothing else changes either way, and the checkbox applies to the iframe snippet too — see [that section](#my-cms-strips-script-tags).
- **The list ends with a second line saying where it came from**, and that has its own checkbox: "Say where the list came from". It is on by default because it tells your readers that a missing paper is a gap in ORCID rather than a claim about your group. Untick it, or delete the `<p class="publist-disclaimer">…</p>` line, if you would rather word the caveat yourself elsewhere on the page. Turning the credit off does not turn this off, and the other way round.
- **If the page cannot run JavaScript at all** — or your CMS eats the `<script>` tag — copy **Static HTML (no auto-update)** from the results panel instead and paste that. You lose the automatic updating; see [that section](#my-cms-strips-script-tags).
- **If the snippet is unwieldy**, use the hosted-configuration route instead. Open **Keep the settings in a file instead of in the snippet** (the wizard opens it for you when the attributes get too long for a CMS field, or when a PubMed query contains a comma), press **Download `pubs.json`**, put that file anywhere that serves it publicly — your own server, or a GitHub Gist raw URL, which needs no setup — and paste the URL into the field. The snippet collapses to a single `data-config` attribute, and editing that one file then changes the list on every page it is embedded in, with nothing to re-paste. This is the right choice for a lab that will keep adjusting the list.

Style it from your own stylesheet. The markup is unstyled and every class is namespaced `publist-`:

```css
.publist-heading    { font-size: 1.1rem; margin-top: 1.5em; }
.publist-subheading { font-size: 0.9rem; margin-top: 1em; opacity: 0.75; }
.publist-item       { margin-bottom: 0.6em; }
.publist-pmid       { color: #666; font-size: 0.9em; }
```

`.publist-heading` is the publication-type heading; `.publist-subheading` is the year divider inside it.

The last two lines are the exception: the source line and the credit line come with `style="font-size:0.8em;opacity:0.75"` already on them, so they look like small print on your page whether or not you style anything. An inline style beats your stylesheet, so to change them, edit that attribute in the snippet — it is sitting in your own markup — or add `!important` to your rule.

## Step 5 — Keep the configuration

Save the snippet, or the `pubs.json`, somewhere you can find it. When someone joins the group you will want to regenerate rather than start over — the wizard also keeps your last draft in the browser it was made in, but that is not a backup.

---

## When someone joins or leaves

This is the question every lab runs into, usually about eighteen months after setting the page up, and it is worth understanding before it happens.

The problem is one-sided. A new member is easy: add their line to the members box and regenerate. A departing member is not, because **their ORCID record follows them**. A seed left in place keeps working perfectly — it keeps finding everything that person publishes, including the papers they write at their next institution, which then appear on your group's page as though your group had produced them. Nobody notices, because nobody reads their own publication page looking for papers that should not be there.

Deleting the member's line the day they leave is the obvious fix and it is wrong. Work done in your group is routinely published a year or two after the person has gone, and that work is yours. Delete the seed and it never arrives.

### The answer: freeze them

In the **Lab or group** mode, each member has a row under the members box with a **Freeze** button. Generate the list first, then press it. The row tells you what it will do before you confirm:

> Pins the 11 papers of theirs that are on the list right now and removes their seed, so those stay and nothing they publish afterwards can be added.

That is the whole mechanism. Their publications become explicit `include` entries — pinned by DOI or PMID, exactly as if you had typed the identifiers yourself — and the seed comes out of the configuration. Nothing is inferred and nothing is guessed, so nothing can be got wrong later: a pinned paper cannot vanish, and a paper that does not exist yet cannot be pinned.

Three things to know:

- **A pin can be taken back.** Freezing pins whatever is on the list at that moment, and some of it may not belong to your group — a paper from their new institution that was already showing, or a plain misattribution. Press **Remove** on the paper's own line in the list below, and it comes off. `exclude` outranks `include`, so this works whether the pin was typed by you or written by freezing, and you never have to go looking through a twenty-entry `include` list for it. Nothing about it is silent: what you removed is listed under **N removed** above the list with an **Undo** beside it, and the warnings panel names any pin an exclude cancelled.
- **A paper with neither a DOI nor a PMID cannot be pinned.** There is nothing to pin it *by*. The confirmation tells you the count and names them before you commit, because those are the entries that will disappear from the list — usually conference abstracts and Japanese-language records from researchmap. If you need one of them, keep it another way (the **Static HTML** output, or a hand-written line in your page) before freezing.
- **It is recoverable.** Freezing comments the member's line out rather than deleting it — the line stays in the box, marked with the date and the number of papers pinned. Delete the `#` and the seed is back. Regenerate afterwards, and save the new snippet or `pubs.json`.

If a delayed paper of theirs comes out six months later, add it by DOI in the **Pinned papers** box. You would want to look at it before publishing it under your group's name anyway, which is precisely why that step is not automated.

### The fallback: dates, for when nobody freezes anybody

Labs forget. So each member row also has optional **Joined** and **Left** fields, and a member with a `Left` date stops contributing new work — after a grace period.

The grace period is the point. It defaults to **24 months**, and it exists so that the paper published eighteen months after your postdoc left still counts as your group's. That number is an estimate of ordinary publication lag — submission, review, revision, production — and not a rule from anywhere; if your field is faster or slower, write `2019-04..2023-03+36` straight into the members box to say 36 months instead.

Leave **Left** blank for anyone still in the group. A member with no dates at all is included with no time limit, which is what every member has always been and what they stay if you never touch these fields.

What the dates cannot do, and freezing can:

- They are a rule about publication dates, so they can be wrong about an individual paper — a genuinely delayed one past the grace period drops off, and a paper written elsewhere but dated early enough stays.
- Every paper a date window removes is **named in the warnings panel** with the window responsible. Read it after regenerating. Nothing is removed silently.

Two things the dates deliberately never do:

- **A pinned paper is never removed by a date window.** Anything in the pinned box, and anything freezing put there, is immune. An identifier you named outranks any rule about dates. The one thing that outranks a pin is the exclude list — that is how you take a pin back, and a date rule is not allowed to hold a paper on the page after you have said it should come off.
- **A co-authored paper survives on the co-author.** This is the one that would otherwise ruin a lab page: a paper written by a student who left *and* a member who is still here keeps the current member's claim on it and stays on the list. The dates are applied per member, not per paper, so one person's departure can never take another person's work off the page.

---

## Troubleshooting

### A member has no ORCID iD

Best answer: ask them to create one. It takes two minutes at <https://orcid.org/register>, it is free, and it fixes the problem permanently for every tool, not just this one.

If that is not going to happen, cover them with a PubMed query in the wizard's PubMed field. Write it *narrowly*:

```
Tanaka H[au] AND ("Univ Tokyo"[ad]) AND 2019:2026[dp]
```

A bare `Tanaka H[au]` returns hundreds of people. Constrain it with an affiliation (`[ad]`) and a date range (`[dp]`), then work through the review queue. If a query hits PubMed's 200-result cap the tool warns you that it is probably too broad.

Note that a comma inside a query cannot travel in an inline `data-pubmed` attribute — the attribute is comma-separated. Write `"Univ Tokyo"[ad]` rather than `Tokyo, Japan[ad]`, or use the hosted `pubs.json` route, where the query is a JSON string and the problem does not exist.

You can also just pin their papers by PMID or DOI. For a member with a handful of relevant publications this is faster and completely reliable.

### A member has a very common surname

You will see it as a long review queue. Three things help, in order of effectiveness:

1. **Use their ORCID iD, not a name search.** ORCID and `[auid]` searches are identifier-based and have essentially no same-name contamination.
2. **Narrow the query** with an affiliation and a date range, as above.
3. **Work the queue once and let it stick.** Each decision is recorded, so the queue shrinks to only genuinely new papers.

Do not switch `reviewPolicy` to `auto` to make the queue go away. That publishes unreviewed name-search hits directly to your page, which is how another Tanaka H's cardiology paper ends up in your neuroscience group's list.

### My CMS strips `<script>` tags

Common in university CMSes and locked-down WordPress installations. Symptom: you paste the snippet, save, and the list is there but never updates.

Check first — it may be working. View the page source and search for `embed.js`. If the `<script>` tag survived, the snippet is fine.

If it was stripped, you have three options.

**Use the iframe snippet.** The wizard emits one for exactly this case, under the collapsed **iframe snippet** heading below the script snippet:

```html
<iframe class="publist-frame" title="Publication list" loading="lazy"
  src="https://ykfrkw.github.io/publication-list/widget.html?orcid=0000-0003-1317-0220&style=vancouver"
  style="display:block;width:100%;border:0;height:900px;"></iframe>
```

The list is built the same way and updates the same way. Two differences worth knowing before you choose it:

- **The list is not in your page's HTML**, because the frame is a separate document. Search engines will not index it as part of your publications page, and a visitor with JavaScript disabled sees an empty frame. If your reason for having this page is that people can find your group's work, that matters.
- **The credit line obeys the same checkbox**, by a different route. It is rendered by our page rather than pasted into yours, so there is no line in your HTML to delete — instead, unticking "Include a credit link" adds `&credit=0` to the frame's `src`. You can add or remove that yourself later; without it, the credit is shown.
- **The source line does too**, and it needs no special route: unticking "Say where the list came from" adds `&disclaimer=hide` to the frame's `src`, which is the ordinary configuration parameter. The two are independent — `credit=0` leaves the source line, `disclaimer=hide` leaves the credit.

The snippet also carries a small inline `<script>` that resizes the frame to fit its content. If your CMS strips that too, the iframe still works — it just keeps the fixed 900px fallback height, which you can change in the `style` attribute.

**Ask for an exception.** The script is a single static file on GitHub Pages that makes no requests to any server we control. Many institutional CMS teams will allow a named script URL, and some strip scripts only in the rich-text editor while allowing them in a dedicated HTML block or a page template.

**Use the static HTML instead.** In the results panel there is a **Static HTML (no auto-update)** button. It copies the finished list as plain markup — no `<script>` tag, no wrapper `<div>`, no `data-` attributes, nothing for a sanitiser to take out. Paste it into the same rich-text field that ate the script and it will stay.

What you give up is in the name: it is a snapshot of today and it will not refresh itself. Regenerate and re-paste when you have new papers. Once or twice a year is still far less work than maintaining the list by hand, and you keep the list in your own page's HTML where search engines and JavaScript-less visitors can read it. This is also the right answer for a page that should not run any JavaScript at all — an intranet with a strict content policy, or a CV page you would rather keep inert.

The credit line and the source line follow the same two checkboxes here as everywhere else: untick either before copying, or delete the `<p class="publist-credit">…</p>` or `<p class="publist-disclaimer">…</p>` line afterwards.

### Our web team asks what the page contacts

A fair question, and the answer is short enough to forward.

The list is built in each visitor's own browser, which means the visitor's browser — not a server of ours — is what talks to the sources. On a page carrying the script snippet it requests `embed.js` from `ykfrkw.github.io` (GitHub Pages), and then, depending on which seeds you configured, `pub.orcid.org`, `eutils.ncbi.nlm.nih.gov` and `api.researchmap.jp`, plus `api.openalex.org` for author names and work types and `api.crossref.org` for peer-review status. Those hosts see the visitor's IP address and User-Agent, and your page's origin in the `Referer` header, exactly as an embedded font or image would.

They see nothing else. The embed sets no cookies and sends none; the only identifiers in any request are the ORCID iDs, permalinks and queries you put in the configuration, which are public and are the point of the list; and nothing in this project reports anything back to its author — there is no backend, no analytics and no telemetry, only static files on GitHub Pages.

If that is a problem, there are two answers. The [iframe snippet](#my-cms-strips-script-tags) moves the requests into a separate document, so no script of ours runs in your page — though the upstream APIs still see the visitor's IP, because the requests still have to be made by somebody's browser. The **Static HTML** output makes no external requests at all: it is inert markup, so nothing loads when the page renders. The full version of this is in the [README](../README.md#what-your-visitors-browsers-contact).

### Publications are missing

Almost always this is a gap in the source, not in the tool. In order of likelihood:

1. **The paper is not in the member's ORCID record.** Open `https://orcid.org/<their-iD>` and look. This is the single most common cause. The fix is in ORCID.
2. **You set a date filter.** Check the `from` / `to` fields, and the `limit`.
2b. **A member's Joined / Left dates ruled it out.** Every record a member window removes is named in the warnings panel with the window responsible. Widen the grace period, clear the dates, or pin the paper — a pinned paper is never removed by a window. See [When someone joins or leaves](#when-someone-joins-or-leaves).
2c. **It is in the exclude list.** Pressing **Remove** on it puts it there, and so does rejecting it in the review queue; an exclude outranks a pin, so a paper can be missing even though it is also pinned. Everything excluded is listed under **N removed** above the list — open it and press **Undo** to bring one back. The warnings panel names any pin cancelled this way.
3. **It was found only by a name search and is sitting unreviewed in the queue.** Under the default policy it is deliberately not on the page. Approve it.
4. **It was categorised as an erratum or as paratext and dropped.** The warnings panel names every record dropped this way.
5. **It is a preprint, and preprints are off by default.** The warnings panel names every one that was held back. Tick **Include preprints** if you want them on the page. Note that this also covers an F1000-family article whose referees have not approved it yet — see [that entry below](#an-f1000research-paper-shows-as-a-preprint).
6. **It is a Japanese-language paper and you set `japanese: hide`.** Or it is in the trailing "Japanese-language publications" section and you scrolled past it.
7. **It is genuinely in none of ORCID, researchmap or PubMed.** Pin it by DOI.

If a paper is in ORCID but still missing, check the warnings panel — an upstream failure is reported there rather than being swallowed, and a source that returned an error produces a shorter list, not a broken page.

### A former member's new papers are appearing on our page

Their seed is still in the list, and it is following them to their new institution. Fix it the way [that section](#when-someone-joins-or-leaves) describes:

1. **Press Freeze** on the member's row. Their seed comes out, so nothing further can arrive.
2. **Remove the papers that are not yours.** Freezing pins *whatever is on the list at that moment*, so anything of theirs from the new institution that was already showing has just been pinned along with the rest. Press **Remove** on each one where it sits in the list. Excluding beats pinning, so this works after the freeze as well as before it, and an accidental removal is one **Undo** away.
3. Regenerate, and save the new snippet or `pubs.json`.

The order is up to you — a pin is not a decision you are stuck with, and you can go on excluding papers months later when someone finally notices one. Freezing prevents future arrivals; it does not decide on your behalf which of the papers currently listed were done here. Nothing in this tool can, which is why step 2 is yours.

### The categories are wrong

A paper filed under "Other Publication Types" or an article shown as a letter usually means OpenAlex has the work type wrong. The default grouping puts those types on the page as headings, so a mistake is visible rather than hidden. Two workarounds:

- Set the grouping to `year` or to `none`, either of which sidesteps categorisation entirely. A reverse-chronological list with no type headings is a perfectly good lab page, and it cannot be wrong about a work type it never mentions.
- Report the metadata error to OpenAlex. It benefits everyone downstream, not just this page.

### An F1000Research paper is missing, or shows as a preprint

F1000-family journals publish before peer review, so a given article may genuinely not be approved yet. The tool asks Crossref whether referees have approved it: approved articles are filed as original articles, not-yet-approved ones as preprints. If Crossref has not been updated, the article is filed conservatively as a preprint.

Because preprints are off by default, that article is then **not on the page at all**. The warnings panel says so by name, and says how many. Two ways forward: tick **Include preprints**, which brings back every preprint including this one; or leave it, and the article moves into the list by itself once Crossref reports the referee approval — no edit needed at your end, because the list is rebuilt on every page load.

### The list shows an old version

The visitor's browser caches built lists in `localStorage` for 24 hours, and shows the cached copy immediately while fetching a fresh one — so a reload shows yesterday's list for an instant and then updates itself. If you are testing and want to force it, clear site data for your own page, or use a private window.

---

## See also

- [Full configuration reference](../README.md#listconfig-reference) — every field of `pubs.json`, and the complete `data-*` attribute table.
- [Limitations](../README.md#limitations) — what this tool gets wrong, in its own words.
- [The `lists/` registry](../lists/README.md) — why it is curated, and why you do not need it.
