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

| Wanted | Written | Emitted |
|---|---|---|
| bold | toolbar button → `**text**` | `<strong>` — weight 700 |
| italic | toolbar button → `*text*` | `<em>` |
| underline | `++text++` | `<u>` |
| lighter | `[light]text[/light]` | weight 300 |
| smaller | `[small]text[/small]` | 0.85em |
| larger | `[large]text[/large]` | 1.27em |

Normal weight and normal size have no marker — they are the absence of one.

An unclosed bracket tag **fails the build** with the filename. It would
otherwise ship as a literal `[large]` mid-sentence, and the author has no way
to see that before it is live.

---

## Why the toolbar is restricted

`admin/config.yml` sets `buttons: [bold, italic]` on the markdown widget.

Decap's default toolbar also offers headings, lists, quotes, links, images and
code. Every one of those writes syntax the build does not understand, which
would reach the page as literal `##` and `-` characters. **A button that
produces broken output is worse than a missing button.** The toolbar and the
converter are one decision in two files; adding to either means adding to both.

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
