# SVG Noise Lab — Master Plan

Product work, code debt, and the domain/email migration. The v70–v80 labels
below identify historical work; Git records the current version.

> **Where work happens now.** Phases 1–3 are finished: the repository, the
> Netlify build, the CMS, and the Claude Code loop all exist and work. The
> current job is populating real work and improving the portfolio and Harvest
> together. **Start with CURRENT — Shared UX plan below** for the design and
> editor work. Codex owns strategy; Claude owns implementation.
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

## CURRENT — Shared UX plan: portfolio + Harvest (2026-10-10)

**Requested by Robert:** make the site and Harvest follow one style guide,
with straightforward, legible interactions. The site's icon row and category
navigation are essentially settled; focus site work on the content area.
Harvest should become a strong desktop website editor, with clearer Collect /
Organize logic and logically placed toolbars.

**Ownership:** Codex is the strategist and reviewer; Claude implements.
The checklist below records the proposed direction from the UX review, not
completed work or blanket acceptance of every proposed pixel value. Claude
should work in the sequence below, show the concrete designs, and record
results against the same task IDs. Do not create a competing backlog.

Follow `AGENTS.md` → **Process for substantial UX changes** for the standing
workflow. The task-specific proof is the UX-1 sample in both themes, the
isolated BUS STOP journey in UX-6, and early validation of formatted-text
round trips and unsaved preview in UX-5. Prove these before broad rollout;
the sequence below is not permission to defer all validation to the end.

### Boundaries and handoff

- Preserve the icon row, category behavior, fixed-size/adaptive-count rule,
  permanent slugs, keyboard navigation, and no-WebGL fallback. These are not
  invitations to redesign navigation or introduce a runtime framework.
- Preserve the unpublished Harvest content, NOISE alt-text hold, and Robert's
  ownership of the favicon and 404 design. Testing uses isolated copies and
  scratch state, never his working content or running Harvest session.
- Keystatic remains the fallback and schema of record. Any new authoring
  field must work through Keystatic, Harvest, the build, and the site together.
- This plan does not authorize content publication, DNS changes, the second
  media domain, or the proposed Netlify split. Existing holds remain in force.
- Per implementation task, Claude records: task ID, scope, branch/commit,
  what changed, checks and visual evidence, remaining issues, and any decision
  that needs Robert. Codex reviews against this plan; Robert resolves design
  choices. Use separate worktrees when agents edit concurrently.

### Existing work this plan overlaps

| Existing record | Relationship to this plan |
|---|---|
| DONE: desktop text measure | Preserve the bounded reading width; UX-1 retunes typography, not the principle |
| Phase 4 / `STRESS-TESTS.md` | UX-6 adds editor journeys and runs the existing site regression checks |
| Phase 7 / `PUNCH-LIST.md` §1 | Real-copy layout tests and placeholder removal are shared work with UX-4, not a second content migration |
| `PUNCH-LIST.md` §0 and Keystatic setup notes | UX-3 addresses save/publish clarity and the existing pull-request requirement; no CMS replacement |
| NEXT: video/audio | Keep its existing hosting decision and backlog; future media controls follow UX-1 and fit UX-2/4 |
| HANDOFF: Netlify build cost | Separate infrastructure work; a redesigned editor or preview does not depend on splitting hosts |
| `AGENTS.md`: Harvest direction | UX-2/5 make that direction concrete; existing project fields already work and should be reorganized, not rebuilt blindly |

The punch list remains the launch gate. When a shared task passes, update its
existing launch/test entry with the evidence instead of creating another copy.
Old handoffs describe earlier states: verify implementation before treating
their unchecked items or old project counts as current blockers.

### UX-1 — Establish the shared style and interaction guide

**Finding:** there is a visual language in `AGENTS.md`, the design notes and
CSS, but no complete guide for hierarchy, controls, states, and placement.
Harvest largely uses 11px Light text and unpadded uppercase text buttons for
navigation, actions, and toggles alike. The shared secondary grey calculates
to about 2.78:1 on white versus 5.42:1 on black: light and dark are not equally
legible. Normal text should meet 4.5:1; decorative rules need not use the same
grey as readable labels. Reference: [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

- [x] Create `STYLE-GUIDE.md`: one visual identity with explicit portfolio
      and editor applications. Preserve PP Neue Montreal, monochrome themes,
      fine rules, left-aligned reading, and purposeful motion.
- [x] Prototype these starting values: editor text/controls 13–14px Book,
      portfolio body 14px, secondary labels 12px, spacing 4/8/12/20/32px.
      Judge at actual size with real copy before adopting. Reserve Light and
      uppercase for intentional roles; do not enlarge settled navigation by
      changing a global type rule indiscriminately.
- [x] Specify readable primary/secondary text, title/facts/body/caption
      hierarchy, primary/secondary actions, disabled states, selected states,
      hover, focus, validation errors, empty states, and background progress.
      Selection must have a persistent marker as well as tone; keyboard focus
      must be visibly different from hover. Give controls consistent hit areas.
- [x] Separate theme-aware text greys from decorative hairlines. This
      deliberately revisits the existing fixed-grey rule for legibility;
      document the measured reason and retain navigation geometry/behavior.
- [x] Choose one maintainable source for shared design values and matching
      preview styles. Verify drift without adding a runtime stylesheet request
      or an editor dependency to the shipped portfolio.

**Done when:** representative text, controls, forms, and states can be compared
side by side in both themes, and the guide explains their roles and placement.

**Record, 2026-10-10 — Claude.** Branch `ux-1-style-guide`.
- **Scope:** the guide and the specimen. **Nothing is adopted**; the site and
  Harvest look exactly as before. Adopting the values is gated on Robert's
  answers, the five questions at the end of `STYLE-GUIDE.md`.
- **What changed:** `STYLE-GUIDE.md` (roles, values, states, placement, where
  values live). `tools/specimen.html`, today next to proposed in both themes
  at actual size with LIGHT WORK's and BUS STOP's real copy, plus a size
  switch for the site body and the one-grey alternative. `tools/check-tokens.js`
  fails when page.css or keystatic.config.tsx disagrees with index.html on a
  shared value; check-harvest.js runs it. A `specimen` entry in
  `.claude/launch.json` serves the repository so the fonts load.
- **Measured:** today's grey is 5.42:1 on black and 2.78:1 on white, and the
  footer's is 2.29 and 1.68. Proposed `--text-2` is 5.44 / 5.52, `--edge`
  (lines, not text) 6.56 / 3.20. The only single grey that clears 4.5 on both
  is `rgb(117,117,126)`, at 4.60 / 4.56. The specimen measures these live.
- **Checks:** specimen viewed at 1024px and 375px, both themes, no sideways
  scroll, fonts loaded, no console errors; check-tokens passes on the repo and
  fails on a copy with a drifted colour and mark size.
- **Needs Robert:** the five questions. Once answered, 1, 2 and 5 ship on their
  own (a few lines of index.html, and the single-grey rule in `AGENTS.md`
  rewritten); the body size goes with UX-4; Harvest takes the editor values
  with UX-2.

**Record, 2026-10-10, second pass: Claude.** Branch `ux-1-decisions`.
- **Robert's answers:** (1) one fixed grey, (2) footer and copyright in it,
  (3) a zigzag under the chosen footer label, not a straight line, with 90°
  vertices, about the x-height tall, (4) site body 12px, (5) keyboard focus
  outlines on the site's controls. They are recorded in `STYLE-GUIDE.md`,
  Decisions.
- **Live in `index.html`:** words use `--text-2` `rgb(117,117,126)`, 4.60:1 on
  black and 4.56:1 on white. That covers the footer, the copyright, titles,
  labels, captions, the glyph controls, SEND, and the no-WebGL labels. Field
  underlines use `--edge` (3.20:1 or better). The seam, dividers and quote
  bars use `--rule`, the old `--accent-dim`, at the same value. Keyboard focus
  is a 1px ink outline on ×, ←, the caret, SEND, the footer, the field mark,
  the sibling row, links, and the icon keys. The icon row's shader grey is
  unchanged. `AGENTS.md` records the new rule.
- **Specimen, draft 2:** the decisions applied; the zigzag under the chosen
  label is drawn in both themes, with ABOUT open, and with keyboard focus.
- **Checks:** a local build of the site, in both themes and at 375px. The
  computed colours were read off the footer, copyright, title, close mark,
  form labels, field line and SEND. Keyboard focus was measured on × and the
  footer, and the ring was seen in a screenshot. The no-WebGL fallback was
  loaded, and the console showed no errors. check-tokens and check-harvest
  pass.
- **Open, needs Robert:** his look at the zigzag. Once approved it ships to
  the footer, and the footer's focus ring moves to 4px out so it clears the
  teeth. That closes UX-1. Body 12px is adopted with UX-4.

**Record, 2026-10-10, third pass: Claude. UX-1 DONE.** Branch `ux-1-zigzag`.
- **Robert's corrections:** the zigzag at half the height; keyboard focus on
  it drawn as a bold zigzag instead of an outline, as a field thickens its
  line; and the zigzag only in the site's footer (sections, ALL, ABOUT,
  CONTACT), nowhere else.
- **Live in `index.html`:** a 3px zigzag with 90° vertices and a tooth every
  6px, 1px in the label's ink, under the chosen footer label. Keyboard focus
  on any footer label draws it at 2px, and the footer has no outline (the
  browser's own ring is switched off there too). Narrow phones follow the
  6px padding.
- **Specimen, draft 3:** the same, plus a footer row in "Every state".
- **Checks:** a local build in both themes and at 375px. With real Tab
  presses, a focused label measured bold, in ink, with no outline, and the
  screenshot shows the bold zigzag beside the thin one. CSS braces and script
  syntax pass.
- **Seen in passing, not caused by this work:** after one Tab press the icon
  row showed only a few icons, with blank space to their right. The live site
  does the same. It is recorded as a separate task.
- **Next:** UX-2. Body 12px still waits for UX-4.

**Review, 2026-10-10 — Codex.** Reviewed `STYLE-GUIDE.md`,
`tools/specimen.html`, and the shared-value checker at main `128d067`.
UX-1 establishes a usable visual baseline; proceed to the isolated UX-2
prototype. Robert's fixed grey, footer zigzag/focus treatment, and 12px site
body decision stand. This accepts the foundation, not a completed Harvest
workflow or the final site content layouts.

- **Evidence:** served the specimen locally and inspected its rendered
  comparisons and DOM at a 1280px browser viewport. Fonts reported loaded,
  document width matched the viewport, and the displayed secondary-text
  ratios were 4.60 on black / 4.56 on white. `node tools/check-tokens.js`
  passed (3 shared names and 2 mark sizes). This review did not repeat
  Claude's mobile or deployed-site regression tests.
- [x] **Claude, carry into UX-2: keep disabled labels readable.** The guide
  says disabled controls stay readable, but its state table and the specimen
  use `--rule` for disabled quiet buttons, toggles, and list rows. That is
  the decorative grey (2.29 on black / 1.68 on white). Use `--text-2` for
  their words and distinguish unavailability through control treatment and
  an explanation where needed. Align the guide and specimen before copying
  these styles into Harvest. This is an internal legibility requirement,
  not a claim that disabled controls fail a contrast conformance rule.
- [x] **Claude, carry into UX-2: distinguish state drawings from keyboard
  proof.** The specimen says every state cell is live, but its footer anchors
  have no `href` or explicit `tabindex`, several list examples are static,
  and the clickable project rows have no keyboard activation handler.
  Pressing Enter on the first project row did not select it. Label static
  examples honestly or make the representative controls keyboard-operable.
  Prove focus, activation, selection, and field errors in the isolated UX-2
  workflow; drawn `.is-focus` examples alone are not that proof. This finding
  concerns the specimen, not Claude's separately recorded site Tab test.
- **Scope of the passing checker:** it compares names present in both
  stylesheets and sets of their values, plus custom-mark sizes. It does not
  prove theme assignment, missing shared tokens, preview fidelity, or
  interaction behavior. Extend coverage as UX-2 adopts the new tokens and
  UX-5 establishes preview parity; retain visual checks in both themes.

### UX-2 — Reorganize Harvest around the selected project

**Finding:** Collect has five competing columns (Folders, Projects, Pending,
Accepted, Rejected). Organize's wrapping toolbar mixes project settings,
image operations, view controls and panel toggles. Editing already happens
in both modes, making the boundary hard to understand.

- [x] Prototype **Collect / Edit** as two working modes, with Edit replacing
      Organize's label. They are revisitable workspaces, not mandatory wizard
      steps. Keep the selected project and sidebar position stable across them.
- [x] Keep Projects at the left in BUILD / DESIGN / ART order (in the
      footer's order since 2026-10-10, when sections became content and Add
      section arrived). Keep project creation and Add section there; move
      working titles and less frequent settings into the selected project's
      settings.
- [x] Collect answers “Which material belongs in this project?” Put folders
      and websites in its Sources area. Present one review workspace with
      Pending / Kept / Rejected filters and counts, Pending by default; do not
      permanently give rejected material an equal column. Preserve source
      provenance, individual/batch decisions, and the existing review history.
- [x] Clarify actions: Keep makes material available to Edit; Reject remembers
      an unwanted match; Reset decision permits reconsideration. Put less
      frequent queue housekeeping in a secondary menu, explicitly stating
      whether it hides an item or forgets a decision. Rename existing states
      carefully; do not discard history or change recrawl behavior accidentally.
- [ ] Edit exposes **Content / Images / Layout**, with Project settings for
      grouping, working titles, and share/search information. Reuse existing
      fields and operations. Account for ABOUT, CONTACT and site settings as
      well, so “main editor” does not mean project editing only.
- [x] Use an image grid for overview and ordering; selection opens a stable
      details panel for caption, alt text, rotation, and alternate copies.
      Preserve list inspection, grouping/separation, moves, removed-item
      recovery, and comparison of copies without showing a large form per tile.
- [x] Apply this control placement consistently:

| Location | Scope |
|---|---|
| Application header | Collect/Edit, background activity, site-wide publishing review |
| Project header | Project name, saved state, Save project, Preview |
| Workspace toolbar | Search, grid/list, thumbnail size |
| Selection toolbar | Selection count, group/separate, move, remove |
| Details panel | Fields and actions for the selected object |

- [x] Show selection actions when applicable; keep their location stable.
      Put InDesign scanning beside source controls in Collect. Right-click
      menus accelerate visible actions rather than being their only entrance.
      Preserve keyboard operation and offer alternatives to drag-only actions.

**Done when:** a user can identify the selected project, current mode, affected
items, and next action without interpreting a tooltip or a wrapping button row.

**Record, 2026-10-10 — Claude.** Branch `ux-2-shell`. Scope: Harvest's page
(`tools/harvest/page.*`), two server messages, and the docs that name its
controls. No state, endpoint or recrawl behaviour changed.
- **What changed:** Collect / Edit in the application header, with Publish and
  the status line. The Projects list at the left in both modes, New project and
  Add section at its foot, and a note that ABOUT, CONTACT and the site's
  settings are edited in Keystatic. A project header with the name in both
  modes; in Edit, *Unsaved changes*, Preview and **Save project** (was Write to
  project — the same three writes). Collect is Sources (folders, websites,
  InDesign) beside ONE review list with Pending / Kept / Rejected and counts,
  a workspace toolbar (find, filters, order, **Clear and forget** menu that says
  for each item whether it hides or forgets) and a selection toolbar that is
  always there (Keep, Reject, Reset decision, Move to…). Edit is Content (title,
  detail lines, description, kept text), Images, Layout (layout, expand, icon,
  wordmark) and Settings (section, order, hold back, sub-project, client,
  working titles, share description). Images opens on a Grid with a details
  panel: click selects one work and shows its copies, alt text and caption;
  ⌘-click and Shift-click extend; List is kept as it was. Extract text and Show
  original are buttons there now, not right-click only. The style guide's
  editor values are live in Harvest: 13px Book, `--text-2` / `--edge` /
  `--rule`, three button kinds at 28px, tabs with a line, rows with a bar.
  Disabled controls keep readable words and turn dashed (guide and specimen
  aligned); the specimen says which state cells are drawings, and its project
  rows answer Return and Space.
- **Renamed on screen only:** Accept → Keep, Accepted → Kept, Undo → Reset
  decision, Organize → Edit, Write to project → Save project, As written → As
  saved. The server still stores `accepted`, `pending`, `rejected`, `written`.
- **Checks, on an isolated copy** (a scratch HOME, a worktree's content,
  fixture folders): crawl → keep seven pictures with the selection toolbar →
  Edit › Images groups them → Save stops at work 5 with its alt field marked
  (doubled ink line, square, sentence, focus in the field) → alt text typed,
  error gone → Save writes the two new works and nothing else (diff read) →
  keep a passage → place it in the description → *Unsaved changes* → switching
  project asks first and Cancel stays → Save → Preview shows the saved text.
  Keyboard with real keys: Return selects a project row, the focus ring is
  drawn; in the grid Return selects, Space adds, arrows move. Both themes, 1440
  and 1024 wide; at 1024 with Preview open the side panels give way instead of
  overlapping. Right-click menus on a card, a project and a work; Clear and
  forget; Reset decision in bulk; Move to…. `check-harvest` and `check-tokens`
  (now 6 shared names) pass. Test writes reverted.
- **Fixed in passing:** a card's right-click menu threw before it opened
  (`page` used before it was defined), so it had not worked at all.
- **Defaults I chose, for Robert to judge by using it:** Grid is Images'
  default (a new remembered key, so an old List preference does not hide the
  panel); a click on a work selects it alone, as Finder does, where it used to
  tick; Edit opens on Images and remembers its tab; Save and Preview show in
  Edit only, keeping his 2026-10-06 rule that Collect does not write.
- **Not done, and why:** ABOUT, CONTACT and the site's settings are listed,
  not editable — a real editor for them needs server endpoints and the build
  check, and is a task of its own. *Unsaved changes* covers the project's
  fields only; what is kept in Harvest but not yet saved to the file, and the
  publishing review, are UX-3's. At 1024 wide with Preview open the selection
  toolbar wraps to two lines.

### UX-3 — Make saving and publishing states unambiguous

**Finding:** review decisions persist, image edits live in Harvest's state,
project details can remain only on screen, and Write to project executes
several writes that can partially succeed. Publish applies across projects,
even while a different project is selected.

- [ ] Map the actual storage behavior before changing labels. Define visible
      states for unsaved edits, material kept in Harvest, saved local project
      files, and published content. Keep project visibility (held back) separate
      from whether edits are saved. Never describe every persisted state as
      “on the site.”
- [ ] Provide one clearly scoped Save project action and persistent status.
      Preserve unsaved work across mode/project changes or explicitly offer
      save/discard/cancel. Show which parts saved if a later step fails;
      preflight applicable validation before writes where practical. Do not
      imply the current multi-step write is one all-or-nothing operation.
- [ ] Surface missing requirements next to their fields and link a concise
      summary to the affected item. Keep NOISE's existing alt-text gate and
      hold unchanged; this task is not permission to fill or bypass it.
- [ ] Design a site-wide publishing review that names included projects and
      changes, distinguishing saved work from newer unsaved edits. Reconcile
      Harvest's direct-push implementation with the required pull-request flow.
      Distinguish submitted/merged, deploying, deployed, and failure; a push
      alone is not evidence that visitors see the new content.
- [ ] Keep publishing tests isolated while Harvest output is held. Provide
      actionable error recovery without losing local work or including unrelated
      edits. No real content publication is needed to complete this UX task.

**Done when:** switching projects, reopening the app, a validation failure, and
a failed publish all leave the user able to tell what was retained and where.

### UX-4 — Refine the site's content layouts

**Finding:** Standard puts the image left and text right, then expanded viewing
moves the image right. Thumbnails consume roughly a quarter of content height;
titles have little emphasis. Grid uses cropped 16:9 cells. Missing imagery can
still silently produce placeholders. Some sparse pages also lack authored copy,
which styling alone cannot fix.

- [ ] Prototype three understandable choices: **Project** (existing
      `standard`), **Collection** (`grid`), and **Text** (`text`). Keep existing
      stored values/URLs compatible; the contact form retains its own layout.
- [ ] Project: keep the main image in a stable region across overview and
      expanded viewing. Keep title, close, and return controls predictable;
      preserve local return versus global close and history behavior.
- [ ] Establish title → short project facts → description hierarchy. Try a
      bounded thumbnail strip instead of a fixed share of the content height,
      while preserving the established size caps and reading measure. Body
      text is decided at 12px (Robert, 2026-10-10; `STYLE-GUIDE.md`, Type).
- [ ] Separate client identification from project imagery: a wordmark should
      not automatically displace the main photograph. If this needs a new
      authoring choice, carry it through the schema, editors, build, and site.
- [ ] Collection: brief introduction plus image grid. Offer deliberate whole
      image versus crop behavior; respect portrait drawings and other aspect
      ratios. Keep text expansion local and restore the reader's position on
      return. Text layout retains a readable column and clear hierarchy.
- [ ] Handle missing descriptions/images deliberately, without inventing copy
      or substituting fake artwork. Coordinate the existing placeholder-removal
      task in Phase 7 / `PUNCH-LIST.md` §1; verify usages before removal.

**Done when:** real sparse, long-copy, portrait-image, and many-image projects
work in desktop and phone views. Larger screens gain space without unbounded
images or lines; the settled navigation remains intact.

### UX-5 — Connect composition to an accurate preview

**Finding:** As written previews saved files, not all unsaved edits. The separate
description preview uses 13px type against the site's 11px and loads fewer font
styles. The editor can therefore show a different composition from the result.

- [ ] Show formatted description editing directly, keeping the current Markdoc
      vocabulary and Keystatic compatibility. Select an editor approach on its
      merits; editor dependencies must not reach the public site. Preserve all
      supported marks, lists, links, quotes, and dividers through save/reopen.
- [ ] Use the actual site rendering for page preview and distinguish **Editing
      preview**, **Saved preview**, and **Live**. An editing preview must include
      pending edits without silently saving them into the project or publishing.
      Until it exists, label the saved preview accurately.
- [ ] Provide a large preview mode plus optional side-by-side viewing, desktop
      and phone sizes, and layout choices with useful visual examples. Changing
      the editor's pane width must not masquerade as a chosen device size.
- [ ] Make selecting content and seeing its result a short round trip. Match
      fonts, formatting, image order, crop behavior, and layout with the site;
      remove competing approximate previews or identify their limited purpose.
- [ ] Preserve the preview's separate origin and prevent editing previews from
      overwriting `dist/` used by another process. Check responsiveness during
      edits and project switches; do not rebuild expensively per keystroke.

**Done when:** save/reopen produces the composition shown in the editing preview,
and the interface never confuses pending edits, saved files, and the live site.

### UX-6 — Sequence and acceptance journey

Implement in focused steps: **UX-1 guide → UX-2 shell with UX-3 state model →
UX-4 site layouts → UX-5 connected editing/preview → complete journey checks.**
Resolve save semantics while restructuring the editor, not after polishing it.

Before extending the prototype across the editor, record the sample/design
review, save/reopen and preview evidence, and difficult-case results here or
in the linked test record. Claude supplies concrete options with recommended
defaults; Codex reviews consistency and gaps; Robert judges material visual
choices. Remaining unknowns stay explicit rather than being called complete.

- [ ] First prototype: one complete **BUS STOP** session on isolated content
      and state. Find material → keep it → edit text → order/select images →
      choose layout → preview → save → reopen → compare the saved result.
      Preserve source files and prior decisions. Test publishing failures without
      releasing Robert's held content.
- [ ] Add long text (LIGHT WORK), a portrait work, a many-image collection,
      sparse content, and a held-back project. Use isolated fixtures where real
      content is incomplete; do not edit NOISE to manufacture a passing test.
- [ ] Check both themes, keyboard focus and operation, readable labels and
      validation, selected/batch states, empty/loading/error states, narrow
      desktop windows, and phone previews. Measure long-session tasks such as
      repeated project switches and image reordering, including responsiveness.
- [ ] Run applicable `STRESS-TESTS.md` checks for routing/history, image return,
      contact behavior, resize, keyboard/VoiceOver, and no-WebGL fallback.
      Extend that test record with these journeys rather than maintaining a
      second test log. Follow the Harvest skill for isolated tests and PID cleanup.
- [ ] Update the guide and relevant operating instructions with final behavior;
      record completed task IDs and evidence here. Reconcile overlapping launch
      checklist items only when their actual acceptance checks pass.

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

**Update, 2026-10-10:** the shared instructions record an enforced
pull-request ruleset on `main`; this is no longer optional setup. UX-3 must
make Harvest's publishing flow agree with it. Keystatic's response to a
blocked save still needs verification; use a branch in the editor.

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
      `<h1>`. The real `<title>` is already generated by `build.js` from
      `content/site.json` (verified 2026-10-10); do not redo that part.
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
      class of bug placeholder copy hides. Implement alongside UX-4/6;
      record the shared launch result in `PUNCH-LIST.md` §1.
- [ ] Delete the placeholder generators once dependencies on them are gone
      — shared with UX-4's deliberate empty-content handling, not a second pass.
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

Separate follow-on work from CURRENT — Shared UX plan. The editor/layout
redesign can proceed without resolving media hosting. When these players are
implemented, use UX-1's control rules and UX-2/4/5's editing and preview model.

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

**Updated 2026-10-10:** CURRENT — Shared UX plan now sequences the portfolio
and Harvest design work, with Codex on strategy and Claude on implementation.
The infrastructure decisions below remain separate and held as recorded.

- `PUNCH-LIST.md` is the gate before the domain moves. Section 1 (content)
  is the long pole.
- **NEXT — Video and audio players**, above: waiting on Robert's go for a
  second domain to serve the R2 bucket.
- **HANDOFF — Netlify build cost**, above: splitting into two Netlify sites,
  waiting on his go.
- Harvest: growing to cover every project field; its output stays held
  until he says so (`AGENTS.md`, standing holds).
