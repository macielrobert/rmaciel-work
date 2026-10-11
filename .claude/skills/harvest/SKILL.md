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

## The shell (UX-2, built 2026-10-10)

Two modes, **Collect** and **Edit** (Edit was Organize), switched in the
application header. The **Projects** list stays at the left in both, and the
**project header** above the work names the selected project in the same place
in both. Each kind of control has one home (`STYLE-GUIDE.md`, Placement):

| Where | What |
|---|---|
| Application header | Collect / Edit, the status line (background work, Stop), how the last publish went, **Publish…** (opens the review) |
| Project header | name, **where its edits are** (UX-3, below), Discard unsaved fields, the message line, Preview and **Save project** (Edit only) |
| Workspace toolbar | Collect: Pending / Kept / Rejected, find, source filters, order, **Clear and forget** menu. Images: count, find, Grid / List, S M L, Show removed |
| Selection toolbar | always there; its actions wait, readable, until something is selected |
| Details panel | Images in Grid: the work clicked last, with List's fields for it |

Words on screen changed; **the server's names did not**: Kept is
`status: 'accepted'`, Reset decision sets `'pending'`, Save project is the old
Write to project (the same three writes). Old remembered layout keys
(`pane-*`, `projOpen`, `textsOpen`, `orgView`) are no longer read; Images
remembers `imgView` (Grid by default) and Edit its tab as `etab`.

**Remembered across a quit (UX-6, 2026-10-11).** The page keeps its choices
in localStorage, which a browser keeps per ADDRESS — and the server took a
fresh port at every launch, so none of them (column widths, tabs, views)
ever outlived a quit. It now listens on **47321**, and on any free port if
that is taken (a second copy; `HARVEST_PORT=0` for tests). The page also
remembers the mode (`mode`) and the project or ABOUT / CONTACT (`pick`) and
reopens on them. The Host check on every request keeps a fixed port safe.

**The project header wraps (UX-6).** Name, saved state, Discard and the
message line sit in `#pmain` and wrap there; Preview and Save stay at the
right of the first line, never moved by a message arriving or clearing. It
was one unbreakable row: at 1024 wide with the Preview open it ran under
the Preview pane — a click on Save project landed on Live — and the message
line was 0px wide.

## What Robert does

1. Double-clicks `tools/Harvest.command`. It runs `git pull --ff-only` and opens
   the page in his browser.
2. Picks a project at the left, then a folder in **Collect › Sources** and
   clicks **Crawl this folder for <project>**.
3. In the review list (Pending by default): **Keep** or **Reject** cards.
   Text is editable; text cards choose a target (description / detail lines /
   share). Kept material is what Edit works with.
4. In **Edit**, clicks **Save project → Publish** (Save is in the project
   header and only in Edit — Collect finds and sorts, it does not write;
   Publish is top right). Save is ONE button for three writes, in this order:
   the project's fields if they hold edits (build-checked), the works (second
   click if pictures come off the site; every kept work needs alt text or it
   stops there — and then that work is selected in Images with its alt text
   field marked), then kept text not placed elsewhere (`/api/write`). Before
   any of them (UX-3) `/api/organize/check` asks what would stop the works —
   EVERY work without alt text (the line links to each, nothing is written), a
   turned GIF, pictures coming off the site (the second click) — so none of it
   arrives after the fields were written. Each step is all-or-nothing; a
   failure stops the rest and the line says what was saved first.
   **Publish…** opens a review: what goes, with what changed in each against
   GitHub's copy, and what stays behind because it is not saved. Publish then
   commits ONLY content/ and images/ on main as "Harvest: <slugs>", rebases
   onto GitHub's main, runs build.js on exactly that commit (a worktree in the
   system temp folder), pushes it as `harvest/<time>`, opens a pull request
   with `gh` and merges it (`main` refuses a direct push), and fetches the
   live page — and every picture it adds or replaces — until they match what
   it built, for ten minutes. It refuses
   on a branch other than main, or with a commit ahead of GitHub that is not
   "Harvest:" — those would ride along. Before the merge a failure undoes the
   commit; a refused merge leaves the pull request open and says so.
5. Bulk: tick cards → Keep / Reject / Reset decision / Move to… (moved cards
   arrive kept; the original is kept rejected+hidden so a re-crawl can't refile
   it). **Clear and forget** (toolbar, right) holds the housekeeping, each item
   saying what it keeps: Clear N from the queue (forgets what Pending shows),
   Hide rejected (stays rejected), Forget all rejections, Forget selected.
   More than one card asks first with confirm().
6. Add section (Projects column, 2026-10-10): writes `content/sections/<slug>.json`
   (`{ title, order }`, after the last), as Keystatic's Sections collection
   does. The section lists, the menus and the Projects headings all come from
   that folder (`sections()` in harvest.js, read fresh), and an empty one is
   listed as such. It counts toward Publish as "<slug> (section)". build.js
   leaves an empty section off the site, so adding one is always safe.
7. New project (foot of the Projects list): writes a draft .mdoc; needs a grid
   icon before it can go live — Edit › Layout uploads one (a typed character
   shows "Or an image" under it; choosing a file switches to it).

8. ABOUT and CONTACT (SITE, foot of the Projects list, UX-2b): each opens
   Edit as one form — ABOUT is Content's title, detail lines and description,
   CONTACT its email and intro — and the header's **Save ABOUT** / **Save
   CONTACT** writes `content/about.mdoc` / `content/contact.json` through
   `/api/site`, after build.js passes on a copy holding that file among
   minimal stand-ins for everything else (`STAND_IN`, `throwaway()`): build.js
   stops at its first failure, so the real ones could hide a new error. They count toward Publish as `about` and
   `contact`. CONTACT's intro is carried by build.js but not shown on the site.

## What "publish the harvest" means for Claude

Harvest's own **Publish…** does this as a pull request (UX-3). When Robert
asks Claude instead — a clash, a refused merge, or no Harvest at hand:

1. `git status` — expect changes under `content/projects/*.mdoc` (and maybe
   `content/about.mdoc` or `content/contact.json`) and new files
   under `images/<slug>/images/<n>/`.
2. `git diff content/` and read it. Harvest APPENDS (images, paragraphs, detail
   lines) and may set `share_description` and `nicknames`. Anything else
   changed is not Harvest's doing — stop and ask.
3. `node build.js` must pass. If it fails, the error names the file and field.
4. Commit on a branch and merge it through a pull request — `main` refuses a
   direct push (standing rule: Robert approves shipping without being asked).
   A Harvest pull request left open by a refused merge is merged the same way.
   Then confirm the live site at `https://rmaciel-work.netlify.app/` matches a
   fresh `dist/index.html`.

## Where a change is (UX-3, 2026-10-11)

The project header says it for the project or page chosen, in both modes, and
the Projects column says it in short under each name:

| On screen | Means | Where it is kept |
|---|---|---|
| **Not saved:** edited fields, N new works, N works taken off, changes to the works, N kept pictures, N kept passages | what Save project would still write | `state.json` — `drafts` (typed fields, sent after a pause), `organize`, accepted findings |
| **Saved on this Mac, not published** | in the project file, not on GitHub | the working copy, or a Harvest commit a refused merge left |
| **Publishing… / Sent to GitHub, not merged / Merged; Netlify is building it / Merged, not confirmed live** | the last publish, per item | `state.publish` |
| **Published** | none of the above | — |
| **Held back** | apart from all of them: whether the site shows it | the file's `draft` |

`S.unsaved` (server, `unsavedAll()`), `S.unpublished` (git, refreshed at start
and after a publish) and `S.publish` feed it. "draft" on screen meant held back
until UX-3; it is "held back" everywhere now, because a draft is also what
unsaved fields are kept as.

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

- Run with a scratch home: `HOME="$TMPDIR/hv" HARVEST_NO_OPEN=1 HARVEST_PORT=0 node tools/harvest.js`
  The state folder then lives under that fake home. `HARVEST_PORT=0`: any
  free port, leaving Harvest's own, 47321, to Robert's copy.
- For Save AND Publish end to end, `tools/test-rig.sh <empty folder>` builds
  a clone of the site with local stand-ins for GitHub, gh and Netlify.
- `/api/*` POSTs need `Origin: http://127.0.0.1:<port>` or they get 403.
- Keeping a working title, and **Save project**, write into
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
| PDF pages with under 20 letters of text (Rhino tiled-PNG exports, InDesign layouts of them, a placed picture plus a page number) | OCR: Apple Vision, a Swift helper compiled once into `.../Harvest/ocr` (~1 min the first time) |
| .indd | InDesign itself, only when the checkbox is ticked |
| .3dm | the Notes panel, read from the file's properties table (first 8 MB only) |
| .docx .doc .rtf .odt / .txt .md | textutil / directly |
| A website | **Crawl website**: `/sitemap.xml` for every page (including unlinked ones) and, on Squarespace, every page's pictures; page text via `?format=json` |

A crawl never takes pictures OUT of a PDF; a page matches by its words. A PDF
text card has **Add page N as a picture** (button and right-click): the helper's
`--page` mode draws the whole page (crop box) as a 2400 px JPEG into
`.../Harvest/pages/`, filed as a kept picture for Edit › Images. Whole page,
not the photo placed on it (2026-10-07). Text caches are keyed with `READ_V`;
bump it when a reader starts finding more, so cached files are read again.

Website pages become **page** cards. An accepted page's PICTURES arrive
accepted (vetted when they were published; Robert, 2026-10-04); its text
arrives pending. Accepted folder/page cards have **Unlink** (= reject: takes
back its pending cards, and a page's pictures still marked `auto`, i.e.
accepted by that rule and not decided since) and **Read again** (re-adds anything missing, e.g.
after a Clear; finishes a stopped one).

Pages are matched by address/title, or because their pictures match ones
already on the site. Pictures stay on the website until Write downloads them, read their
real format from the bytes, and convert anything that isn't JPEG/PNG/WebP/GIF.

**GIFs stay GIFs (2026-10-06).** NOISE is animated GIFs; converted they kept
one frame. build.js measures GIF; Harvest copies them untouched (never via
sips, which flattens), refuses one over 20 MB at Write (`MAX_GIF`; NOISE's
IMG_8617 is 66 MB), and refuses a turned GIF. Netlify's image CDN picks WebP
for most browsers and documents animated WebP output — confirm on the live
site the first time a GIF is published; if it comes back still, skip the
transform for `.gif` in `IMAGE_TRANSFORM` (index.html).
A refused GIF gets a smaller copy from `tools/gif-shrink.swift` (header says how
to run it): every frame and its timing kept, 720 wide, 32 colours by default —
IMG_8617 went 66.5 MB → 8.4 MB. Write the copy beside the original, add it to
the project, and check Edit › Images kept the new one (2026-10-09).
The Mac's not-added alert groups failures by reason with three names each:
an NSAlert does not scroll, and forty lines pushed OK off the screen.

**The old site is `rmaciel.work` on Squarespace and goes away at DNS cutover** —
see PUNCH-LIST §4.

## Limits worth knowing before promising anything

- Matching is by name, so short or common titles (NOISE, LIGHT WORK) produce noise;
  the queue exists for that reason.
- InDesign text needs the checkbox and launches InDesign (~3 min cold).
- Illustrator text only if saved PDF-compatible; scanned PDFs have no text.
- Look-alike inference finds the same photo re-exported, not a crop or another shot.

## Columns (built 2026-10-05)

Every column line is a drag seam (`.seam`, a zero-width grid track). Side
columns (Projects, Sources, Kept text, the details panel, Preview) are sized
in px and remembered in localStorage (`widths`); each gives way before the
work beside it does in a narrow window (a `min(…, %)` or `minmax(0, …)`
track). The header's Folders / Projects show-hide buttons and the three
review columns' proportions went with UX-2.

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

## Edit › Images — was the Organize page (built 2026-10-04)

The second mode after Collect, one project at a time, working on WORKS not files:
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
as #N?" (merging, the work takes the EARLIER of the two places — UX-6; it
used to take the newcomer's, so a crop sent #1 to the end). Measured on BUS STOP: crops 0.21-0.26 (70 %), corner crop 0.50,
different renders of one project 0.40-0.57 — hence the maybe band. Save rewrites
the project's `images` to the kept copies in order and DELETES the files of
site pictures it drops (build.js ships all of images/), after a second click.
Since 2026-10-06 the works save, the text write and the project fields' save
are one button — Save project since UX-2, in the project header.

**Grid** view (S/M/L cells) showing each work's kept copy. Since UX-2 a
click selects that work alone and shows it in the **details panel** at the
right (the List row's fields, one column high); ⌘-click adds or takes away
one, Shift-click selects a run, the corner box toggles. Keyboard: Return
selects, Space toggles, arrows move between tiles. Double-click opens it in
List; drag a tile onto another's left or right half to reorder (the `move`
op), or use Earlier / Later in the panel. Selected works can be
merged ("Same work — merge": the alts the grouping missed) or separated
("Separate copies", op `unstack`: every copy but the kept one becomes its own
work, all marked apart; each copy in List also has its own **Separate**) or moved to another
project with all copies, grouping, alt and caption — the selection toolbar's **Move to…**
(the right-click menu's project list, for every selected work), or by dragging a tile onto a
project's name in the Projects list (a selected tile carries every selected work with it).
Removed works (waiting for Save) are hidden in List and Grid; the toolbar's **Show N removed**
brings them back to Restore (remembered as `orgShowRemoved`). A moved copy that was on
this project's site is copied to `.../Harvest/moved/` first and the work stays
here marked removed, so this project's Save takes it off. A moved work lands
first in a project never opened in Edit; reorder with the arrows.
Collect: a kept folder card counts the cards it brought in and has
**Show what is inside**, which filters Pending to that folder's path.
The folder tree also lists pictures and readable documents, each with **Add**
(`/api/addfile`): a picture goes into the selected project kept; a
document is read as a job and its passages arrive pending (`from: 'manual'`).

## The project's fields — was the Project panel (built 2026-10-04)

Edit › **Content** (title, detail lines, description), **Layout** (layout,
expand, crop, grid icon, wordmark) and **Settings** (section, order, hold back,
part_of, client, working titles, share description): every field Keystatic edits except `images`
(title, section, order, draft, part_of, client, details, layout, expand, crop,
icon_type/glyph/image, wordmark, share_description, nicknames, and the
description body — edited formatted since UX-5, below). Save
(`POST /api/project`) catches up with GitHub, then runs the real `build.js`
on a throwaway copy of the site holding only this project and the projects
tied to it by part_of (`checkAlone`), before and after; a save that adds a
failure writes nothing. (Not the whole site: build.js stops at its first
failure, so any broken project masked everything.) The page sends only the
fields it changed, so newer edits from GitHub survive. Icon/wordmark uploads wait in
`.../Harvest/uploads/` and are copied to `images/<slug>/<field>.<ext>` only on
Save; a replaced or removed one's old file is deleted. The file chooser and
confirm() need HarvestApp.swift's delegates — the app was rebuilt for them.
Unsaved fields (UX-3, 2026-10-11) are KEPT, not asked about: the form is
sent to `/api/draft` after a 400 ms pause (and on `pagehide`) as `{ base, now }`,
and a project or page opened again puts back only the fields the draft
changed, so a field edited on the phone since keeps its newer value. Switching
project, mode, or quitting loses nothing, and nothing asks. The form is let go
only once Harvest holds the draft (`draftStored`): if it cannot be stored, the
switch does not happen and the status line says why. Save project's own
saves send `draft: true`, which drops it once written; **Discard unsaved
fields** drops it after a confirm(). A right-click Rename or Hold back saves one
field and leaves the draft be. An upload a draft names is not swept. Until
UX-3 switching asked "Discard them?" every time.

Edit › Content › **Kept text**: the project's kept passages in a column beside
the fields. Click (or right-click) one for where it goes: a project field
(description — Markdoc-escaped as Write does —, detail lines, share
description, title, client, working titles; one-line fields are replaced, the
rest appended), filled in for Save project to check and write; or a
work's caption / alt text — Images opens, then click the work. Target becomes `caption` (a
work) or `organize` (a field), both of which the text write skips; `used`
records where, and the passage stays, dimmed. A work's **Extract text**
(details panel, List row, right-click) (`/api/extract`) reads its kept copy with the Vision helper's
`--image` mode (a website picture at 2500w, into `downloads/` as Write does)
and adds an accepted passage with target `organize`. Vision reads sideways
text as it is, so a work's turn is not passed.

The page no longer polls. It holds `/api/events` open (server-sent events);
the server compares the state snapshot twice a second and writes only when it
changed. `poll()` in page.js is now a one-shot refresh after the page's own
actions.

## The description editor (UX-5, 2026-10-11)

Edit › Content's description is **ProseMirror** (the engine Keystatic is built
on, installed with it), in the site's own type: 12px / 1.7 / .02em at the
31em measure, the site's rules for marks, lists, quotes, dividers and links
(`#pdesc` in page.css; `check-tokens.js` compares the body type and mark
sizes). `tools/harvest/markdoc-pm.mjs` converts Markdoc ↔ document and writes
with Markdoc's own `format()`, as Keystatic does, plus escaping and moving
edge whitespace out of bold/italic/strike. `editor.mjs` is the view and the
toolbar. **`#pbody` (the textarea) stays the value**: every edit writes the
Markdoc into it and fires `input`; `setBody()` in page.js is how a new value
reaches both. An untouched description is never rewritten. **Markdoc text**
(toolbar, right) shows the textarea; a description the editor cannot hold
(inline code, a block-level tag, nested same marks…) opens there with a note.
Shift-Return is a line break, Return in an empty list item leaves the list,
Link opens a field under the toolbar (the app has no prompt()). The packages
are served from node_modules at `/vendor/<name>` (`VENDOR` in harvest.js, the
import map in page.html — no bundler). `node tools/check-description.mjs`
round-trips every description in content/ and fixtures through build.js's own
renderer, and 9,319 editor-made mark edges (punctuation, letters, other
marks, line breaks either side); check-harvest runs it. Where a `*` or `~~`
would sit between a letter and punctuation, the letter is written as a
character reference (`&#101;`), and italic touching bold is written `_`
(review of PR #52). Every edit is read back: a formatting button that would
not save as shown is refused, typing that would gets a warning note.

## The Preview pane (built 2026-10-10, three versions since UX-5)

Edit › **Preview** (project header): the site itself in a pane at the right
of the window, Edit only, drag-resizable up to 75 % of it (`data-right`
seam), or **Large** over the work area (the Projects list stays). Versions:
**Editing preview** (`?edit=<slug>` or `site:about`) = the saved files with
that project's draft fields (`projectEdit()`/`siteDocEdit()`, what Save would
write) and its works as Images has them (`previewWorks()`: order, removals,
alt, caption, turns; a held-back project is shown and the pane says so);
**Saved preview** = the files as saved (byte-identical to `node build.js`);
**Live** = `LIVE`. Both local versions are `previewBuild()`: build.js on a
`throwaway()` copy, page kept in memory, fonts and pictures served from the
repo — **dist/ is never touched** (it used to be rebuilt in place). A
picture not saved yet is a stand-in under `images/<slug>/harvest-preview/`
(`standIn()`: the file itself if JPEG/PNG/WebP/GIF and unturned — a
website's as Save downloads it, `webCopy()` —, else a
1500px sips JPEG in `.../Harvest/preview/`, swept after a day). Project
files are COPIED into the throwaway: build.js skips symlinks in
content/projects. A build is ~0.1 s; the Editing preview is rebuilt 700 ms
after Harvest stores a draft (`previewSoon`), never per keystroke; picking a
work changes only the hash (`#section/slug/n`), and the site follows.
**Desktop** 1280×800 / **Phone** 390×844 are drawn at that size and scaled to
fit (`fitPreview`); the message line says the scale. Own port because from
Harvest's origin the site's script would pass the Origin check on `/api/`
POSTs. The boundary is HarvestApp.swift: a clicked link inside a frame may
only stay on the frame's host; anything else (and any `target=_blank`) opens
in the default browser. In a plain browser (Harvest.command) there is no
boundary. Testing in the in-app browser: changing the tab's viewport size
made the cross-origin frame screenshot black; a fresh tab rendered it.

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
