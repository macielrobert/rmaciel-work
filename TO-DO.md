# SVG Noise Lab — Master Plan

Code debt and the domain/email migration interleaved in the order they
actually need doing. Current build: **v80**.

> **Where work happens now.** Phases 1–3 are finished: the repository, the
> Netlify build, the CMS, and the Claude Code loop all exist and work. The
> current job is populating real work and fixing user-facing problems as they
> surface — open-ended, no checklist.
>
> Everything that must be true **before the domain moves** has been pulled
> out into **`PUNCH-LIST.md`**, which is the gate. The launch phases below are
> kept for their reasoning; the punch list is what to actually work from, so
> nothing is tracked in two places.

Companion files: `AGENTS.md` (context for every agent — Codex reads it,
Claude Code imports it through `CLAUDE.md`),
`README.md` (plain-language operating instructions), `PUNCH-LIST.md` (the
pre-launch gate), `STRESS-TESTS.md` (the test list, run at Phase 4).

---

## STANDING RULES — the four ways to lose your email

These never change and apply at every phase below.

1. **Never change nameservers.** DNS stays at Squarespace; you edit individual
   records. "Use Netlify DNS" means recreating every MX and TXT by hand.
2. **Never put a CNAME on the apex domain.** A name with a CNAME can hold no
   other records — including MX. This is the single edit that kills mail.
3. **Never cancel the domain subscription.** It carries the MX records.
4. **Never touch Google Workspace.** In Squarespace's UI "cancel" means two
   different things and one of them suspends your inbox. Leave it alone.

---

## DONE

- [x] **Desktop text measure** — 66ch reading cap, 96ch form cap, `l-form`
      layout, landscape fill fix *(v70–v75)*
- [x] **Grid keyboard + screen reader** — listbox, roving tabindex, focus
      ≠ selection *(v72)*
- [x] **Footer copyright** — rotated into the right margin *(v73)*
- [x] **No-WebGL fallback** — shader is now an enhancement; the key layer
      becomes the visible menu; seam still follows the menu *(v76–v78)*
- [x] **Deep links + back button** — hash routing, title slugs, push/replace
      laddering, safe in sandboxed frames *(v79–v80)*

---

## PHASE 0 — Insurance

Do before anything else. No risk, ~20 minutes, removes the worst case.

- [ ] Google Takeout export of the Workspace mailbox
- [ ] Screenshot **every** DNS record in Squarespace — especially MX and all
      TXT (SPF, DKIM, DMARC). This is the restore point.
- [ ] Note which Squarespace subscriptions exist and their renewal dates
      (website / domain / Google Workspace are billed separately)

---

## PHASE 1 — Repository ✅ DONE

Everything else hangs off this. Deploying from a repo rather than dragging a
file in is what makes iterative updates possible at all.

- [x] GitHub account if you don't have one; create a repo (private is fine —
      Netlify can still deploy from it)
- [x] Rename the build to **`index.html`** — static hosts look for that name.
      Version numbers in the filename were a workaround for passing files
      through chat; Git handles history now.
- [x] Add the four companion docs to the repo root:
      `CLAUDE.md`, `TO-DO.md` (this file), `STRESS-TESTS.md`, and the
      system handoff
- [x] Commit and push

---

## PHASE 2 — Deploy from the repo ✅ DONE

No DNS changes. Live site and email untouched throughout.

- [x] Free Netlify account → **Add new site → Import from Git** → pick the repo
- [x] ~~No build command; publish directory is the repo root~~ — superseded by the CMS: `netlify.toml` now sets `node build.js` and `dist`
- [x] Confirm the `*.netlify.app` URL loads and the shader runs
- [x] Confirm **deploy previews** are on (usually the default) — this is what
      gives every pull request its own preview URL

---

## PHASE 3 — Claude tooling ✅ DONE

- [x] Connect GitHub to your Claude account (done — the
      `claude.ai/connect/github/callback` redirect *is* the confirmation)
- [x] Go to **claude.ai/code**, confirm `rmaciel-work` appears
- [x] Run one small task end to end: task -> sandbox -> pull request ->
      Netlify preview URL -> merge

Works the same from the browser and the Claude iOS app; sessions persist and
can be monitored from the phone. One door, both devices.

**Not needed:** the GitHub Actions route (`@claude` in issue comments). That
requires a workflow file and a separate API key with separate billing. The
account connection above supersedes it.

**Optional, later:** Claude Code locally on the MacBook, for long sessions.

**Optional:** branch protection on `main`. Claude Code on the web opens pull
requests anyway, so this is a safety net rather than a requirement.

Known gap: routes share the **code and `AGENTS.md`, not conversation memory**.
Decisions that matter get written into `AGENTS.md` or the commit message, or
they don't survive. Truer still with two agents — see the last handoff below.

---

## PHASE 4 — Run the stress tests

Half the closed debt is only verifiable here. See `STRESS-TESTS.md`.

- [ ] Deep links, back button, forward, reload on a deep link
- [ ] `?nogl` fallback at four viewport sizes
- [ ] Real WebGL failure (Firefox `webgl.disabled=true`)
- [ ] Console clean on normal load — no silent degrade
- [ ] Keyboard nav, VoiceOver
- [ ] Fix whatever this surfaces before continuing

---

## PHASE 5 — Debt that needs a real host

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

- [ ] **Share + search metadata** — description, Open Graph tags, favicon,
      `<h1>`, real `<title>`. Currently a link preview is a blank rectangle.
- [ ] **404 page** — `404.html`, or the host serves its own, which won't be
      this site
- [ ] **Form endpoint** — replace the mailto with Netlify's native form
      handling. Consider a dirty-state confirm on `×`.
- [x] **`IMAGE_TRANSFORM`** — set to Netlify's Image CDN
      (`/.netlify/images?url=…&w=…`, no `fm`, so the browser's Accept header
      picks AVIF or WebP). Off on `file:` and localhost, where no CDN exists.
      The thumbnail width is MEASURED off the rendered box and rounded up to a
      rung of `WIDTH_STEPS`, so a stylesheet edit to `--car-h` or `--g-cell`
      carries the request width with it and there is no second number to keep
      in step. `MARK_W` / `HERO_W` / `EXPAND_W` stay constants because each is
      a ceiling its element cannot grow past.
      The expanded view was routed through it too at `EXPAND_W` 2048 — it used
      to ask for the camera original, which was harmless while the originals
      were placeholders and a 6.6 MB download once they were photographs.
      **Verify on the deploy preview**, not locally: the URL shape could not
      be tested from the sandbox, and the failure mode is a 404 per image.
- [ ] **Downsize the camera originals in `images/`** — the three Asia Society
      photographs are 4928x3264 / 6.6 MB each, straight off the card, and
      nothing on the site ever shows more than ~2500 px of one. The CDN means
      a visitor no longer downloads them, so this is repo weight and build
      time, not page speed. 2048 px on the long edge at q82 is the target, and
      the real fix is at the upload end: **export before uploading to
      Keystatic**, because the next upload will be full-size again otherwise.

---

## PHASE 6 — Remaining code debt

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

Host-independent; can run in parallel with Phase 3.

- [ ] **Throttle `resize()`** — currently reallocates the GPU backing store
      and forces two layout reads per resize event. Desktop-only symptom.

---

## PHASE 7 — Real content

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

The site should not go live on your domain showing placeholders.

- [ ] Icons, copy, images, wordmarks into `CONTENT`
- [ ] Client marks must be transparent with real counterforms — alpha is the
      shape. Request the mark, not the lockup.
- [ ] Every image record needs `ratio`
- [ ] **Combinatorial layout test with the real copy** — a one-line summary
      and an over-long title, every layout, both orientations. This is the
      class of bug placeholder copy hides.
- [ ] Delete the ~120 lines of placeholder generators
- [ ] Verify hidden-strip images stay off the wire (devtools, real images)

---

## PHASE 8 — Cutover

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

Five minutes of actual work. Everything above should be finished first.

- [ ] In Netlify: add the custom domain, open **Check DNS configuration**,
      read the current record values off that panel
- [ ] Decide apex vs `www` as primary (apex reads better; the performance
      difference is negligible at 37KB)
- [ ] In Squarespace DNS: change **only** the apex record and the `www` CNAME
      - ALIAS/ANAME if offered → Netlify's apex load balancer
      - otherwise an A record → Netlify's load balancer IP
- [ ] Leave MX and TXT exactly as they are
- [ ] Wait for propagation (up to a day)

---

## PHASE 9 — Verify before celebrating

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

All four must pass.

- [ ] Site loads on apex **and** www
- [ ] HTTPS certificate issued
- [ ] Mail **to** your domain address from an outside account arrives
- [ ] Mail **from** your domain address delivers elsewhere

---

## PHASE 10 — Cleanup

> Tracked in `PUNCH-LIST.md`. Work from there; kept here for the reasoning.

Wait about a week after Phase 9.

- [ ] Cancel the Squarespace **website** subscription only
- [ ] Keep: domain subscription, Google Workspace subscription
- [ ] Confirm DNS management is still reachable afterwards

---

## NEXT — Video and audio players

Requested 2026-10-09. Not started.

Two players, one design: the browser's own `<video>` and `<audio>` elements
with their built-in controls switched off, and the site's own controls drawn
over them. **No YouTube, no Vimeo, no third-party player, no branding
anywhere on screen.**

This clears the single-file rule because `<video>` and `<audio>` are part of
HTML: the player is code in `index.html`, not a dependency. The one thing that
would break the rule is adaptive streaming (HLS — the format that switches
quality mid-play to suit the connection), which outside Safari needs a player
library. **Default: plain MP4 (H.264 picture, AAC sound), no library.** It
plays in every browser as-is; what it gives up is the quality switching.

- [ ] **Decide where the video files live — the one real fork.** Pictures
      live in the repo; most video cannot. GitHub refuses any file over
      100 MB, and every committed file stays in the repo's history for good —
      the reason Harvest already refuses GIFs over 20 MB.
      - *In the repo, under a size cap* — simplest; fine for short clips.
      - *A storage bucket outside the repo* (Cloudflare R2, Bunny and the like,
        serving plain MP4 files) — no ceiling and still no branding, but a
        second account, and a second address the page loads from.
      Depends on how long the real videos are. Audio is small enough for the
      repo either way.
      **Answered 2026-10-09: up to 2 minutes each.** Converted for the web
      that is roughly 40–60 MB a video (an estimate, from typical 720p–1080p
      bitrates — real sizes depend on the footage). Under GitHub's ceiling,
      but every one stays in the repo's history for good, and every play is
      bandwidth Netlify counts against the free plan.
      **Decided 2026-10-09: a Cloudflare R2 bucket, for video only.** Plays
      cost nothing: R2 has no egress charge (verified on Cloudflare's R2
      pricing page; free tier 10 GB stored a month). Images stay in
      `images/` — Keystatic uploads there, the build reads their sizes there,
      and Netlify's image CDN resizes them; moving them breaks all three for
      no gain. The site stays on Netlify: Cloudflare serves a bare domain
      only from its own nameservers, which is standing rule #1.
      **Catch, found after the decision — the bucket's public address.**
      - `r2.dev`, the free address every bucket gets, is throttled and
        documented as not for production. Ruled out.
      - A custom address (`media.rmaciel.work`) needs the domain added to
        Cloudflare: full setup moves the nameservers (standing rule #1);
        partial setup keeps them but is Business/Enterprise only (verified
        on Cloudflare's DNS docs). Ruled out.
      - **A second domain, only for media, entirely on Cloudflare.** No email
        on it, so moving its nameservers costs nothing. A yearly domain fee.
        **Recommended.**
      - A Cloudflare Worker (a small script Cloudflare runs) on a free
        `workers.dev` address, reading the bucket. Free, but code to keep,
        and it must answer byte-range requests itself — iPhone Safari will
        not play an MP4 from a server that does not.
      Awaiting Robert's go on the second domain.
- [ ] **Site: the video player.** Own play button, DRAWN in CSS like the caret
      — a typed ▶ is not in the typeface and would fall to a fallback font.
      Play/pause, a scrub bar, mute, fullscreen. **Controls never churn**,
      same as `×` and `←`. `playsinline`, so an iPhone plays it inside the
      window instead of jumping to its own full-screen player. A poster frame
      (a still from the video) shows until play is pressed.
- [ ] **Site: the audio player.** The same controls without the picture:
      play/pause, scrub bar, time.
- [ ] **An exception to the loading order.** The rule is that nothing is held
      back to save bytes — every picture is asked for early. Video cannot
      follow it: one clip can outweigh the whole site. Video fetches its
      poster and its length only (`preload="metadata"`) until play is
      pressed. Record the exception in the "loading order" comment in
      `index.html`, so it does not read as a mistake.
- [ ] **Build: `ratio` for video.** build.js reads each picture's size from
      the file so the layout never jumps; an MP4 records its frame size the
      same way, so the build can read that too.
- [ ] **CMS: a video field and an audio field** in Keystatic. Check whether
      Keystatic's upload to GitHub accepts a file that large before relying on
      it — only matters if the files live in the repo.
- [ ] **Harvest: load and preview video.** Today it skips video entirely; it
      only recognises picture extensions. Needs: recognise `.mov`, `.mp4`,
      `.m4v`; read size and length with `mdls`, since `sips` cannot read
      video (both built into macOS); a still for the review grid via
      `qlmanage` (also built in); play in the review page with a plain
      `<video>`. **Convert on the way in**, as it already downsizes pictures:
      an iPhone records HEVC `.mov`, which not every browser plays.
      `avconvert` (built into macOS — verify on the Mac) can write H.264 MP4.

---

## DEFERRED

Not now; revisit if the conditions appear.

- [ ] **Lazy section build** — only if the project list grows substantially.
      Currently ~4,700 DOM nodes and 33 icon bakes at boot.
- [x] **CMS** — done twice. Decap arrived, hit its formatting ceiling, and was
      replaced by Keystatic. The data contract was CMS-shaped exactly as
      predicted: `buildData()` never changed for either. What Decap's editorial
      workflow gave for free — a pull request per edit — did NOT survive the
      move; see `PUNCH-LIST.md` section 0 and `NOTES-CMS-DECISION.md`.
- [ ] **`<noscript>` block** — with JS off the page is blank. Six lines with
      your name and email would mean it's never truly empty.
- [ ] **Move domain registration off Squarespace** — a transfer, not a
      cancel, and a separate operation entirely. Much later, if ever.

---

## HANDOFF — Netlify build cost

### The loose end

The build rebuilds the editor on every deploy, including content-only edits.
Diagnosed with numbers, **not fixed**. A direction was recommended and Robert
asked what it costs; he has not yet said go.

### Why it surfaced

Netlify hit its free-plan limit. Published sites stay live; **production
deploys are paused until the cycle resets in ~3 weeks** (from 2026-08-05).
Robert does not want to upgrade.

**Update:** still on the free plan, still stalled. Robert may upgrade soon —
until then, no PR against this repo actually deploys once merged, including
#22 and #23 below.

**Update, 2026-10-04: deploys are running again.** `main` deploys to
`rmaciel-work.netlify.app` normally; the pause above is history. The build
cost below is still unfixed, which is why commits touching only `tools/` or
docs end with `[skip ci]`.

### The measurement

Taken in the build sandbox — ratios hold, absolute times will differ on
Netlify.

| | packages | size | time |
|---|---|---|---|
| What the site build needs | **2** (`@markdoc/markdoc` + 1) | 2.8 MB | ~1 s |
| What every deploy installs | **721** | 594 MB | 14–17 s |
| `astro build` (the editor) | | | 6.5–22 s |
| `node build.js` (the whole site) | | | **0.09–0.46 s** |

A one-word content edit costs ~30–40 s of build for ~1.5 s of real work.
**Root cause: all ten dependencies sit in `dependencies` in `package.json`,
so the site build cannot tell the editor's 719 packages from the one it
needs.**

### Recommended direction — awaiting approval

**Split into two Netlify sites.** Portfolio builds
`npm ci --omit=dev && node build.js` (two packages, seconds, no serverless
function). Editor becomes its own site, rebuilt only when its own files
change. Each needs an `ignore` rule scoping it to its own inputs.

Rejected alternative: one site plus a custom Netlify build plugin to cache
the editor's output. More moving parts, and the least verifiable option.

Costs stated to Robert: a second GitHub App callback URL; the editor's
address changes; a second dashboard to check when a build goes red; nine
deps move to `devDependencies`. **No extra money — both sites share one team
credit pool, so the saving is less work, not a second free allowance.** Side
benefits: the portfolio ships no function at all, the four secrets leave the
portfolio site, and it settles the punch-list question about `/keystatic`
being a login page on a portfolio.

### The blocker — read before building anything

1. **`netlify.toml` lives in the repo, so both sites read the same one.** No
   verified way yet to give them different build commands. This is the open
   technical question.
2. **Netlify's docs return 403 from the build sandbox** — the same wall
   recorded in `NOTES-CMS-DECISION.md`. The npm registry *is* reachable;
   `@netlify/cache-utils` 7.1.1 was read that way and its cache API
   confirmed (`save`/`restore`/`has`, default cache dir `.netlify/cache/`).
   Use that route to verify claims.
3. **Nothing can be tested until deploys resume.** Do not merge a build
   change that has not been run.

Agreed sequence: prepare the `package.json` split and both configs on a
branch now, resolve the `netlify.toml` question against a real deploy the
day the cycle resets, merge nothing until it has actually run.

### One measured finding worth keeping

An `ignore` rule skipping docs-only commits was tested against real
history: **only 1 of the last 6 commits would have been skipped**, and
roughly none of Robert's future Keystatic content saves. Small win, does not
address the main cost. Not shipped.

### Also worth carrying

Robert can keep writing in `/keystatic` now — saves commit to GitHub
normally, they just won't appear on the site until deploys resume, then
publish together.

### Not loose ends — already landed

PR #21 (`claude/debug-cleanup-l5z2y9`, two commits, pushed, open): the ABOUT
filename bug fixed on both sides, the authored slug made the URL at his
instruction (zero existing URLs changed), and the stale documentation
corrected. That work is complete and merge-ready; it just won't deploy
until the cycle resets.

---

## HANDOFF — Mobile scroll fix + optional `details`

Two unrelated fixes split onto their own branches so each gets a focused
PR, no template.

* **PR #22** — [mobile scroll fix](https://github.com/macielrobert/rmaciel-work/pull/22)
  (`astro.config.mjs`, `src/keystatic-mobile.css`). Fixes the iPhone
  Projects-list scroll bug (`100vh` → `100dvh` override, scoped to
  Keystatic's own `data-split-pane` attribute). Confirmed present in the
  built SSR output; **not yet tested in an actual mobile browser** — needs
  the deploy preview.
* **PR #23** — [details optional](https://github.com/macielrobert/rmaciel-work/pull/23)
  (`build.js`). `details` is now optional on projects (defaults to `[]`),
  matching Robert's batch-entry workflow. `about.json` still requires it.
  Confirmed `node build.js` gets past the `details` check now.

Both confirmed only by local build/grep checks, not a live deploy.

### Still blocking the live site — neither PR touches this

The build now stops on `icon_glyph`, required on **15 of 18 projects**,
none of which have it yet. Expected given the batching order (icons haven't
been done); left required deliberately since the WebGL grid has no
blank-icon fallback. Nothing saved through the CMS reaches the live site
until those are filled in, or the projects are marked `draft`.

### Loose ends for the next thread

1. Review and merge PR #22 and #23 (independent, either order) — but see
   the Netlify status update above: merging doesn't deploy until the free
   plan resets or Robert upgrades.
2. Get icons onto the 15 projects that need them, or mark them `draft`, to
   unblock the live build.
3. `claude/github-repo-overview-a3bbo3` still exists with both commits
   combined — now redundant since they're split into #22/#23. Fine to
   delete once those merge.
4. From the earlier debugging pass, still open per `PUNCH-LIST.md`:
   review-before-publish branch protection, `<title>` still `v80`,
   placeholder contact email, no favicon/OG/404,
   `big-deal-project.mdoc` test entry to delete.
5. `grid-motion` branch — parked, not touched.

---

## HANDOFF — Two agents, one repository (2026-10-10)

Codex joins Claude Code on this repository. What changed, what is left for
Robert, and where production picks up.

### Done

- **The repository lives at `~/Developer/rmaciel-work`**, out of iCloud.
  Copied rather than moved, then checked: the same 1,303 files, `git fsck`
  clean, `npm ci` and `npm run build` pass, Harvest.app rebuilt from the new
  path and launched (its page loaded), GitHub Desktop relinked.
- **`CLAUDE.md` became `AGENTS.md`**, the one file every agent reads. Codex
  reads it by that name; `CLAUDE.md` now only imports it. The rules that lived
  in Claude's private memory — the pull-request flow, the Harvest PID rule,
  the standing holds — moved into its "Working across agents" section, so
  Codex works under the same ones.
- **Codex on this Mac reads all of it.** Codex stops reading `AGENTS.md` at
  32 KiB unless told otherwise, and the file is ~41 KB, so
  `~/.codex/config.toml` now sets `project_doc_max_bytes = 65536`. That
  setting is on this Mac, not in the repository.
- Two statements about Keystatic writing straight to `main` were corrected:
  the repository is public and a ruleset now refuses direct pushes.

### Robert's next steps

1. Drag `rmaciel.work - site` off the Desktop into the Trash. Nothing uses
   it any more, and an edit made there reaches nothing.
2. Start Claude sessions from `~/Developer/rmaciel-work`.
3. Codex: open the ChatGPT app, go to Codex, and pick the same folder. First
   task, to prove the loop end to end: something small that ends in a merged
   pull request.
4. Never point Claude and Codex at the folder at the same time. If both are
   working, the second one asks for its own worktree.

### Known limits

- **Codex from the phone.** A cloud task does not have this Mac's
  `~/.codex/config.toml`, and is expected to read only the first 32 KiB of
  `AGENTS.md`. That cuts it partway through "Rejected alternatives", losing
  Conventions, Current state and Deployment. **Split the file before relying
  on Codex from the phone** — not done now, since nothing uses it there yet.
- **Keystatic and the ruleset — untested.** The ruleset has no bypass, so a
  Keystatic save to `main` should be refused. Branch first in the editor
  anyway, as `README.md` says.
- **Codex and pushing.** Expect Codex to ask before running `git push` or
  `gh`. Approve them for this repository; they are how work reaches the site.

### Production — where it picks up

Nothing here changes the queue; the open work is where it was.

- `PUNCH-LIST.md` is the gate before the domain moves. Section 1 (content)
  is the long pole.
- **NEXT — Video and audio players**, above: waiting on Robert's go for a
  second domain to serve the R2 bucket.
- **HANDOFF — Netlify build cost**, above: splitting into two Netlify sites,
  waiting on his go.
- Harvest: growing to cover every project field; its output stays held
  until he says so (`AGENTS.md`, standing holds).
