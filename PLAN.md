# SVG Noise Lab — Master Plan

One list. Code debt and the domain/email migration interleaved in the order
they actually need doing. Current build: **v80**.

Companion files: `CLAUDE.md` (context for Claude Code and `@claude`),
`STRESS-TESTS.md` (the test list, run at Phase 4).

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

## PHASE 1 — Repository

Everything else hangs off this. Deploying from a repo rather than dragging a
file in is what makes iterative updates possible at all.

- [ ] GitHub account if you don't have one; create a repo (private is fine —
      Netlify can still deploy from it)
- [ ] Rename the build to **`index.html`** — static hosts look for that name.
      Version numbers in the filename were a workaround for passing files
      through chat; Git handles history now.
- [ ] Add the four companion docs to the repo root:
      `CLAUDE.md`, `PLAN.md` (this file), `STRESS-TESTS.md`, and the
      system handoff
- [ ] Commit and push

---

## PHASE 2 — Deploy from the repo

No DNS changes. Live site and email untouched throughout.

- [ ] Free Netlify account → **Add new site → Import from Git** → pick the repo
- [ ] No build command; publish directory is the repo root
- [ ] Confirm the `*.netlify.app` URL loads and the shader runs
- [ ] Confirm **deploy previews** are on (usually the default) — this is what
      gives every pull request its own preview URL

---

## PHASE 3 — Claude tooling

- [x] Connect GitHub to your Claude account (done — the
      `claude.ai/connect/github/callback` redirect *is* the confirmation)
- [ ] Go to **claude.ai/code**, confirm `rmaciel-work` appears
- [ ] Run one small task end to end: task -> sandbox -> pull request ->
      Netlify preview URL -> merge

Works the same from the browser and the Claude iOS app; sessions persist and
can be monitored from the phone. One door, both devices.

**Not needed:** the GitHub Actions route (`@claude` in issue comments). That
requires a workflow file and a separate API key with separate billing. The
account connection above supersedes it.

**Optional, later:** Claude Code locally on the MacBook, for long sessions.

**Optional:** branch protection on `main`. Claude Code on the web opens pull
requests anyway, so this is a safety net rather than a requirement.

Known gap: routes share the **code and `CLAUDE.md`, not conversation memory**.
Decisions that matter get written into `CLAUDE.md` or the commit message, or
they don't survive.

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

- [ ] **Share + search metadata** — description, Open Graph tags, favicon,
      `<h1>`, real `<title>`. Currently a link preview is a blank rectangle.
- [ ] **404 page** — `404.html`, or the host serves its own, which won't be
      this site
- [ ] **Form endpoint** — replace the mailto with Netlify's native form
      handling. Consider a dirty-state confirm on `×`.
- [ ] **`IMAGE_TRANSFORM`** — set to Netlify's image CDN URL format; verify
      the format against their live docs at setup

---

## PHASE 6 — Remaining code debt

Host-independent; can run in parallel with Phase 3.

- [ ] **Throttle `resize()`** — currently reallocates the GPU backing store
      and forces two layout reads per resize event. Desktop-only symptom.

---

## PHASE 7 — Real content

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

All four must pass.

- [ ] Site loads on apex **and** www
- [ ] HTTPS certificate issued
- [ ] Mail **to** your domain address from an outside account arrives
- [ ] Mail **from** your domain address delivers elsewhere

---

## PHASE 10 — Cleanup

Wait about a week after Phase 9.

- [ ] Cancel the Squarespace **website** subscription only
- [ ] Keep: domain subscription, Google Workspace subscription
- [ ] Confirm DNS management is still reachable afterwards

---

## DEFERRED

Not now; revisit if the conditions appear.

- [ ] **Lazy section build** — only if the project list grows substantially.
      Currently ~4,700 DOM nodes and 33 icon bakes at boot.
- [x] **CMS** — done twice. Decap arrived, hit its formatting ceiling, and was
      replaced by Keystatic. The data contract was CMS-shaped exactly as
      predicted: `buildData()` never changed for either. See
      `NOTES-CMS-DECISION.md`.
- [ ] **`<noscript>` block** — with JS off the page is blank. Six lines with
      your name and email would mean it's never truly empty.
- [ ] **Move domain registration off Squarespace** — a transfer, not a
      cancel, and a separate operation entirely. Much later, if ever.
