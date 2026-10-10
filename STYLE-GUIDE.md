# Style guide — the site and Harvest

One visual identity, used two ways: the **site** is for reading and looking,
and **Harvest** is for working. This file says what each piece of the style is
for and where it goes. **`tools/specimen.html`** shows every piece at actual
size, in both themes, today's version next to the proposed one. Open it
served, not as a file (see the comment at its top).

**Status, 2026-10-10 (UX-1):** a proposal. Anything marked **PROPOSED** is not
in the site or in Harvest yet. It is adopted only after Robert has looked at
the specimen and answered the questions at the end of this file. Where this
file and the code disagree, the code describes what is live and this file
describes where it is going.

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
| `--text-2` **PROPOSED** | `rgb(129,129,138)` | `rgb(104,104,113)` | readable secondary text: labels, details, captions, resting controls, the footer | 5.44 / 5.52 |
| `--edge` **PROPOSED** | `rgb(143,143,153)` | same | lines that show where a control is: field underlines, button outlines. Never text | 6.56 / 3.20 |
| `--rule` | `rgba(143,143,153,.5)` | same | decoration only: the seam, dividers, hairlines between list items | 2.29 / 1.68 |

**Why change the grey.** Today one grey, `--accent`, is used for every
secondary word. It was chosen to "sit legibly on both fields", but measured it
does so only on black: 5.42:1 on black and **2.78:1 on white**. Labels drawn in
`--accent-dim`, which includes the whole footer row and the copyright, measure
2.29:1 on black and **1.68:1 on white**. The rule failed at its own purpose,
so the proposal keeps the purpose and gives up the rule. Each theme gets its
own readable grey (`--text-2`), picked so both themes land at the same
~5.5:1.

**Option B, shown in the specimen ("One fixed grey").** `rgb(117,117,126)` is
the only grey that clears 4.5:1 on both black and white, at 4.60 and 4.56. It
keeps the one-grey rule, but it sits right at the minimum in both themes, with
no margin for 11–12px type. That is why it is the alternative and not the
recommendation.

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
| Body text | **PROPOSED** 14px Book, line height 1.6, tracking .01em. Today: 11px, 1.9, .05em | 13px Book, 1.5, .01em. Today: 11px **Light**, 1.7, .05em |
| Title | **PROPOSED** body size, uppercase as written, tracking .08em, in ink. Today: 11px in grey | Project name 16px, tracking .06em |
| Details and facts | **PROPOSED** 2px under the body (12px), `--text-2`, line height 1.5 | — |
| Caption, help and meta text | **PROPOSED** 12px `--text-2` | 12px `--text-2` |
| Region labels | — | 11px uppercase, tracking .12em, `--text-2` |
| Footer labels | 11px uppercase, tracking .15em. Settled; only the grey changes | — |
| Glyph controls (×, ←, the caret) | 13px. Settled | — |

The rules behind the table:

- **Book is the default everywhere.** **Light** is used only where Robert asks
  for it in a description (the Lighter mark). Harvest's body text is Light
  today, and that is a large part of why it reads faint. **Bold** is used only
  for emphasis written into the content.
- **Uppercase is a role, not a voice.** It is used for titles written in
  uppercase, the site's footer labels, and Harvest's region labels. It is
  **not** used for buttons. Today every Harvest button is an uppercase grey
  word, so navigation, actions and toggles all look alike.
- **Tracking follows size and case.** Uppercase needs .08–.15em. Mixed case at
  13–14px needs only .01em. The .05em everywhere today was compensation for
  11px type.
- **The measure** (`--measure: 33em`) is in em, so it grows with the body
  size: 462px at 14px. After adopting a new size, count the characters on a
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
  button: today Harvest's buttons have no padding, and their hit area is the
  height of the text.
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
| **Tab or toggle** | `--text-2`; chosen = ink **plus a 1px line under it** | a choice between views: Collect / Edit, Grid / List, S M L |
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
| Primary | filled ink | 80% strength | 1px ink outline, 2px out | — | outline only, `--text-2` text |
| Secondary | `--edge` outline | ink outline | 1px ink outline, 2px out | — | `--rule` outline, `--text-2` text |
| Quiet | `--text-2` | ink | 1px ink outline, 2px out | — | `--rule` text |
| Tab or toggle | `--text-2` | ink | 1px ink outline, 2px out | ink + line under | `--rule` text |
| List row | `--text-2` | ink | 1px ink outline, inside | ink + bar at left | `--rule` text |
| Field | `--edge` line | ink line | the line doubled, in ink | — | dashed `--rule` line |

The rules behind the table:

- **Hover changes tone. Only keyboard focus draws an outline**, so the two are
  never confused. Focus appears for keyboard use only (`:focus-visible`), never
  on a click. On the site today, focus on ×, ←, the caret, SEND and the footer
  is the same colour change as hover. The PROPOSED change gives them the same
  outline.
- **A chosen item carries a mark as well as a tone**: a line, a bar, or a frame
  and a tick. In Harvest, tone alone is never the only signal.
- **Disabled stays readable.** You should be able to read what a button would
  do once it becomes available.

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

**Harvest:** each kind of control has one home. This is the plan's table, and
UX-2 builds it:

| Location | Holds |
|---|---|
| Application header | Collect / Edit, background activity, the site-wide publishing review |
| Project header | project name, saved state, Save project, Preview |
| Workspace toolbar | search, Grid / List, thumbnail size |
| Selection toolbar | how many are selected; group / separate, move, remove |
| Details panel | the fields and actions for the one selected thing |

- Selection actions appear when something is selected, **always in the same
  place**.
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
  runs it too. Today it covers five shared tokens (`--bg`, `--ink`,
  `--accent-rgb`, `--accent`, `--accent-dim`) and both mark sizes.
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

## Adopting — questions for Robert

Each question has a recommendation. Look at the specimen first. Nothing below
ships until you answer.

1. **The secondary grey.** Recommended: **one per theme**, the same ~5.5:1 in
   each. The alternative keeps a single grey at about 4.6:1 in both. Either
   way, `AGENTS.md`'s single-grey rule gets rewritten to match.
2. **The footer and the copyright move to the readable grey.** Recommended:
   **yes**. They are the most-read secondary words on the site, and they
   measure 1.68:1 on white today. Their size and spacing don't change.
3. **A line under the chosen footer section.** Recommended: **no**. Ink
   against the new grey is already a 3.8:1 difference, which shows without
   colour vision, and the icon row's band marks the section a second time. A
   third mark would be furniture. In Harvest, a chosen item always carries a
   mark.
4. **The site's body size.** Recommended: **14px**, to judge on the phone
   first. The specimen's size buttons show 11–14. Titles, details and captions
   follow the body size, and the measure grows with it.
5. **A focus outline on the site's controls** (×, ←, the caret, SEND, the
   footer). Recommended: **yes**. Mouse and touch users never see it.

Once answered, the work goes in this order:

- Questions 1, 2 and 5 are a few lines in `index.html` and can ship on their
  own.
- Question 4 goes with **UX-4**, because a bigger body changes the window's
  layout.
- Harvest takes the editor values with **UX-2**, which rebuilds its shell
  anyway, so nothing is restyled twice.
