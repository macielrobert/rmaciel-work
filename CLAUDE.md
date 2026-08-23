# CLAUDE.md

Context for anyone — human or Claude — working on this repository.

---

## What this is

A personal portfolio site for Robert Maciel, a multidisciplinary artist and
designer in New York. **One HTML file, zero dependencies, zero external
assets** — vanilla JS + WebGL2 + GLSL. ~37 KB gzipped, one request.

The **deployed** index.html is the entire site. That is not an accident or a stage on the way to a framework; it is the point.

The repository holds a source template plus a content folder, and build.js folds them into that one file at deploy. **What a visitor downloads is unchanged: one HTML file, one request, zero runtime dependencies, no framework.**

The repository is no longer dependency-free, and that distinction is now load-bearing rather than pedantic:

- **The site build** is `build.js` plus one package, `@markdoc/markdoc`, which has no dependencies of its own and is required lazily — inside the one function that parses a description, not at the top of the file. **It is a real dependency now, not an optional one.** The lazy require used to mean the site built with `node_modules` deleted; that only held while no `.mdoc` file had a body, and all fifteen projects have one. A bare checkout now fails on the first entry with a message naming the file and saying to run `npm install`. Netlify installs before it builds, so the deploy is unaffected.
- **The editor** is an Astro + React application serving `/keystatic`, with a Netlify function behind it for the GitHub login. It is ~950 packages and it touches nothing the visitor downloads.

The bar still stands, and applies to the SHIPPED file: a framework, a bundler, a runtime dependency, or a second request in `index.html` need to clear a high bar and should be raised as a question, not implemented. The typeface is the one accepted exception — three font files, deliberately, for reasons recorded in `NOTES-CUSTOM-FONT.md`.

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

1. **Content block + adapter.** All editable copy lives in one labelled CONTENT block near the top of the IIFE, between the CONTENT:START and CONTENT:END markers. buildData() translates that authoring shape into the internal shape the code runs on. **This adapter is the CMS seam**, and it has now survived two CMSs: Decap wrote JSON, Keystatic writes `.mdoc`, and `buildData()` never changed a line for either. The markers are parsed by a script. Do not reformat, rename, or move them, and do not hand-edit CONTENT in the built output — the CMS is the source of truth and the next build overwrites it.
2. **WebGL icon grid.** Icons baked to textures, warped by a shared simplex
   noise shader. Selection = coherence: the chosen icon freezes, all others
   churn.
3. **Footer navigation.** ALL and the three sections (BUILD / DESIGN / ART)
   against the left margin, ABOUT / CONTACT against the right. Primary nav,
   not decoration. The sections have two renderings — a flat row of labels
   (the default) and a vertical three-slot wheel (`?wheel`).
4. **Window.** Per-entry text and imagery, swapped through a character-churn
   transition, arranged by a named layout (`standard` / `grid` / `text` /
   `form`).
5. **Image expand.** In-flow view swap inside the window; swipe to navigate;
   two-scope exits (`←` local, `×` global).
6. **Theme.** Follows device `prefers-color-scheme`. Two CSS variables plus one
   shader uniform recolor everything. A third, `--accent-rgb`, is the grey that
   is neither — not theme-swapped, and the one place that colour is written.
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
  the image-grid cell (200), and body copy (`--measure` 33em). Extra viewport
  becomes space, never a bigger element.
- **The band is what says where a section ends.** The row always shows every
  project, so a footer link does two things: it scrolls that section's first
  icon to the left margin — plus `ROW_SNAP_INSET`, which keeps it out of the
  edge dissolve — AND draws that section in ink with everything else
  in accent grey. ALL — the fourth slot in the wheel, and the state the page
  loads in — is every icon ink. Like the other three it lands at REST, closing
  whatever the window holds, project or fixture; unlike them it does NOT move
  the row, because it is a way of looking at the row rather than a place in
  it. **Two things fall back to ALL**: scrolling until none
  of the banded section is on screen, and **picking an icon from outside the
  band** — reaching past the accent grey for something says the band is not
  what you were looking for. Both are the same idea, that the band is a place
  and not a mode.
  Two rules keep it from tangling with the rest: **colour is not coherence**
  (an out-of-band icon still churns; it is demoted, not switched off), and a
  chosen thing is never drawn in the resting colour — which needs no exemption
  in the paint, because `commit()` has already cleared the band by the time
  `applySelection()` runs. `commit()` is where that lives, not `setSelected()`:
  it is the funnel the pointer, the keyboard and a deep link all pass through.
  The consequence to know: the band is not in the URL when a project is open,
  so reloading `#design/bus-stop` lands in ALL rather than in DESIGN.
- **The footer has TWO ENDS, not a centred clump.** The sections sit against
  the left margin — the same one every text column in the site starts at — and
  CONTACT / ABOUT / the field mark are pushed to the right by a single
  `margin-left: auto` on CONTACT. No wrapper elements. The strip's padding is
  `--nl-m` minus 8, because every label carries 8px of its own for the tap
  target: the INK lands on the margin and the target overhangs it, at both
  ends. True in both renderings below.
- **The band has two renderings, and `?wheel` picks the other one.**
  DEFAULT IS THE FLAT ROW — it is also the DOM's resting state, so a visitor
  without the flag never sees a swap, and the flag is read at parse time
  rather than in `boot()` so `?wheel` does not flash the flat row first.
  Both are in the file and `updateNav` marks both; only one is painted.
  `FOOTER_RESERVE` follows: 52 for one line of labels, 72 for three.
  The rest of this entry is the wheel.
- **The wheel's centre IS the band.**
  ALL / BUILD / DESIGN / ART stacked three-at-a-time at the left margin:
  centre slot at full ink, the two neighbours at half. It is the menu
  row's grammar turned 90 degrees — endless, momentum-scrolled, and committing
  on REST rather than on the way past. **The mask is the state**: everything in
  the wheel is `--ink` and the CSS mask alone lights the middle one, so there
  is no `.on` class that can drift out of step with the scroll position.
  **No caret and no arrows**, for the reason the row has none, only stronger:
  the half-lit neighbours name the sections you would land on, so they say
  which way as well as that. Three things it must keep doing: only a scroll the
  VISITOR started commits (the wheel also moves itself whenever the band
  changes elsewhere, and that must not come back round as a request); a fixture
  outranks it, dropping the whole wheel to grey, because ABOUT and two ink
  labels cannot both be true; and the re-centring onto the middle copy happens
  at REST only — moving `scrollTop` under a live iOS fling kills the fling.

- **The row holds EVERY section, in section order, and it is a RING.** BUILD /
  DESIGN / ART are addresses along one endless row, not three menus that swap.
  Past the last ART icon comes the first BUILD icon again (`rowCycle` in
  `index.html`), which is the only thing that makes a footer link honest on a
  WIDE screen: where the row is shorter than the viewport there is otherwise
  no scroll position that puts DESIGN at the left margin, and clamping could
  only ever reach the last section. A footer link therefore jumps to the
  NEAREST turn — never more than half a cycle, forward or back, measured from
  where you are. On a screen wider than one turn the same icon is genuinely on
  screen twice; the draw loop and the hit test walk the same turns, so every
  copy is that one icon to a tap and to the selection.
  The churn-over that used to exchange icon sets is gone — it was the awkward
  part — and with it `activeSection` stopped being a mode you switch into: it
  is read off whatever is selected, and only lights the footer.
- **The menu is ONE ROW at every width.** It never gains a second row and it
  never shrinks the icons. Narrow viewports used to gain rows (390px portrait
  was 6 x 3), which spent a third of a phone on navigation and moved the seam
  every time the icon count changed. It is swipeable with momentum, and the
  canvas is always the full available width — a row that continues past the
  right edge cannot stop short of it (`ROW_*` knobs in `index.html`).
  Note the name collision the code avoids: the *carousel* in this file has
  always been the image strip at the foot of the window (`#nl-car`,
  `--car-h`). The menu row is `ROW_` / `row`, never `car`.
- **The faded edge IS the scroll affordance, and the wheel is the control.**
  The menu row dissolves into the background at BOTH edges, always, one PITCH
  wide. It used to say "this much travel is left this way" and ramp out as you
  reached an end; on a ring that reading is simply true in both directions at
  every moment, so it stopped being a per-frame calculation and became a fact
  of the layout. One pitch is a floor, not a taste: a mask dissolves only ink
  that is under it, and the ink-free run between two icons is 30.5px, so a
  ramp shorter than a pitch can land in that void and do nothing. It did — at
  334px wide the old 32px ramp erased exactly zero ink. Over that row a PLAIN vertical wheel scrolls it horizontally —
  `html, body` are `overflow: hidden`, so a vertical wheel there did nothing
  before and claiming it costs nothing. Together those give a mouse-only
  visitor both the signal and the control with no added furniture, and the
  phone gets the same thing.
- **A tap commits on RELEASE, not on press.** Below `ROW_TAP_SLOP` of travel
  it was a tap; above it, a swipe. Selecting on press fires a project every
  time a swipe starts on an icon — which is most of the time. The row always
  scrolls now, so this is the only path.
- **`ROW_SNAP_INSET` is where the row parks an icon, and it is ONE number for
  every move the row makes on its own** — the footer category jump and
  scroll-into-view, at both edges. They are one problem: an icon the row has
  deliberately brought to an edge has to be legible when it gets there, and the
  margin alone lands it inside the one-pitch dissolve. At the default pitch the
  leading glyph's alpha is `(margin + inset + 9) / 62.5`, so 0 gives 34%, 30
  gives 82%, and **41 is the first value that guarantees full ink**. It sits at
  **50**, past that guarantee, because **the indent is the point**: the extra
  travel pulls the icon BEFORE the landing into the ramp at roughly 14–66%
  across its width, so the snapped icon reads as a heading with the previous
  section trailing away behind it rather than as a row that happens to start
  here. Deliberately not derived from the pitch: it is chosen by looking at it,
  and a derived one would move the landing every time a short viewport shrank
  the pitch (a shrunken pitch only indents further and stays fully inked).
- **The end-of-scroll bounce became the category jump.** The spring that used
  to catch the row at the two ends of the run (`ROW_SNAP_K` / `ROW_SNAP_DAMP`,
  just above critical) now carries every move the row makes on its own: a
  footer jump, and scroll-into-view for focus and deep links. A ring has no
  end to bounce off, and a jump with no spring is a cut. **Never on load** —
  `bootRoute` makes the first route instant, because a page arriving already
  in motion reads as a glitch.
- **Below the seam is an exit; above it is not.** The bottom half IS the menu,
  so a tap there that lands on nothing means "put the work down" — which the
  gaps between icons already meant, now extended to the rest of that half
  (the margins around the row, the footer strip's empty space). The window and
  its margins were tried as an exit and it was wrong: stray taps around the
  window, especially near the `←` mark, ejected the whole state. Tested by
  GEOMETRY, not DOM containment — `#nl-fns` is an absolutely positioned sibling
  of the window that sits inside the grid half. Four things opt out because
  they answer for themselves: the canvas, the key spans, the footer links, the
  field button. The **contact lock still wins** — with the form up, the `×` is
  the only exit.
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
- **The measure is an ESTIMATE now, not a guarantee.** It was `66ch`, which in
  a monospace face was exactly 66 characters. In PP Neue Montreal `ch` is the
  width of a zero, so it is `33em` and measured at 67 characters by counting.
  Re-tune by counting, never by arithmetic.

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
- **The caret is DRAWN, not typed.** It was two codepoints swapped by JS,
  U+2304 and U+2303, and neither is in the typeface — both fell to the fallback
  stack, which resolves each independently, so the two halves of one control
  came from different fonts. It is now two borders on a rotated box: one shape,
  180 degrees apart, mirrors by construction.
- **The theme is TWO classes, `.light` and `.dark`, and the second is not
  redundant.** A media query carries no specificity, so on a light device the
  only thing that can outrank the pre-boot `@media (prefers-color-scheme:
  light)` block is a class on the same id. With `.light` alone, JS could turn
  the theme light and never back — invisible while JS only ever agrees with the
  device, and a split page the moment it does not.
- **Controls never churn.** `×`, `←`, the caret, thumbs, footer,
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
- **The authored slug is the URL; a title-derived one is only the fallback.**
  Never an index either way — reordering a section must not break a link
  someone already sent. In the CMS the authored slug is the FILENAME, which is
  what makes the editor's "set once and never change it" promise true and lets
  titles be edited freely. It was title-derived until a debugging pass found
  that `keystatic.config.tsx` and `README.md` both promised the opposite;
  switching changed no existing URL, because Keystatic derives filenames from
  titles too. `buildData()` falls back to `slugify(title)` for ABOUT and any
  hand-written entry.
- **The CMS decides the content filenames, not us.** A Keystatic singleton or
  collection with a rich-text `contentField` is stored as ONE `.mdoc` file —
  JSON frontmatter, then the prose. Without one it stays pure `.json`. So
  `about` is `content/about.mdoc` while `contact` and `site` are `.json`, and
  that asymmetry is Keystatic's rule (`getDataFileExtension`), not a choice.
  Read a different name than the editor writes and the two silently diverge —
  which is exactly what happened to ABOUT after the migration.
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
| Sveltia / TinaCMS / hand-edited JSON as the CMS | Each ruled out against a stated requirement, not on taste — see `NOTES-CMS-DECISION.md`. Keystatic is installed and Decap is gone |
| A custom Decap editor widget | A React component against a CMS's internal API, in the only interface for editing the site, untestable from the build sandbox. Moot now: Keystatic's custom marks do the job as a supported API |
| Code blocks in the editor | Need a monospace face the site deliberately stopped shipping — a fifth typeface on a page with one chosen one |
| Headings in the editor | `Larger` is a real mark now, so borrowing a heading for size is obsolete. Six levels of hierarchy the layout has no answer for |
| A framework, bundler, or npm dependency **in the shipped file** | The single-file, zero-dependency character of the **shipped** file is the point. build.js is not exempt from npm any more — it needs `@markdoc/markdoc` — but its output is still the same one file, and nothing the editor depends on reaches a visitor |
| **Fetching** a content file at runtime | Browsers block fetching local files, and it would add a second request. Content is folded in at build time instead — the file the visitor gets still has everything inline |
| Typing ratio by hand in the CMS | The CMS's image field does not report dimensions. build.js reads them from the uploaded file's header. A required field that a human can silently get wrong should not be a form field |
| Minification | Comments are ~40% of the file but gzip to almost nothing. Stripping saves <100ms and costs the documentation |
| anime.js | Only justifies itself for orchestration, timelines, stagger, or spring physics. For a single fixed-curve transition it equals a CSS transition |
| SVG displacement filters | Mobile-hostile at scale |
| Fixed 50/50 grid split | The seam follows the menu |
| Centering the window text | Every text column starts at a left margin (v71) |
| A separate deliberately-broken build for testing | Use `?nogl` instead — one file, no confusable copies |
| ◄ ► arrows on the menu row | Duplicate a capability the wheel already gives, in furniture the phone would never show — a device-conditional design paying for what the faded edge says for free on both |
| Caret or arrow indicators on the section wheel | Same answer the menu row gave, and for more reason: the half-lit neighbours already name what is above and below |
| Hover auto-scroll zones at the row's ends | Not an indicator at all: you must already suspect there is more. The zones sit on top of icon cells, and the row moving under a stationary cursor means the icon you click is not the one you aimed at |

---

## Conventions

- **Comments are documentation and are load-bearing.** They record *rejected
  alternatives and reasons*, not just behavior. Match that style: when you
  make a non-obvious choice, write down what you didn't do and why. Do not
  strip or condense existing comments.
- **`?nogl`** on the URL forces the no-WebGL fallback for testing.
- **`?light`** / **`?dark`** pin the theme, for testing on a browser that will
  not give you the other one — Chrome mobile in an Incognito window reports
  dark whatever the phone is set to, which puts every light-mode path out of
  reach on the device this site is built for first. The theme still follows the
  device otherwise; while a pin is set the live listener is not attached. The
  address-bar tint keeps following the device either way — the theme-color
  metas are media-scoped and the browser picks between them itself.
  `location.search` only, same rule as `?wheel`.
- **`?wheel`** on the URL swaps the flat section labels for the vertical
  wheel. `location.search` only, never the hash — a project slugged `wheel`
  would otherwise turn it on.
- **Verify before presenting.** At minimum: JS syntax check, CSS brace
  balance, and a grep that every new function is actually wired in. Several
  real bugs were caught this way.
- **Version numbers were a workaround** for passing files through chat. In Git,
  history handles that. `<title>` should hold the real site title, not `v80`.

---

## Current state

The site is `index.html` at the repository root. Version numbers in filenames
are gone; `<title>` still reads `SVG Noise Lab — v80` and is on the punch list.

Companion documents in this repo:

- `TO-DO.md` — the single master to-do, code debt and the domain/DNS migration
  interleaved in execution order. **Includes four standing rules about not
  breaking his email — read them before touching anything DNS-related.**
- `STRESS-TESTS.md` — the test list, including which tests are impossible in a
  sandboxed preview and need a real URL.
- `PUNCH-LIST.md` — the pre-launch gate: everything that must be true before
  the domain points here. The launch-time phases of `TO-DO.md` point at it so
  nothing is tracked twice. **Work from this once real content starts.**
- `README.md` — plain-language operating instructions for Robert: what the four
  parts do, how to publish a change, how to read a failed build. Written for
  the owner, not for a programmer. Keep it jargon-free if you touch it.
- `NOTES-CMS-DECISION.md` — every CMS option, kept or ruled out, with each
  claim marked verified or recalled. **Read before proposing anything about
  the CMS.** The decision has been made three times because the reasoning was
  never written down; it is written down now.
- `NOTES-*.md` — design notes belonging to a branch. Each is that branch's
  memory: read it first, update it last.

Real content has started arriving; `CONTENT` is no longer all placeholder.

**CMS: Keystatic, migrated and live.** Decap is gone — `admin/` deleted, all
content converted to `.mdoc`. The editor is at **`/keystatic`**. Formatting is
real toolbar buttons, including three custom marks that emit the classes
`index.html` already styles.

**One thing is worse than it was, and it is not fixed.** Decap opened a pull
request per edit. Keystatic writes straight to `main`, because the equivalent
is a GitHub branch protection rule and **rulesets are not enforced on a private
repository on the free plan.** Creating a branch in the editor before editing
restores the loop manually. See `NOTES-KEYSTATIC-SETUP.md`.

`NOTES-CMS-DECISION.md` holds every option and why each was kept or ruled out.

---

## Deployment

**Build.** Netlify runs `npm run build`, publish directory `dist`. That is two commands and **the order is load-bearing**: `node build.js` deletes `dist/` and rebuilds it, then `astro build` writes the editor's assets alongside with `emptyOutDir` off. Reversed, the second command wipes the first's output and the site disappears from the deploy — verified by running it both ways, not inferred from the comment.

`build.js` reads `content/projects/*.mdoc` plus the three singleton files, sorts projects by order, drops anything flagged draft, reads image dimensions for ratio, writes the assembled CONTENT between the markers in the source template, and emits `dist/index.html`, `dist/fonts/` and `dist/images/`.

Both halves land in one `dist/` and neither shadows the other: the Netlify function Astro emits declares `path: '/*'` with `preferStatic: true`, so a request for `/` gets the static `index.html` and only `/keystatic` and its API route reach the function.

**Editing.** Keystatic at `/keystatic`, authenticated by a **GitHub App** (not a plain OAuth app) with four environment variables in Netlify. A save commits to `main` immediately unless a branch is created first in the editor. Every setup step, and the exact symptom of each missing piece, is in `NOTES-KEYSTATIC-SETUP.md`.

**Consequence worth knowing:** opening the repo's index.html directly no longer previews the real site — the source template's CONTENT block is empty by design. Previewing means a deploy URL.

Static file on Netlify, deployed from this repo. The domain is registered at
Squarespace with a live Google Workspace mailbox on it.

**Do not touch nameservers, MX records, or TXT records.** See the standing
rules in `TO-DO.md`. The site cutover is two records; everything else stays.
