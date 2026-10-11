# Style guide — the site and Harvest

One visual identity, used two ways: the **site** is for reading and looking,
and **Harvest** is for working. This file says what each piece of the style is
for and where it goes. **`tools/specimen.html`** shows every piece at actual
size, in both themes, today's version next to the proposed one. Open it
served, not as a file (see the comment at its top).

**Status, 2026-10-10: UX-1 done (third draft); UX-2 adopted the editor
values in Harvest.** Robert answered the five questions and corrected the
zigzag; his decisions are at the end of this file. **DECIDED** marks a value
he has chosen, and **LIVE** a value that is already in the site or in
Harvest. **PROPOSED** marks a value that still waits for the task that adopts
it: UX-4 for the window's text.
Where this file and the code disagree, the code describes what is live and
this file describes where it is going.

Words used below:

- **Token**: a named value, such as `--ink`, that the CSS uses everywhere
  instead of repeating the colour or size itself. Change the token and
  everything that uses it changes.
- **Contrast ratio**: how far apart two colours are in lightness, from 1:1
  (identical) to 21:1 (black on white). The accessibility standard (WCAG 2.2)
  asks for 4.5:1 for readable text and 3:1 for a line or shape that shows
  where a control is. Decoration needs no minimum.
- **Keyboard focus**: the control that a key press will act on. Someone using
  Tab to move around needs to see where it is.
- **Hit area**: the box that responds to a click or tap. It is often larger
  than the visible word.

---

## What stays fixed

These are the identity. Both the site and Harvest keep them.

- **PP Neue Montreal** is the only typeface, with three real weights: Light 300,
  Book 400 and Bold 700. Any other weight is a smeared fake (`NOTES-CUSTOM-FONT.md`).
- **Monochrome.** Black and white swap with the device's light or dark
  setting, plus a few greys. There is no hue anywhere, including for errors.
- **Fine rules.** Lines are 1px. A 2px line means something specific:
  selection, keyboard focus on a field, or an error.
- **Left-aligned reading.** Every column of text starts at a left margin. The
  footer strip on a phone is the one exception (`AGENTS.md`, Layout).
- **The taskbar rule.** Each element has a fixed size, and only the number of
  them adapts to the screen. A bigger screen gets more space, not bigger things.
- **Ink is active; grey is present.** Whatever is chosen or in use is drawn in
  ink, and everything that is merely available is grey. On the site,
  **controls never churn**.
- **Motion only when it means something.** Colour changes take 150 ms. In
  Harvest, nothing moves to show a state. `prefers-reduced-motion` stops the
  little motion there is.

---

## Colour

| Token | Dark | Light | Use | Contrast (dark / light) |
|---|---|---|---|---|
| `--bg` | `#000` | `#fff` | background | — |
| `--ink` | `#fff` | `#000` | text, anything active or chosen | 21:1 |
| `--text-2` **LIVE** | `rgb(117,117,126)` | same | readable secondary text: labels, details, captions, resting controls, the footer, the copyright | 4.60 / 4.56 |
| `--edge` **LIVE** | `rgb(143,143,153)` | same | lines that show where a control is: field underlines, button outlines. Never text | 6.56 / 3.20 |
| `--rule` **LIVE** | `rgba(143,143,153,.5)` | same | decoration only: the seam, dividers, hairlines between list items | 2.29 / 1.68 |
| `--accent-rgb` | `143,143,153` | same | the one place that grey's number is written: `--edge` is it at full strength, `--rule` at half, and the icon row's shader draws it at 0.9. No text uses it | — |

**Why the grey changed.** Until 2026-10-10 one grey, `--accent`, was used for
every secondary word. It was chosen to "sit legibly on both fields", but measured it
does so only on black: 5.42:1 on black and **2.78:1 on white**. Labels drawn in
`--accent-dim`, which includes the whole footer row and the copyright, measure
2.29:1 on black and **1.68:1 on white**. Lines and decoration never needed
4.5:1, but words did, so words now have a grey of their own (`--text-2`).

**One fixed grey: Robert's choice, 2026-10-10.** `rgb(117,117,126)` is the
only grey that clears 4.5:1 on both black and white, at 4.60 and 4.56, so the
single-grey rule survives. Rejected alternative: a grey per theme at ~5.5:1
each. It has more margin above the minimum, but it means two values to keep
in step, and a theme swap for a colour that is meant to be neither.

**What does not change.** `--edge` is today's grey at full strength. It
already clears 3:1 on both backgrounds, so field lines and outlines keep the
one fixed grey. `--rule` is today's `--accent-dim`, unchanged. The icon row's
out-of-band grey is a shader uniform drawing pictures, not text, and the
navigation is settled, so it stays too.

**Errors are not red.** An error is shown by a doubled line, a small solid
square, and words in ink. The square and the line weight carry it for anyone
who cannot see the difference in tone.

---

## Type

| Role | Site | Harvest |
|---|---|---|
| Body text | **DECIDED** 12px Book, line height 1.7, tracking .02em (adopted with UX-4). Today: 11px, 1.9, .05em | **LIVE** 13px Book, 1.5, .01em. Was 11px **Light**, 1.7, .05em |
| Title | **PROPOSED** body size, uppercase as written, tracking .08em, in ink. Today: 11px in grey | **LIVE** project name 16px, tracking .06em |
| Details and facts | **PROPOSED** 11px `--text-2`, line height 1.5 | — |
| Caption, help and meta text | **PROPOSED** 11px `--text-2` | **LIVE** 12px `--text-2` |
| Region labels | — | **LIVE** 11px uppercase, tracking .12em, `--text-2` |
| Footer labels | 11px uppercase, tracking .15em. Settled. **LIVE**: `--text-2`. The chosen one carries the zigzag (below) | — |
| Glyph controls (×, ←, the caret) | 13px. Settled | — |

The rules behind the table:

- **Book is the default everywhere.** **Light** is used only where Robert asks
  for it in a description (the Lighter mark). Harvest's body text is Light
  today, and that is a large part of why it reads faint. **Bold** is used only
  for emphasis written into the content.
- **Uppercase is a role, not a voice.** It is used for titles written in
  uppercase, the site's footer labels, and Harvest's region labels. It is
  **not** used for buttons. Until UX-2 every Harvest button was an uppercase
  grey word, so navigation, actions and toggles all looked alike.
- **Tracking follows size and case.** Uppercase needs .08–.15em. Mixed case
  needs .02em at 12px and .01em at 13px. The .05em everywhere today was compensation for
  11px type.
- **The measure** (`--measure: 33em`) is in em, so it grows with the body
  size: 396px at 12px. After adopting the new size, count the characters on a
  full line again, as `AGENTS.md` says. Never re-tune it by arithmetic.
- **Descriptions are previewed in the site's own numbers.** Harvest's
  description preview is set at 13px against the site's 11px today. UX-5 fixes
  that by reading the same tokens (below).

---

## Spacing

Five steps, and nothing in between: **4 · 8 · 12 · 20 · 32**.

| Step | Use |
|---|---|
| 4 | inside a control (a mark and its words); a field and its help line |
| 8 | between controls that belong together |
| 12 | inside a button; between groups in a toolbar; between fields |
| 20 | around a region; between a title and what follows it |
| 32 | between regions and between sections |

## Hit areas

- **Harvest:** every control is at least **28px** tall. A word alone is not a
  button. **LIVE** since UX-2; before it, Harvest's buttons had no padding and
  their hit area was the height of the text.
- **Site:** the hit areas stay as they are. The footer labels' are about 25px,
  which already clears the 24px minimum in WCAG 2.2, and that geometry is
  settled.

---

## Controls

Harvest uses three kinds of button for three kinds of job, plus two kinds of
selection.

| Kind | Looks like | Use for |
|---|---|---|
| **Primary** | filled ink, background-colour text | the one action a region exists for: **Save project**, **Publish**. At most one per region |
| **Secondary** | 1px `--edge` outline, ink text | every other action: Preview, Move to…, Turn left |
| **Quiet** | `--text-2` text, no outline | frequent or minor actions that should not compete: Clear selection, Remove, Stop, Show details |
| **Tab or toggle** | `--text-2`; chosen = ink **plus the zigzag under it** (below) | a choice between views: Collect / Edit, Grid / List, S M L |
| **List row** | `--text-2`; chosen = ink **plus a 2px bar at its left** | the projects list, the folder tree |
| **Tile** | chosen = ticked box **plus a 1px ink frame** | works in the grid |

**Labels are verbs, in sentence case**, and they say what will happen ("Save
project", not "WRITE TO PROJECT"). A label ends in "…" when the action asks a
question before it does anything ("Move to…", "Review and publish…").

**The site's controls keep their form**: ×, ←, the caret, the footer labels,
the sibling row and SEND. Only their grey and their focus mark change.

## States

| | Rest | Hover | Keyboard focus | Chosen | Disabled |
|---|---|---|---|---|---|
| Primary | filled ink | 80% strength | 1px ink outline, 2px out | — | dashed `--edge` outline, `--text-2` text |
| Secondary | `--edge` outline | ink outline | 1px ink outline, 2px out | — | dashed `--rule` outline, `--text-2` text |
| Quiet | `--text-2` | ink | 1px ink outline, 2px out | — | `--text-2` text, dashed `--rule` underline |
| Tab or toggle (Harvest) | `--text-2` | ink | ink + **bold zigzag**, no outline | ink + zigzag | `--text-2` text, dashed `--rule` underline |
| List row | `--text-2` | ink | 1px ink outline, inside | ink + bar at left | `--text-2` text, dashed `--rule` underline |
| Field | `--edge` line | ink line | the line doubled, in ink | — | dashed `--rule` line |
| Footer label (site) | `--text-2` | ink | ink + **bold zigzag**, no outline | ink + zigzag | — |

The rules behind the table:

- **Hover changes tone. Only keyboard focus draws an outline**, so the two are
  never confused. Focus appears for keyboard use only (`:focus-visible`), never
  on a click. **LIVE** on the site since 2026-10-10: ×, ←, the caret, SEND,
  the field mark, the sibling row, links, and the icon row's keys. Before that,
  focus on most of them was the same colour change as hover, and the keys'
  ring was the grey that measured 2.78:1 on white.
- **A control that already carries a line thickens that line for focus**
  instead of adding an outline, which would double the mark. A field doubles
  its underline, and a footer label or a Harvest tab draws its zigzag in bold.
- **A chosen item carries a mark as well as a tone**: a line, a bar, a frame
  and a tick, or, under the site's footer labels and Harvest's tabs, the
  zigzag. In Harvest, tone alone is never the only signal.
- **Disabled stays readable; DASHED says unavailable.** You should be able to
  read what a button would do once it becomes available, so its words stay
  `--text-2` (4.6:1), never the decorative `--rule` (1.68:1 on white), which
  the first draft of this table used (Codex's UX-1 review). What changes is
  the control's line: its outline or underline turns dashed, the same mark a
  disabled field already carried, and hover no longer changes it. Where the
  reason is not obvious, the control's tooltip or the place it lives says it.

## The chosen footer label and Harvest tab: the zigzag

**LIVE, 2026-10-10.** Robert drew it; the third draft has his corrections.

- **Where:** under the chosen label in the site's footer: ALL, the section
  labels, and ABOUT or CONTACT while open; and under the chosen tab in
  Harvest (Collect / Edit, Content / Images / Layout / Settings, Pending /
  Kept / Rejected, Grid / List, S M L, Preview's sources), which had a
  straight line until Robert asked for the matching zigzag (2026-10-10).
  **Nowhere else**: not on the site's other controls. In Harvest it keeps
  the same 3px and 6px tooth at 13px as at the footer's 11px — whole pixels,
  so the stroke stays sharp — and the same images, copied into `page.css`
  under the same names for `check-tokens.js` to compare.
  Where the sections are in the wheel (on phones once there are more than
  three), the wheel's lit centre slot marks the chosen section and the
  zigzag stays with ABOUT and CONTACT.
- **Shape:** a zigzag with right-angled (90°) vertices, so every stroke runs
  at 45°.
- **Height:** half the x-height. PP Neue Montreal's x-height measures 0.51em,
  which is 5.6px at the footer's 11px, so the zigzag is **3px** from the centre
  of a low vertex to the centre of a high one. With 45° strokes, each tooth
  is 6px wide. (The second draft was the full x-height, 6px; Robert halved it.)
- **Stroke:** 1px, in the label's own colour, so it follows the theme. It is
  drawn as a CSS mask over `currentColor` at fixed pixel sizes, so the stroke
  is never scaled to a fraction of a pixel.
- **Keyboard focus:** the same zigzag at **2px**, and no outline. This is the
  field's rule: focus thickens the mark the control already has. Any footer
  label under keyboard focus gets it, chosen or not, so thin means chosen and
  bold means the keyboard is there.
- **Extent:** it starts on a low vertex under the word's first letter and
  stops under its last. The tracking after the last letter is not part of the
  word.
- **Placement:** along the bottom of the label's own tap area, about 3.5px
  under the baseline. Nothing moves, and the tap target is unchanged.

## Fields and errors

- The label goes above the field, in 12px `--text-2`. Help text goes below it,
  in 12px `--text-2`.
- The underline is 1px `--edge` at rest and ink on hover. On focus it doubles
  to 2px, drawn as a shadow so nothing below it moves.
- **A required field says so in its label** ("Alt text — required"), not with
  an asterisk.
- **An error** doubles the line in ink. Under the field goes a small solid
  square and a sentence in ink that says what to do, not what went wrong: "Add
  an icon. A project can't go on the site without one." It appears beside the
  field it belongs to. The summary at the point of saving, which links to each
  error, is UX-3's.

## Empty places, work in progress, messages

- **Empty:** say what belongs here and how it gets here, then offer one action.
  Left-aligned, like everything else.
- **Work in progress:** a 1px line along the top of the region the work
  affects, moving if the length is unknown and filling if it is known. Beside
  it, a status line names the work and a count ("Reading Bus Stop · 128 files
  so far"), with **Stop** if it can be stopped. Never a spinner.
- **Results:** past tense, saying what changed and where it is now: "Saved on
  this Mac. Not on the site until you publish."
- **Failures:** a 1px ink rule at the left, then three things: what didn't
  happen, what was kept ("Nothing was lost: …"), and what to do (Try again,
  Show details).

---

## Placement

**The site:** settled. The icon row and footer are at the bottom, the window
above, and every text column starts at the left margin (`AGENTS.md`, Layout).
UX-4 works inside the window only.

**Harvest:** each kind of control has one home. This is the plan's table;
**LIVE** since UX-2:

| Location | Holds |
|---|---|
| Application header | Collect / Edit, background activity, the site-wide publishing review |
| Project header | project name, saved state, Save project, Preview |
| Workspace toolbar | search, Grid / List, thumbnail size |
| Selection toolbar | how many are selected; group / separate, move, remove |
| Details panel | the fields and actions for the one selected thing |

- Selection actions live in a toolbar that is **always there, in the same
  place**, and wait, readable and dashed, until something is selected.
- **Save project and Preview are Edit's**: Collect finds and sorts and does
  not write (Robert, 2026-10-06), so the project header shows them in Edit
  only. The project's name is in the same place in both modes.
- A right-click menu repeats actions that are visible somewhere. It is never
  the only way to reach one.

---

## Where the values live

**`index.html` is the source.** It is the file that ships, so its values cost
the visitor nothing extra to download.

- Harvest's `tools/harvest/page.css` repeats the tokens it needs in its
  `:root`, **under the same names**. Keystatic's custom marks repeat the two
  sizes (Smaller .85em, Larger 1.27em).
- **`node tools/check-tokens.js`** fails when a name declared in both files
  has different values, or when a mark size differs. `tools/check-harvest.js`
  runs it too. Since UX-2 it covers six shared tokens (`--bg`, `--ink`,
  `--accent-rgb`, `--text-2`, `--edge`, `--rule`) and both mark sizes;
  Harvest's old `--accent` and `--accent-dim` are gone.
- When values are adopted, the type sizes become tokens as well (body size,
  line height, tracking). Harvest's description preview then reads the same
  numbers the site does, and the check covers them without being changed.

Rejected ways of sharing values:

- **A shared `tokens.css` linked by both:** a second request on the site.
- **build.js writing the values into `index.html`:** the source template would
  stop showing its own values, and the build gains a step that rewrites CSS.
- **Harvest reading `index.html` when it starts:** it would have to pick theme
  rules out of a 5,000-line file to save copying five lines.

Copying is cheap, and the check is what keeps the copies honest.

---

## Decisions — Robert, 2026-10-10

1. **The secondary grey: one fixed grey**, `rgb(117,117,126)`, 4.60:1 on
   black and 4.56:1 on white. **Live.**
2. **The footer and the copyright use the readable grey: yes.** **Live.**
3. **The chosen footer label: a zigzag**, not a straight line, with 90°
   vertices. Corrected after the second draft: half the x-height (3px),
   bold for keyboard focus in place of an outline, and in the footer only.
   **Live.** Extended to Harvest's tabs the same day, at his request, with
   the same bold focus.
4. **The site's body text: 12px.** It is adopted with **UX-4**, because the
   body size moves the window's layout and UX-4 rebuilds that anyway.
5. **A keyboard focus outline on the site's controls: yes**, except the
   footer labels, whose focus is the bold zigzag. **Live.**

Harvest took the editor values with **UX-2**, which rebuilt its shell
anyway, so nothing was restyled twice.
