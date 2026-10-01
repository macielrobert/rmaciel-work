---
name: harvest
description: How Robert's Harvest app works and how to publish what it writes. Use when Robert mentions Harvest, crawling his folders, the review queue, working titles / nicknames, "publish the harvest", or asks to change, debug or test tools/harvest.js.
---

# Harvest

A local crawler with a review queue that fills Keystatic projects from Robert's
own files. It is entirely `tools/harvest.js` (Node built-ins plus macOS tools);
the launcher is `tools/Harvest.command`. Nothing in it ships to the site.

## What Robert does

1. Double-clicks `tools/Harvest.command`. It runs `git pull --ff-only` and opens
   the page in his browser.
2. Picks a folder in the tree and clicks **Crawl this folder**.
3. For each project: accepts or rejects cards. Text is editable; images need alt
   text; text cards choose a target (description / detail lines / share).
4. Clicks **Write to project**, then tells Claude "publish" / "publish the harvest".

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

## Limits worth knowing before promising anything

- Matching is by name, so short or common titles (NOISE, LIGHT WORK) produce noise;
  the queue exists for that reason.
- InDesign text needs the checkbox and launches InDesign (~3 min cold).
- Illustrator text only if saved PDF-compatible; scanned PDFs have no text.
- Look-alike inference finds the same photo re-exported, not a crop or another shot.
