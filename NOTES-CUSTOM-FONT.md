# Design note — custom typeface

**Branch:** `custom-font` · **Status:** implemented, needs looking at on a
real preview

PP Neue Montreal, three static cuts, served as files from `/fonts/`.

---

## The decision

Move off `font-family: monospace` to PP Neue Montreal, **served as files
rather than inlined as base64.**

That reverses the one-request rule deliberately. Three cuts are ~90 KB, and
base64 inflates a binary by about a third, so inlining would have put ~120 KB
inside the HTML document — which must arrive in full before anything paints.
This site is built the other way round: a black shell paints immediately and
`boot()` runs after. Inlining would have undone the one behaviour the boot
sequence exists to protect. Three extra requests, loaded in parallel, off the
critical path, cached across visits, is the better trade. Raised and accepted
rather than assumed.

Accepted consequence, stated once so nobody rediscovers it as a bug: **the
reading measure stops being exact.** In monospace, `66ch` was literally 66
characters. In a proportional face there is no unit that guarantees a character
count, so `33em` is an informed estimate of the same thing. That is the price
of the typeface, and it was paid knowingly.

---

## What the files actually are

Read out of the file headers, not from the filenames:

| File | Size | Glyphs |
|---|---|---|
| PPNeueMontreal-Book.woff2 | 29.0 KB | 613 |
| PPNeueMontreal-Bold.woff2 | 30.4 KB | 613 |
| PPNeueMontreal-Italic.woff2 | 29.3 KB | 613 |
| *BoldItalic — not shipped* | 31.5 KB | 613 |
| *Light — not shipped* | 29.1 KB | 613 |

**These are NOT variable fonts.** No `fvar`, no `gvar`, no `STAT` in any of
the five — they are static instances. PP Neue Montreal does ship a variable
version; this is not it. Consequences:

- `font-variation-settings` has nothing to act on. Width and slant axes do
  not exist here.
- Only the weights present in the files are real: **400 and 700**. Asking for
  300 or 500 gets a synthesised weight, which is a smeared fake, not a cut.
- Adding a weight later means adding a file, not changing a number.

613 glyphs is a full Latin set, already close to minimal. Subsetting further
would save little and risks dropping something the copy uses, so it was not
done.

---

## Coverage gap — `▌` is not in this typeface

Checked against the real `cmap` tables. Two characters currently in use are
absent from all five files:

- **`▌` (U+258C)** — used as the artist-list marker in the Light Work copy.
  It will render from the fallback stack, in a different face, at a different
  weight. Visible, and visibly wrong.
- **`✦` (U+2726)** — the Light Work glyph icon. **Not affected**: `bakeIcon`
  draws glyph icons to canvas in its own hard-coded monospace stack,
  independent of the page font. Unchanged behaviour, and due to be replaced by
  an uploaded logomark anyway.

`▌` needs a decision: keep it and accept a fallback glyph, or swap it for
something the typeface has.

---

## Licensing

Confirmed permitted for web embedding. Serving as files rather than inlining
also keeps this an ordinary webfont deployment rather than pasting the whole
binary into the page source.

---

## Done

- [x] Licence confirmed
- [x] Three cuts into `fonts/`, `@font-face` with `font-display: swap`
- [x] `font-family` set with a system fallback stack behind it
- [x] `build.js` copies `fonts/` to `dist/fonts/`, and FAILS if it is missing
- [x] `--measure` 66ch → 33em, `--measure-form` 96ch → 48em

## Still to check — needs eyes on a preview, cannot be verified from the build

- [ ] **Tune `--measure`.** 33em is arithmetic, not observation. Set real copy
      at that width, count characters on a full line, adjust if outside 55-70.
- [ ] **The vertical copyright.** `line-height: 1` is load-bearing there — in
      vertical text the line box becomes the WIDTH. A proportional face has
      different metrics and may overhang or under-fill the margin strip.
- [ ] **Footer labels on a narrow phone.** BUILD / DESIGN / ART / CONTACT /
      ABOUT were laid out in monospace. Proportional letterforms change their
      combined width, and the footer is primary navigation.
- [ ] **The no-WebGL fallback.** The seam follows the menu by measuring a
      wrapped title list; that measurement now happens in a different face.
      Test with `?nogl`.
- [ ] **`▌` in the Light Work copy** — decide keep or replace.
- [ ] Letter-spacing. Values were tuned against monospace and may want
      revisiting; not changed here, since that is design judgement.

---

## Status log

Append. Newest at the bottom.

- **Set up.** `--measure` 66ch → 33em and `--measure-form` 96ch → 48em, with
  the reasoning written into the CSS comments where the old exactness claim
  was. No font added yet.
- **Typeface in.** Five WOFF2 files supplied; inspected and found to be static
  instances, not variable as expected. Three shipped (Book / Bold / Italic),
  BoldItalic and Light held back. Served from `/fonts/` with `font-display:
  swap`; `build.js` copies the directory and fails if it is absent. `▌` found
  absent from the typeface and left for a decision. Nothing here has been seen
  rendered — the checks above need a preview.
