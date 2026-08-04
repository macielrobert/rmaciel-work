# CMS decision record

Every option considered, why it was kept or ruled out, and what the evidence
actually is. Written because this decision has now been made **three times** —
once before any CMS existed, once when Decap was installed, and once when
Decap's ceiling was hit — and each time the previous reasoning had to be
reconstructed from scratch.

**Current decision: move to Keystatic.** Reached 2026-08. Decap ships today and
keeps working until the migration lands.

---

## A note on evidence

This repository's convention is to verify before presenting. That was not
possible for most of this document: the build sandbox has no outbound network,
so no vendor documentation, changelog or package could be read.

Claims are therefore marked:

- **[verified]** — established against this repository, its files, or observed
  behaviour of the running site.
- **[recall]** — from training data, cutoff May 2026. Plausible, unchecked, and
  **must be confirmed before anything is built on it.**

Two [recall] claims have already proved wrong in this project: that the
supplied PP Neue Montreal files were variable fonts, and that Decap would pass
unknown inline syntax through untouched. Both were caught only by looking at
real bytes. Treat the marking seriously.

---

## The requirement

What the CMS has to do, in priority order:

1. **Store content as files in this repository.** The build reads
   `content/*.json`; the whole deploy model depends on content being in git.
2. **Real formatting controls — buttons, not typed syntax.** Bold, italic,
   underline, two extra weights, two extra sizes. This is the requirement that
   forced the current move, and it is about *volume*: a tag typed once is
   nothing, a tag typed four hundred times while entering a real body of work
   is a tax that grows with the archive.
3. **Usable on a phone.** Most editing happens on an iPhone.
4. **Not fragile.** No silent self-updating, no bespoke code against an
   internal API.
5. **Must not compromise the shipped file.** One HTML file, one request, zero
   runtime dependencies. Nothing in the editor may leak into what a visitor
   downloads.

---

## Decap — INSTALLED, being replaced

The CMS in the repository today. Loaded from a CDN as a single script tag,
pinned to `3.15.1`.

**What it does well** — all [verified] by using it:

- Config is one YAML file. No build step, no `package.json`, nothing to install.
- Editorial workflow: a save opens a pull request with its own deploy preview.
- Content is plain JSON, which `JSON.parse` reads with no dependency. This is
  the single reason `build.js` has stayed free of npm.
- The data contract predicted it exactly — `buildData()` never changed a line
  when the CMS arrived.

**Why it is being replaced** — [verified]:

- **The toolbar cannot be extended.** `buttons` accepts names from a fixed
  built-in list. There is no custom-button extension point, so underline,
  weight and size can only be typed. Every workaround was tried: the honest
  ones were exhausted, and the dishonest one (borrowing the `code` or `quote`
  button and giving it a different meaning) was rejected because a control that
  previews as one thing and ships as another is a trap.
- **It escapes square brackets on save.** `[small]X[/small]` is stored as
  `\[small]X\[/small]`. `build.js` strips this, but it is a symptom: the
  storage format is markdown, and markdown escapes anything that looks like
  syntax it owns.
- **A slug rename silently destroyed a project.** Renaming deleted the old file
  on `main` and put the replacement in a pull request. Merging that PR resolved
  the modify/delete conflict in favour of the delete, so the merge succeeded
  and the project stayed gone, with nothing to indicate anything had been
  dropped. Recovered from a commit, but it is the only outright data loss this
  project has had.

**What was NOT Decap's fault** — worth recording, because it inflated the
apparent cost of using it:

- `build.js` refusing to build with no content, which deadlocked the first
  deploy. Mine.
- `build.js` collapsing single line breaks into spaces, which flattened a
  credit list into one running sentence. Mine.
- Stale deploy previews. That is how git branches work, not a CMS behaviour.

Most of the friction was self-inflicted. The genuine ceiling is the toolbar.

**Maintenance status** [recall]: handed from Netlify to community maintenance,
described as deprioritised. Mild counter-evidence from this repository: the
pinned version is `3.15.1` [verified], and fifteen minor releases is not a dead
project.

---

## Keystatic — CHOSEN

**Why** [recall, and the central claim to verify first]: its rich-text field
supports **custom components and marks**, so underline, weight and size can be
real buttons rather than typed syntax. That is precisely the ceiling Decap hit,
and no amount of configuration gets Decap over it.

Also believed [recall]:

- Git-backed, storing content as files in the repository — so the deploy model
  and the build seam survive.
- Underline is a **built-in** mark, not a custom one.
- Runs against a local repository as well as GitHub.

### What it costs, stated plainly

- **npm and a framework enter the repository.** [recall] Keystatic's admin UI
  ships as framework integrations — `@keystatic/next`, `@keystatic/astro` and
  similar — with no script-tag build. There is no CDN path equivalent to
  Decap's one-line install.

  This does **not** touch the shipped `index.html`: the site stays one file,
  one request, zero runtime dependencies. But it ends "no package manager" as a
  property of the repository, and `build.js`'s deliberate simplicity stops
  being the whole build story. That was raised before the decision and accepted.

- **The content format changes, and it may drag npm into `build.js` too.**
  [recall, and the highest-risk unknown] Keystatic stores rich text as Markdoc
  or MDX. Neither parses with Node built-ins. If the stored format is a markup
  language, `build.js` needs a parser — a runtime dependency in the build,
  which is a much bigger concession than one in the editor.

  **Investigate first whether Keystatic can store the document as a JSON AST.**
  If it can, this inverts from the biggest risk into the biggest prize:
  `JSON.parse` reads it with no dependency, `build.js` walks the tree and emits
  exactly the HTML the site wants, and the entire marker-parsing layer —
  escaping, bracket tags, unclosed-tag detection, Decap's backslashes —
  **deletes**. That would leave the build simpler than it is today, not more
  complex.

- **Migration work.** Field names and file layout will likely change, and
  `build.js` reads specific field names. Content is files either way, so this
  is a reshape, not an export — but it is more than a config rewrite.

---

## Sveltia — RULED OUT for this requirement

[recall] A rewrite of Decap that reads Decap's own config file, so switching
would be close to free: swap the script tag, keep `admin/config.yml`. Reported
to be faster and considerably better on mobile.

**Ruled out because it solves the wrong problem.** It is still
markdown-based, so it would not give custom formatting buttons either.
Requirement 2 is the one that forced this move, and Sveltia does not meet it.

Worth remembering as a **fallback**: if Keystatic's cost proves unacceptable
once its real requirements are known, Sveltia is the cheapest way to improve
the editor without changing the architecture. Keeping Decap's config format
means that door stays open.

---

## TinaCMS — RULED OUT

[recall] Actively developed. Its differentiator is visual editing: click text
on the page and edit it in place.

**Ruled out because that differentiator is worthless here.** Visual editing
works by instrumenting React components. This site is a WebGL canvas and
hand-built DOM with no component tree to instrument. The cost — a cloud service
and a GraphQL layer — would be paid in full for none of the benefit.

Assessed and rejected on the same grounds in an earlier session, before any CMS
existed. The reasoning has held up.

---

## Pages CMS — NOT ASSESSED

[recall] A git-backed CMS with a hosted editor and a single config file, so
nothing self-hosted. Plausibly a lighter alternative to Keystatic.

Not assessed properly, and named here only so the next person knows it was
noticed rather than missed. If Keystatic's framework requirement turns out to
be the dealbreaker, this is the next thing to look at.

---

## No CMS — RULED OUT, but it was right at the time

Editing `content/*.json` by hand, through GitHub's web editor.

Correct while the site was a single file with placeholder copy: an earlier
session's assessment was *"static file first, CMS only when earned"*, and the
CMS was correctly deferred until there was real content to manage.

**Ruled out now** because editing JSON by hand on a phone is miserable, and
because a mistyped comma fails the build. The requirement that earned a CMS
was real content arriving; it has arrived.

---

## The reversal, recorded

An earlier session assessed the field before any CMS existed and **ruled Decap
out**, recommending Keystatic as "the closest fit if one gets added." Decap was
then installed anyway.

Nothing in the repository ever explained that reversal, so the argument had to
be had again from scratch. Recording it here so it is not had a fourth time:

- The earlier assessment was **right about the ceiling** and reached that
  conclusion without having to hit it.
- Installing Decap was still **not wrong**. It cost one YAML file and no
  dependencies, it proved the data contract, and it made the CMS-shaped seam
  real rather than theoretical. The work it enabled — the build script, the
  editorial workflow, the deploy previews — all survives the migration
  unchanged.
- What changed is not the analysis but the **volume**. Typed formatting tags
  are a rounding error across fourteen placeholder entries and a real tax
  across a career's archive.

---

## Before any migration work begins

None of the Keystatic claims above have been checked. In priority order:

1. **Can Keystatic store rich text as JSON rather than Markdoc/MDX?** This
   decides whether `build.js` stays dependency-free or gains a parser. Biggest
   single unknown; check it first.
2. **Can custom inline marks be added with toolbar buttons** — specifically for
   weight and size, not only block-level components?
3. **What exactly does the admin UI require** — which framework integrations
   exist, whether any of them can be built into static files that Netlify can
   serve from `dist/admin/`, and what that build costs.
4. **Is the editor usable on an iPhone?** Requirement 3, and the one most
   likely to be discovered too late.
5. **How does it authenticate against a private repository?** Decap needed
   `auth_scope: repo` and failed silently without it — logged in fine, showed
   nothing. Expect an equivalent trap.

Answer 1 and 2 before writing any code. If either answer is no, the move does
not achieve what it is for.
