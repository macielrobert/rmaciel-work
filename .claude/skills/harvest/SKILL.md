---
name: harvest
description: How Robert's Harvest app works and how to publish what it writes. Use when Robert mentions Harvest, crawling his folders, the review queue, working titles / nicknames, "publish the harvest", or asks to change, debug or test tools/harvest.js.
---

# Harvest

A local crawler with a review queue that fills Keystatic projects from Robert's
own files. The server is `tools/harvest.js` (Node built-ins plus macOS tools);
the page is `tools/harvest/page.html`, `page.css`, `page.js`, read from disk on
every request (a page edit needs only ⌘R; a server edit needs quit + reopen).
The launcher is `tools/Harvest.command`. Nothing in it ships to the site.

## How it runs

- **Harvest.app** (preferred): built by `tools/build-app.sh` into `app-build/`
  (git-ignored) as `Harvest.app` + `Harvest.dmg`. A Swift shell
  (`tools/HarvestApp.swift`) that starts `tools/harvest.js` and shows it in a
  WKWebView. Rebuild only if the repo moves; harvest.js changes need no rebuild.
  Server log: `~/Library/Application Support/Harvest/harvest.log`.
- `tools/Harvest.command`: the same server in Terminal + the default browser.
- Never run both at once: they share one state file.

## What Robert does

1. Double-clicks `tools/Harvest.command`. It runs `git pull --ff-only` and opens
   the page in his browser.
2. Picks a folder in the tree and clicks **Crawl this folder**.
3. For each project: accepts or rejects cards. Text is editable; images need alt
   text; text cards choose a target (description / detail lines / share).
4. Clicks **Write to project**, then **Publish** (top right). Publish runs
   build.js, commits ONLY content/ and images/ as "Harvest: <slugs>", pulls with
   rebase, pushes to main. On a clash it undoes its commit and says "ask Claude
   to publish" — that is the case below.
5. Bulk: tick cards → Accept / Reject / Move to project (moved cards arrive
   accepted; the original is kept rejected+hidden so a re-crawl can't refile it).
   Rejected → Clear hides them but keeps them rejected.
6. New project (Projects column): writes a draft .mdoc; needs a grid icon in
   /keystatic before it can go live.

## What "publish the harvest" means for Claude

Harvest only writes files; it never commits. So:

1. `git status` — expect changes under `content/projects/*.mdoc` and new files
   under `images/<slug>/images/<n>/`.
2. `git diff content/` and read it. Harvest APPENDS (images, paragraphs, detail
   lines) and may set `share_description` and `nicknames`. Anything else
   changed is not Harvest's doing — stop and ask.
3. `node build.js` must pass. If it fails, the error names the file and field.
4. Commit and push to `main` (standing rule: Robert approves shipping to main
   without being asked). Then confirm the live site at
   `https://rmaciel-work.netlify.app/` matches a fresh `dist/index.html`.

## Where things live

| What | Where |
|---|---|
| Findings, decisions, last crawl root | `~/Library/Application Support/Harvest/state.json` |
| Image fingerprints | `.../Harvest/hash-cache.json` |
| Document text, one file per document | `.../Harvest/text/` |
| Thumbnails | `.../Harvest/thumbs/` |

Deleting the Harvest folder resets everything, including every accept/reject.

## Working titles

`nicknames` on a project (Keystatic: "Working titles") are names the work was
saved under before it was named ("Wave House" for BUS STOP). The crawler matches
them exactly like the title. It also infers them: a 64-bit difference hash of
every site image against every crawled image; a near-duplicate inside a folder
with another name becomes a "Working title?" card. build.js ignores the field.

## Testing changes to harvest.js

Never test against Robert's real state or repo content without reverting:

- Run with a scratch home: `HOME="$TMPDIR/hv" HARVEST_NO_OPEN=1 node tools/harvest.js`.
  The state folder then lives under that fake home.
- `/api/*` POSTs need `Origin: http://127.0.0.1:<port>` or they get 403.
- Accepting a working title, **Write** and Organize's **Save** write into
  `content/projects/`. Afterwards `git checkout` ONLY the files your test
  changed — never all of `content/`: Robert's unpublished work lives there —
  and delete any new `images/<slug>/images/<n>/` you created.
- Before pushing a Harvest change, once: `node tools/check-harvest.js` (syntax
  of server and page script, CSS braces, every `$('id')` exists, and a scratch
  server serves the page). It starts and stops its own copy by PID.
- Commits that touch only `tools/` end the message with `[skip ci]`, so Netlify
  doesn't run a build (and charge credits) for something that doesn't change the site.

## What it reads

| Source | How |
|---|---|
| PDF / .ai text layer | PDFKit via osascript JXA |
| PDF pages with no text (Rhino tiled-PNG exports, InDesign layouts of them) | OCR: Apple Vision, a Swift helper compiled once into `.../Harvest/ocr` (~1 min the first time) |
| .indd | InDesign itself, only when the checkbox is ticked |
| .3dm | the Notes panel, read from the file's properties table (first 8 MB only) |
| .docx .doc .rtf .odt / .txt .md | textutil / directly |
| A website | **Crawl website**: `/sitemap.xml` for every page (including unlinked ones) and, on Squarespace, every page's pictures; page text via `?format=json` |

Website pages become **page** cards. An accepted page's PICTURES arrive
accepted (vetted when they were published; Robert, 2026-10-04); its text
arrives pending. Accepted folder/page cards have **Unlink** (= reject: takes
back its pending cards, and a page's pictures still marked `auto`, i.e.
accepted by that rule and not decided since) and **Read again** (re-adds anything missing, e.g.
after a Clear; finishes a stopped one).

Pages are matched by address/title, or because their pictures match ones
already on the site. Pictures stay on the website until Write downloads them, read their
real format from the bytes, and convert anything that isn't JPEG/PNG/WebP.

**The old site is `rmaciel.work` on Squarespace and goes away at DNS cutover** —
see PUNCH-LIST §4.

## Limits worth knowing before promising anything

- Matching is by name, so short or common titles (NOISE, LIGHT WORK) produce noise;
  the queue exists for that reason.
- InDesign text needs the checkbox and launches InDesign (~3 min cold).
- Illustrator text only if saved PDF-compatible; scanned PDFs have no text.
- Look-alike inference finds the same photo re-exported, not a crop or another shot.

## Columns (built 2026-10-05)

**Folders** and **Projects** in the header show/hide those columns
independently (Folders is hidden on Organize, which has none). Every column
line is a drag seam (`.seam`, a zero-width grid track): side columns
(Folders, Projects, Text) are sized in px, the three review columns as
proportions, so with both side columns shut they fill the window. Both are
remembered in the page's localStorage (`pane-*`, `widths`).

## Right-click menu (built 2026-10-05)

`openMenu()` in page.js, on a project, a tree folder/file, a card, or a work
(list or grid); text fields keep the Mac's own menu. Mostly the buttons
already on the thing. New: **Rename…** (in place, title only — the slug is
permanent; projects only, never files on disk, because Harvest remembers
files by path), **Move to section**, **Hold back** (all three via
`/api/project`, so build.js checks first), **View on live site** (`LIVE` in
harvest.js — change it at DNS cutover), **Move to top/bottom** (the `move`
op clamps), and Add/Link/Crawl for ANY project. **Show in Finder / Open** go
through `POST /api/open` (macOS `open`; files only if pictures or readable
documents, never an .app). A PDF text card's **Open at page N** opens
`/pdf?p=…#page=N` in the default browser (Chrome), because Preview cannot be
sent to a page; `/pdf` serves only PDFs a card names. Test with a stub
`open` first on PATH, so nothing opens on Robert's screen.

## The Organize page (built 2026-10-04)

A second page after Collect, one project at a time, working on WORKS not files:
copies of one drawing (crops, edits, resolutions, IMG_1234 names) are grouped
into one stack — Apple Vision feature prints, which survive crops where the
crawler's dHash does not. Per stack Robert's decisions so far:
- ONE kept image per work. No record of the alternates is kept.
- A copy that came from his old website wins as the web copy: it was already
  vetted. Otherwise largest file with a real name, overridable.
- Details (title, year, medium, size, caption, alt) suggested from Squarespace
  image titles/captions, PDF pages naming the file or title, and EXIF.
- Stacks are ordered by drag; Write/Publish as today.

Built as described. Same-work test: dHash within tolerance OR Vision feature
print distance <= 0.30 stacks automatically; 0.30-0.60 is offered as "Same work
as #N?". Measured on BUS STOP: crops 0.21-0.26 (70 %), corner crop 0.50,
different renders of one project 0.40-0.57 — hence the maybe band. Save rewrites
the project's `images` to the kept copies in order and DELETES the files of
site pictures it drops (build.js ships all of images/), after a second click.
Collect's Write now writes text only; pictures go through Organize.

Added 2026-10-04: **Grid** view (S/M/L cells) showing each work's kept copy;
click tiles to tick, double-click opens it in List, drag a tile onto another's left or right half to reorder (the `move` op). Ticked works can be
merged ("Same work — merge": the alts the grouping missed) or separated
("Separate copies", op `unstack`: every copy but the kept one becomes its own
work, all marked apart; each copy in List also has its own **Separate**) or moved to another
project with all copies, grouping, alt and caption — the header's **Move to project** button
(the right-click menu's project list, for every ticked work), or by dragging a tile onto a
project's name in the Projects column (a ticked tile carries every ticked work with it).
Removed works (waiting for Save) are hidden in List and Grid; the header's **Show N removed**
brings them back to Restore (remembered as `orgShowRemoved`). A moved copy that was on
this project's site is copied to `.../Harvest/moved/` first and the work stays
here marked removed, so this project's Save takes it off. A moved work lands
first in a project never opened in Organize; reorder with the arrows.
Collect: an accepted folder card counts the cards it brought in and has
**Show what is inside**, which filters Pending to that folder's path.
The folder tree also lists pictures and readable documents, each with **Add**
(`/api/addfile`): a picture goes into the selected project accepted; a
document is read as a job and its passages arrive pending (`from: 'manual'`).

## The Project panel (built 2026-10-04)

Organize → **Project details**: every field Keystatic edits except `images`
(title, section, order, draft, part_of, client, details, layout, expand,
icon_type/glyph/image, wordmark, share_description, nicknames, and the
description body as Markdoc with toolbar buttons + a live preview rendered by
the repo's @markdoc/markdoc with tags mirroring build.js). Save
(`POST /api/project`) catches up with GitHub, then runs the real `build.js`
on a throwaway copy of the site holding only this project and the projects
tied to it by part_of (`checkAlone`), before and after; a save that adds a
failure writes nothing. (Not the whole site: build.js stops at its first
failure, so any broken project masked everything.) The page sends only the
fields it changed, so newer edits from GitHub survive. Icon/wordmark uploads wait in
`.../Harvest/uploads/` and are copied to `images/<slug>/<field>.<ext>` only on
Save; a replaced or removed one's old file is deleted. The file chooser and
confirm() need HarvestApp.swift's delegates — the app was rebuilt for them.

Organize → **Text**: the project's accepted passages in a column beside the
works. Click (or right-click) one for where it goes: a Project details field
(description — Markdoc-escaped as Write does —, detail lines, share
description, title, client, working titles; one-line fields are replaced, the
rest appended), filled in the panel for ITS Save to check and write; or a
work's caption / alt text, then click the work. Target becomes `caption` (a
work) or `organize` (a field), both of which Collect's Write skips; `used`
records where, and the passage stays, dimmed. A work's right-click ›
**Extract text** (`/api/extract`) reads its kept copy with the Vision helper's
`--image` mode (a website picture at 2500w, into `downloads/` as Write does)
and adds an accepted passage with target `organize`. Vision reads sideways
text as it is, so a work's turn is not passed.

The page no longer polls. It holds `/api/events` open (server-sent events);
the server compares the state snapshot twice a second and writes only when it
changed. `poll()` in page.js is now a one-shot refresh after the page's own
actions.

## Finder's right-click menu (built 2026-10-04)

**Not offered inside iCloud Drive** — Robert's Desktop and Documents are
iCloud (file-provider) folders, where macOS shows no Finder Sync menus. There,
use **right-click › Services › Add to Harvest Project…**: an NSServices entry
(build-app.sh) answered by `addToProject` in HarvestApp.swift, which asks for
the project (remembering the last), then takes the same harvest:// path.
After installing a rebuild: `/System/Library/CoreServices/pbs -update`.

**Harvest › Add to Project › [projects by section]**, **Crawl for Project ›**
(one folder selected) and **Open Harvest**. A Finder Sync extension,
`tools/HarvestFinder.swift`, built by `build-app.sh` into
`Harvest.app/Contents/PlugIns/HarvestFinder.appex` (sandboxed; its one
exception is reading `~/Library/Application Support/Harvest/`). It reads the
project list the server writes to `finder.json` and hands the choice to the
app as `harvest://add|crawl?project=<slug>&path=…`; `HarvestApp.swift`
queues it until the server is up, then calls `/api/addfile` (files),
`/api/link` (folders; over 300 files asks Crawl / Add All / Cancel) or
`/api/crawl`, selects the project and says what happened. The user switches
the extension on once (System Settings › General › Login Items & Extensions ›
Extensions › Added Extensions, or `pluginkit -e use -i
work.rmaciel.harvest.finder`). Test the app half with a scratch HOME and the
URL as a launch argument — never by `open harvest://…`, which reaches
Robert's running Harvest. After a rebuild, `lsregister -u` any other
Harvest.app copies so only /Applications answers `harvest://`.
