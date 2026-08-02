# Design note — custom typeface

**Branch:** `custom-font` · **Status:** measure converted; waiting on the font file

**Do not merge before the font file lands.** The measure change on this branch
is correct *for a proportional face* and wrong for the monospace stack that is
live today. Merged early, it makes the current site's text column too narrow.
The two changes ship together or not at all.

---

## The decision

Move off `font-family: monospace` to a chosen proportional typeface, inlined
so the site stays one file and one request.

Accepted consequence, stated once so nobody rediscovers it as a bug: **the
reading measure stops being exact.** In monospace, `66ch` was literally 66
characters. In a proportional face there is no unit that guarantees a character
count, so `33em` is an informed estimate of the same thing. That is the price
of the typeface, and it was paid knowingly.

---

## What is needed from the font

- **WOFF2.** Roughly 30% smaller than WOFF and half the size of a raw TTF/OTF,
  and universally supported by anything that can run WebGL2. No second format
  is worth carrying as a fallback.
- **One weight, regular.** The site declares no `font-weight` or `font-style`
  anywhere — every piece of text is one weight today. A second file is only
  needed if the markdown-formatting work lands and wants real bold or italic.
- **A static instance, not a variable font,** unless the variable file happens
  to be smaller. A variable font carries every weight on an axis; the site
  uses one.

If only OTF/TTF exists, it converts to WOFF2 — but conversion is a decision
about licensing as much as format. See below.

---

## Licensing — check this before anything is committed

Inlining a font as base64 puts the **complete font file in the page source, in
plain text, for anyone to copy.** No obfuscation, no referrer check, nothing.

Many commercial and desktop licences forbid exactly this, and many webfont
licences are separate from desktop licences and are metered by pageviews.
A typeface that is legitimately owned for print or for a design application is
often *not* licensed for web embedding.

**Confirm the licence permits web embedding before the file goes into the
repository.** Open-licence families (SIL OFL and similar) are unrestricted here
and are the safe default if the preferred face turns out not to be usable.

---

## Size — the real tradeoff

The site is ~37 KB gzipped today, one request. Base64 inflates a binary by
about a third before compression, and font data is already compressed so gzip
recovers little of it.

A Latin subset of a typical text face runs 15-30 KB as WOFF2, so expect the
page to land somewhere around **double its current weight**. That is the
honest cost. It buys the typeface, and the site is still small — but it is
not free and should not be presented as free.

**Subset carefully.** The copy already uses characters an aggressive Latin
subset would drop: `©` in the copyright, `—` in the prose, `|` and `▌` in the
Light Work credits. A subset that loses a glyph fails silently — the browser
substitutes from the fallback stack and one character renders in a different
face. Keep Latin plus punctuation plus the symbols actually in use, and keep a
real fallback stack behind the custom family for anything missed.

---

## Work remaining

- [ ] Confirm the licence permits web embedding
- [ ] Obtain WOFF2, subset to Latin + punctuation + symbols in use
- [ ] Inline as a base64 `@font-face` `src: url(data:font/woff2;base64,…)`
- [ ] Set `font-family` to the new family with a fallback stack behind it
- [ ] **Tune `--measure`.** Set real copy at that width, count the characters
      on a full line, adjust until it lands in 55-70. The 33em on this branch
      is a starting point, not a finished value.
- [ ] Re-check `--measure-form` holds its ~1.45x relationship to the measure
- [ ] Check the vertical copyright still fits the right margin strip —
      `line-height: 1` is load-bearing there and a new face changes the metrics
- [ ] Check the footer labels still fit on a narrow phone
- [ ] Confirm the no-WebGL fallback still measures its wrapped title list
      correctly, since the seam follows the menu

---

## Not affected

**Glyph icons.** `bakeIcon` draws them to canvas in an explicit hard-coded
monospace stack, independent of the page font, so nothing here changes them.
They are placeholders due to be replaced by uploaded logomarks regardless, at
which point that code path stops being used for real content.

---

## Status log

Append. Newest at the bottom.

- **Set up.** `--measure` 66ch → 33em and `--measure-form` 96ch → 48em, with
  the reasoning written into the CSS comments where the old exactness claim
  was. No font added yet; the branch is deliberately not mergeable until one
  is.
