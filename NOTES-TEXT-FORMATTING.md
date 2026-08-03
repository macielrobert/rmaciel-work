# Design note — text formatting

**Branch:** `text-formatting` · **Status:** implemented, needs looking at on a
real preview

Bold, italic, underline, three weights and three sizes in project and ABOUT
copy — plus single line breaks, which were being silently discarded.

---

## The bug this also fixes

`build.js` collapsed single line breaks into spaces. Only blank lines
survived. Copy laid out as lines rather than prose came out as one running
sentence, with nothing anywhere to say the author's line breaks had been
thrown away:

```
Robert Maciel              ->   Robert Maciel Artist · Designer ⮡ Producer
Artist · Designer               · Creative Direction · Curator
⮡ Producer · Creative …
```

Twenty-eight of them in the Light Work credits alone, live on the site.
A blank line still starts a paragraph; a single newline is now a hard break,
which is what typing one plainly means.

---

## The vocabulary

Bold and italic are **markdown**, because the CMS gives them toolbar buttons
and writes the syntax itself — nothing to memorise.

Underline, weight and size are **bracket tags**, because markdown has no
syntax for any of them. They share one shape so there is one rule rather than
three.

| Wanted | How | Emitted |
|---|---|---|
| bold | **toolbar button** | `<strong>` — weight 700 |
| italic | **toolbar button** | `<em>` |
| larger | **toolbar button** (heading) | 1.27em, whole line |
| underline | typed `++text++` | `<u>` |
| lighter | typed `[light]text[/light]` | weight 300 |
| smaller | typed `[small]text[/small]` | 0.85em |

Normal weight and normal size have no marker — they are the absence of one.
`[large]…[/large]` still works as an inline escape hatch but is not taught;
the heading button is the path, because it is visible.

### Why headings, of all buttons

Custom buttons are not an extension point on Decap's markdown toolbar — the
`buttons` option takes names from a fixed built-in list. Of that list,
**headings are the only entry whose on-screen preview matches what the site
does**: press it, the editor shows bigger text, the page shows bigger text.

Mapping some other spare button — `code`, or `quote` — would have put a
control in the toolbar that previews as one thing and ships as another. That
is a trap set for six months from now, not a feature.

Every heading level maps to the SAME step. There is one large size, not six,
so copy cannot grow a hierarchy the layout has no answer for — and it means
the mapping holds whichever heading buttons Decap actually renders, which
matters because the exact button names could not be verified from the build
sandbox.

An unclosed bracket tag **fails the build** with the filename. It would
otherwise ship as a literal `[large]` mid-sentence, and the author has no way
to see that before it is live.

---

## Why the toolbar is still restricted

`admin/config.yml` sets `buttons: [bold, italic, heading-two, heading-three]`.

Decap's default toolbar also offers lists, quotes, links, images and code.
Every one of those writes syntax the build does not understand, which would
reach the page as literal `-` and `>` characters. **A button that produces
broken output is worse than a missing button.** The toolbar and the converter
are one decision in two files; adding to either means adding to both.

## The three that stayed typed

Underline, light and small have no toolbar button available and no honest
button to borrow. They are documented in the field's `hint`, which Decap
renders in grey beside the field — on screen, at the moment of use, rather
than in anyone's memory. That was the explicit requirement: a control is
either a visible button or visible help text, never neither.

## Rejected: a custom editor widget

`CMS.registerWidget` would allow a bespoke toolbar with true inline buttons
for all six controls. Rejected on the stated constraint that nothing may be
fragile against updates:

- It is a React component living against Decap's internal API — the single
  most upgrade-sensitive thing that could be added here.
- The CMS currently loads from unpkg as `^3.0.0`, so it updates itself.
- It could not have been tested from the build sandbox, which has no network.
  Shipping an unverified editor into the only interface for changing the site
  risks losing the ability to edit at all.

The cost of the decision is honest: mid-sentence underline, light and small
are typed rather than clicked.

---

## Why named steps and not numbers

Three weights exist as files — 300, 400, 700 — and nothing between them.
A free numeric control would let the author pick 500 and get a synthesised
weight: the browser smearing the 400, which reads as a bad render rather than
a choice.

Size is closed for a different reason. Free values fight the 33em reading
measure and a large enough one overflows the column. Both controls are
therefore closed sets, chosen from rather than typed.

Sizes are in `em`, not `px`, so they resolve against the 11px body text and a
later type-size change carries them along instead of stranding them.

---

## Safety

The site inserts body copy with `innerHTML`. The converter **escapes first**
— `&`, `<`, `>` — and only then emits its fixed set of tags. The table above
is therefore the complete list of what can ever reach the page, not the list
of what is expected to.

Verified: `<script>alert(1)</script>` in a description comes out as visible
text, not as a script.

---

## What is NOT formatted

`share_description` and the site `description` go through a separate plain-text
path. They end up in a link preview and a search result, where a `<strong>` is
not bold text — it is the characters `<strong>`. They collapse to one line and
carry no markup.

---

## Checked in the build

- [x] Bold, italic, underline, all three weights, all three sizes
- [x] Nesting — `[large]**big and bold**[/large]`, `**bold with *italic* inside**`
- [x] `<script>` escaped rather than executed
- [x] Bare `<`, `>`, `&` in ordinary prose survive as text
- [x] `file_name_here` and `2 * 3 * 4` left alone — no accidental italics
- [x] Unclosed tag fails the build, naming the file
- [x] Light Work credits render as separate lines again
- [x] Share and site descriptions stay plain
- [x] Light weight file shipped; four `@font-face` blocks; build copies four files

## Still to check — needs a preview

- [ ] **Does Decap's rich-text editor preserve the bracket tags?** It
      round-trips markdown through a parser, and unknown inline syntax *should*
      survive as plain text — but that is an expectation, not a verified fact.
      Type `[small]test[/small]` in the editor, save, and confirm the JSON on
      the branch still reads `[small]test[/small]` and has not been escaped or
      mangled. **This is the one thing most likely to be wrong.**
- [ ] **Do the heading buttons appear?** The button names `heading-two` and
      `heading-three` are from knowledge, not verified against Decap's source.
      If they are wrong the buttons simply will not show; typing `## ` still
      works, and the fix is a name change.
- [ ] **PIN THE CMS VERSION.** `admin/index.html` loads `decap-cms@^3.0.0` —
      any 3.x, whichever is newest that day. Read the real version from
      `https://unpkg.com/decap-cms@^3.0.0/package.json` and pin it. Not done
      here because the sandbox has no network and a guessed version number
      would take the whole CMS down.
- [ ] Formatted text still churns correctly. `spanify()` walks into child
      elements, so it should — but a size span changes the line box mid-
      animation and that has not been seen.
- [ ] Underline offset at 11px — set to 0.18em so it clears descenders rather
      than cutting through g, p and y. Judge it on the real face.
- [ ] Light (300) at 11px on a phone. It may be too fine to read at body size,
      in which case it belongs in headings only, or not at all.

---

## Status log

- **Set up and implemented.** Vocabulary, converter, CSS, restricted toolbar,
  Light weight added, line breaks preserved. Nothing seen rendered yet.
- **Size became a button.** Heading buttons added and mapped to the large step
  — the only toolbar entry whose preview matches the site's behaviour. A
  custom editor widget was considered for the remaining three controls and
  rejected on upgrade fragility; those are documented in on-screen help
  instead. The CMS version range was flagged for pinning.
