# CLAUDE.md

Context for anyone — human or Claude — working on this repository.

---

## What this is

A personal portfolio site for Robert Maciel, a multidisciplinary artist and
designer in New York. **One HTML file, zero dependencies, zero external
assets** — vanilla JS + WebGL2 + GLSL. ~37 KB gzipped, one request.

The **deployed** index.html is the entire site. That is not an accident or a stage on the way to a framework; it is the point.
Since the CMS, the repository holds a source template plus a content folder, and build.js folds them into that one file at deploy. **The published artifact is unchanged** — one file, one request, zero runtime dependencies, no framework, no package manager. build.js runs on Node built-ins only and has no package.json.
The bar still stands for anything that changes what ships: a framework, a bundler, a runtime dependency, or a second request need to clear a high bar and should be raised as a question, not implemented.

The site is also a portfolio *piece* — the icon menu is the work as much as it
is navigation.

---

## Who you are working with

Robert is **not a programmer**. He is self-teaching JavaScript and moving from
copy-paste comprehension toward genuine understanding. He has an MFA and ~10
years of practice across painting, sculpture, photography, fabrication,
objects, environments, and systems design. He reads CAD and parametric design
fluently — those analogies land faster than programming ones.

He works **primarily on an iPhone**, and on a MacBook Pro 14" M2 Max.

### How to work with him

- **Answer first, then explain.** Concise. He is often reading on a phone.
- **Diagnose before coding.** Identify the root cause and say what it is before
  editing. Speculative fixes have failed here and he has called it out
  directly. If you are not sure why something is broken, say so and
  investigate — do not guess and ship.
- **Narrow scope.** Touch only what was asked. If an adjacent system is at
  risk, flag it before changing it.
- **No work done twice.** No regressions, no stale files, no redundant passes.
- **Define jargon on first use.** He has explicitly corrected unexplained
  terms ("chrome", "seam", "transform", "carless"). Plain language.
- **Make sensible defaults and document them.** He often skips open questions
  and expects a reasonable call to have been made and recorded. Flag genuine
  forks; do not stall on small ones.
- **He approves by moving on.** Silence usually means yes. Corrections are
  short and direct.
- **Tell him when he is wrong.** He asked explicitly for a true assessment and
  acted on it. Do not soften real problems.

---

## Architecture — seven systems, one file

1. **Content block + adapter.** All editable copy lives in one labelled CONTENT block near the top of the IIFE, between the CONTENT:START and CONTENT:END markers. buildData() translates that authoring shape into the internal shape the code runs on. **This adapter is the CMS seam**, and it is now load-bearing: Decap writes JSON into content/, build.js serialises it between those markers, and nothing downstream changed when the CMS arrived — as designed. The markers are parsed by a script. Do not reformat, rename, or move them, and do not hand-edit CONTENT in the built output — the CMS is the source of truth and the next build overwrites it.
2. **WebGL icon grid.** Icons baked to textures, warped by a shared simplex
   noise shader. Selection = coherence: the chosen icon freezes, all others
   churn.
3. **Footer navigation.** Three sections (BUILD / DESIGN / ART) plus two
   fixtures (ABOUT / CONTACT). Primary nav, not decoration.
4. **Window.** Per-entry text and imagery, swapped through a character-churn
   transition, arranged by a named layout (`standard` / `grid` / `text` /
   `form`).
5. **Image expand.** In-flow view swap inside the window; swipe to navigate;
   two-scope exits (`←` local, `×` global).
6. **Theme.** Follows device `prefers-color-scheme`. Two CSS variables plus one
   shader uniform recolor everything.
7. **Routing.** `#section/slug/image` mirrors state. The URL never becomes a
   second way of setting state.

Plus two parallel layers that exist for resilience:

- **`#nl-keys`** — a DOM twin of the icon grid, one focusable span per icon.
  Carries keyboard and screen-reader semantics, and **becomes the visible menu
  when WebGL is unavailable**. One menu, two renderings.
- **No-WebGL fallback** — the shader is an enhancement. `boot()` never returns
  early.

---

## Load-bearing decisions — do not break these

Each of these was arrived at by hitting the problem. Changing one without
understanding why it exists will reintroduce a solved bug.

### Layout

- **The taskbar rule.** Things have a fixed size; only the *count* adapts.
  Applied to the icon cell (`CELL_PX` 50), the wordmark (320), the hero (720),
  the image-grid cell (200), and body copy (`--measure` 66ch). Extra viewport
  becomes space, never a bigger element.
- **The seam follows the menu.** The grid half is exactly
  `canvas height + FOOTER_RESERVE` — never a fixed fraction of the page. The
  no-WebGL fallback obeys this too, measuring the wrapped title list.
- **`justify-self: stretch`, not `start`,** on `#nl-window-text` in landscape.
  `start` sizes a grid item to *fit-content*, which is invisible for prose and
  collapses anything short. This is what broke the contact form in v74.
- **`line-height: 1`** on the vertical copyright. In vertical text the line box
  becomes the *width*; the default 1.2 overhangs the margin strip.
- **`--measure` is for reading; `--measure-form` is for a form.** 45–75
  characters is a fact about prose, not about input fields.

### Rendering

- **Alpha is the shape.** Icons and wordmarks are drawn white-on-transparent
  and recolored by ink (`uInk * alpha` in the shader, a CSS mask in the DOM).
  Source art must be transparent with real counterforms. An opaque PNG or any
  JPG becomes a solid block.
- **Never rasterize `<text>` inside SVG via `<img>`.** Glyphs are drawn
  directly to canvas in `bakeIcon`. This is a known-bad path in this codebase.
- **SVG displacement filters are mobile-hostile at scale.** Confirmed from
  prior experience. WebGL fragment shader is the correct path for raster
  images on mobile. Do not propose SVG filters.
- **Controls never churn.** `×`, `←`, the `⌄` caret, thumbs, footer,
  copyright, focus marks. They appear and disappear with their views but stay
  resolved. Content churns; controls do not.
- **Exactly one thing is coherent at any moment.** With a fixture open, that
  thing is the footer label and the whole grid churns.

### Resilience

- **`boot()` must never return early.** `gl` is a `let` and doubles as the
  feature flag; every GL-touching block is guarded. Three failure points
  (context, shader compile/link, bake) all degrade the same way.
- **Every degrade path must `console.warn` with the reason.** A silent
  downgrade is indistinguishable from a bug, and a broad `catch` will happily
  swallow a coding mistake and dress it as a hardware limitation.
- **URL writes must be guarded.** In a sandboxed or cross-origin iframe
  `history.replaceState` throws. `syncRoute()` runs inside `commit()`, so an
  unguarded throw takes *selection* down with it. A convenience feature must
  never be able to break a core one.
- **Slugs come from titles, not indices.** Reordering a section must not break
  a link someone already sent.
- **`ratio` on image records is effectively required.** Without it the page
  downloads every image on the site at load just to measure its shape.

### The other repo

- In the companion React portfolio (`portfolio-expand.jsx`), the `data-tile`
  wrapper **must have `transform: none` post-entrance** or the FLIP containing
  block breaks and fixed positioning fails.

---

## Rejected alternatives — do not re-propose without new information

| Rejected | Why |
|---|---|
| A framework, bundler, or npm dependency | The single-file, zero-dependency character of the **shipped** file is the point. build.js is exempt: Node built-ins only, no package.json, and its output is the same one file | | **Fetching** a content file at runtime | Browsers block fetching local files, and it would add a second request. Content is folded in at build time instead — the file the visitor gets still has everything inline | | Typing ratio by hand in the CMS | Decap's image widget does not report dimensions. build.js reads them from the uploaded file's header. A required field that a human can silently get wrong should not be a form field |
| Minification | Comments are ~40% of the file but gzip to almost nothing. Stripping saves <100ms and costs the documentation |
| anime.js | Only justifies itself for orchestration, timelines, stagger, or spring physics. For a single fixed-curve transition it equals a CSS transition |
| SVG displacement filters | Mobile-hostile at scale |
| Fixed 50/50 grid split | The seam follows the menu |
| Centering the window text | Every text column starts at a left margin (v71) |
| A separate deliberately-broken build for testing | Use `?nogl` instead — one file, no confusable copies |

---

## Conventions

- **Comments are documentation and are load-bearing.** They record *rejected
  alternatives and reasons*, not just behavior. Match that style: when you
  make a non-obvious choice, write down what you didn't do and why. Do not
  strip or condense existing comments.
- **`?nogl`** on the URL forces the no-WebGL fallback for testing.
- **Verify before presenting.** At minimum: JS syntax check, CSS brace
  balance, and a grep that every new function is actually wired in. Several
  real bugs were caught this way.
- **Version numbers were a workaround** for passing files through chat. In Git,
  history handles that. `<title>` should hold the real site title, not `v80`.

---

## Current state

Live build: **v80** (to become `index.html`).

Two companion documents in this repo:

- `PLAN.md` — the single master to-do, code debt and the domain/DNS migration
  interleaved in execution order. **Includes four standing rules about not
  breaking his email — read them before touching anything DNS-related.**
- `STRESS-TESTS.md` — the test list, including which tests are impossible in a
  sandboxed preview and need a real URL.

Everything in `CONTENT` is still placeholder.

---

## Deployment

**Build.** Netlify runs node build.js, publish directory dist. The script reads content/*.json, sorts projects by order, drops anything flagged draft, reads image dimensions for ratio, writes the assembled CONTENT between the markers in the source template, and emits dist/index.html plus dist/images/. No install step; nothing to keep up to date.

**Editing.** Decap CMS at /admin, authenticated by a GitHub OAuth app registered in Netlify. Editorial workflow is on, so a save opens a pull request with its own deploy preview rather than publishing straight to live.

**Consequence worth knowing:** opening the repo's index.html directly no longer previews the real site — the source template's CONTENT block is empty by design. Previewing now means the deploy preview URL. This is the one thing the CMS cost.

Static file on Netlify, deployed from this repo. The domain is registered at
Squarespace with a live Google Workspace mailbox on it.

**Do not touch nameservers, MX records, or TXT records.** See the standing
rules in `PLAN.md`. The site cutover is two records; everything else stays.
