# CLAUDE.md

Context for anyone — human or Claude — working on this repository.

---

## What this is

A personal portfolio site for Robert Maciel, a multidisciplinary artist and
designer in New York. **One HTML file, zero dependencies, zero external
assets** — vanilla JS + WebGL2 + GLSL. ~37 KB gzipped, one request.

`index.html` is the entire site. That is not an accident or a stage on the way
to a framework; it is the point. Proposals that add a build step, a package
manager, a framework, or a second request need to clear a high bar and should
be raised as a question, not implemented.

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

### Response style

The rules above are about *judgment* — what to do. These are about *prose* —
how the reply is written. "Answer first, then explain" is the short form;
this is the whole of it.

- **Answer first.** State the conclusion, then stop. Reasoning only if asked.
- **Cut anything that doesn't change his next action.** True but inert = cut.
- **No meta-commentary.** Don't describe the question, reframe it, or explain
  what kind of answer is coming.
- **No unrequested elaboration.** One idea per response. Don't add the
  second-order point, the adjacent case, or the thing he didn't ask about.
- **Structure must earn itself.** Headers only for genuinely parallel
  sections. Never headers on a single idea.
- **Don't restate the question. Don't summarize what you just said.**
- **Corrections and mistakes: say it once, plainly, move on.** No extended
  self-assessment.

Default lengths:

| Kind of question | Length |
|---|---|
| Factual | 1–2 sentences |
| How-to | Numbered steps, no intro |
| Judgment call | Recommendation plus one line of why |

Go long only when he asks for depth, or when the steps genuinely require it.

**"Tighten"** means: re-answer at half length. No apology, no explanation.

Two of these have standing exceptions elsewhere in this file, and those win:
**diagnose before coding** (the root cause gets stated even when unasked) and
**flag genuine forks** (a real risk to an adjacent system gets raised). Both
still obey the length rules — a sentence, not a section.

---

## Architecture — seven systems, one file

1. **Content block + adapter.** All editable copy lives in one labelled
   `CONTENT` block near the top of the IIFE. `buildData()` translates that
   authoring shape into the internal shape the code runs on. **This adapter is
   the CMS seam** — a CMS later feeds the same shape and nothing downstream
   changes.
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
| A build step / framework / npm | The single-file, zero-dependency character is the point |
| A separate content JSON file | Browsers block fetching local files, so previewing a wording change would need a running server |
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

Static file on Netlify, deployed from this repo. The domain is registered at
Squarespace with a live Google Workspace mailbox on it.

**Do not touch nameservers, MX records, or TXT records.** See the standing
rules in `PLAN.md`. The site cutover is two records; everything else stays.
