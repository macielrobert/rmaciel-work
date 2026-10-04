---
name: harvest
description: How Robert's Harvest app works and how to publish what it writes. Use when Robert mentions Harvest, crawling his folders, the review queue, working titles / nicknames, "publish the harvest", or asks to change, debug or test tools/harvest.js.
---

# Harvest

A local crawler with a review queue that fills Keystatic projects from Robert's
own files. It is entirely `tools/harvest.js` (Node built-ins plus macOS tools);
the launcher is `tools/Harvest.command`. Nothing in it ships to the site.

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
- Accepting a working title and **Write** both write into `content/projects/`.
  Afterwards: `git checkout content/` and delete any new `images/<slug>/images/<n>/`.
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

Website pages become **page** cards (matched by address/title, or because their
pictures match ones already on the site). Accepting one pulls in its text and
pictures. Pictures stay on the website until Write downloads them, read their
real format from the bytes, and convert anything that isn't JPEG/PNG/WebP.

**The old site is `rmaciel.work` on Squarespace and goes away at DNS cutover** —
see PUNCH-LIST §4.

## Limits worth knowing before promising anything

- Matching is by name, so short or common titles (NOISE, LIGHT WORK) produce noise;
  the queue exists for that reason.
- InDesign text needs the checkbox and launches InDesign (~3 min cold).
- Illustrator text only if saved PDF-compatible; scanned PDFs have no text.
- Look-alike inference finds the same photo re-exported, not a crop or another shot.

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
click tiles to tick, double-click opens it in List. Ticked works can be
merged ("Same work — merge": the alts the grouping missed) or moved to another
project with all copies, grouping, alt and caption. A moved copy that was on
this project's site is copied to `.../Harvest/moved/` first and the work stays
here marked removed, so this project's Save takes it off. A moved work lands
first in a project never opened in Organize; reorder with the arrows.
Collect: an accepted folder card counts the cards it brought in and has
**Show what is inside**, which filters Pending to that folder's path.
