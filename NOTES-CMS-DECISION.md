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

This repository's convention is to verify before presenting.

The build sandbox cannot reach the open web — vendor documentation sites all
return 403. **The npm registry, however, is reachable.** Every Keystatic claim
below marked [verified] was read out of `@keystatic/core` 0.6.4's own
TypeScript declarations, downloaded from the registry and inspected. That is
stronger evidence than documentation prose: it is the API itself.

Claims about products with nothing to download — Sveltia, Pages CMS, Decap's
maintenance status — remain unverified.

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

**Why** [VERIFIED — see the verification section below]: its rich-text field
supports **custom marks with required toolbar icons**, so underline, weight and
size become real buttons rather than typed syntax. That is precisely the
ceiling Decap hit, and no amount of configuration gets Decap over it.

Underline is a **built-in** mark [verified]. Weight and size become custom
marks carrying a `className` [verified], which maps straight onto the CSS
classes the site already has.

### What it costs, stated plainly

- **npm and a framework enter the repository.** [verified] The only published
  integrations are `@keystatic/next`, `@keystatic/astro` and `@keystatic/remix`.
  There is no script-tag or framework-free build.

  This does **not** touch the shipped `index.html`: the site stays one file,
  one request, zero runtime dependencies. But it ends "no package manager" as a
  property of the repository, and `build.js`'s deliberate simplicity stops
  being the whole build story. That was raised before the decision and accepted.

- **`build.js` gains a parser.** [verified] The JSON-storing field is
  deprecated; rich text is stored as Markdoc or MDX. But `@markdoc/markdoc` has
  **zero runtime dependencies**, and in exchange the whole marker layer in
  `build.js` deletes — roughly a hundred lines of string-bashing replaced by
  walking a real AST. See the verification section.

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

## VERIFIED against the real package — 2026-08

The npm registry turned out to be reachable from the build sandbox even
though the open web is not. So these answers come from **`@keystatic/core`
0.6.4's own TypeScript declarations**, downloaded and read — not from
documentation prose and not from recall.

### Q2: custom marks with toolbar buttons — YES [verified]

The blocking question, and the answer is unambiguous.

`fields.document`'s built-in `inlineMarks` already include **underline**:

```
inlineMarks?: true | { bold, italic, underline, strikethrough,
                       code, superscript, subscript, keyboard }
```

And custom formatting is a first-class component kind. From
`content-components.d.ts`:

```
MarkComponentConfig = {
  label: string;
  icon: ReactElement;          // REQUIRED — this is the toolbar button
  schema: Schema;
  tag?: 'span' | 'strong' | 'em' | 'u' | 'small' | ... ;
  className?: ...;
  style?: ...;
}
```

`icon` being **required** is the point: a custom mark cannot exist without a
toolbar button. `className` and `tag` mean light and small map straight onto
the CSS classes the site already has. Five component kinds exist —
`mark`, `inline`, `block`, `wrapper`, `repeating`.

**This is the thing Decap cannot do at any price, and Keystatic does it as a
documented, typed API.** The move achieves what it is for.

### Q1: storage format — Markdoc or MDX, NOT JSON [verified]

The hoped-for answer was no. `fields.document`, which stores a JSON AST,
carries this in its own declaration:

> `@deprecated` `fields.markdoc` has superseded this field. `fields.mdx` is
> also available if you prefer MDX.

So the supported path writes `.mdoc` or `.mdx` — markup, not JSON. **`build.js`
needs a parser.**

**But the cost is far smaller than feared.** `@markdoc/markdoc` 0.5.8 has
**zero runtime dependencies** [verified from its registry metadata] — its only
peers are React and its types, needed for its React renderer, not for parsing.
One package, no dependency tree.

And the trade buys something real: `Markdoc.parse` returns a proper AST, so
`build.js` walks a tree and emits exactly the HTML the site wants. The entire
marker layer — escaping, bracket tags, unclosed-tag detection, stripping
Decap's backslashes, the heading-line mapping — **deletes**. The build gets
one dependency and loses roughly a hundred lines of string-bashing.

### Q3: what the admin UI requires — a framework, unavoidably [verified]

The only integrations published are `@keystatic/next`, `@keystatic/astro` and
`@keystatic/remix`. **There is no framework-free or script-tag path**, and no
static-only build among them. Peer dependencies are React 18/19 plus the
framework itself.

Astro is the lightest of the three and the obvious candidate, but the
conclusion stands: npm, `node_modules` and a framework enter this repository
for the editor. The shipped `index.html` is untouched — one file, one request,
zero runtime dependencies — but "no package manager" ends as a property of the
repo. Raised before the decision, accepted.

### NEW RISK, not previously weighed: it is pre-1.0 [verified]

`@keystatic/core` is at **0.6.4**, published 2026-07-31. Two readings, both
true:

- **Actively maintained** — a release within days. Compare Decap's "community
  maintenance" reputation.
- **Pre-1.0** — by semver convention, breaking changes may land in any minor
  release. Decap is at 3.15.1.

This sits directly against the stated requirement that nothing be fragile
against updates. It does not reverse the decision — the formatting ceiling is
the deciding factor and Decap cannot clear it — but it means **the version
must be pinned exactly, as Decap now is, and upgrades treated as deliberate
work with a preview check.** Expect the custom marks to need revisiting at
some upgrades.

---

## Still unanswered — cannot be checked from the sandbox

1. **Is the editor usable on an iPhone?** Requirement 3, and the one most
   likely to be discovered too late.
2. **How does it authenticate against a private repository?** Decap needed
   `auth_scope: repo` and failed silently without it — logged in fine, showed
   nothing at all. Expect an equivalent trap and look for it early.
3. **Can the Astro admin build be emitted as files Netlify serves from
   `dist/admin/`,** or does it need a running server for the GitHub OAuth
   callback? This decides whether `netlify.toml` grows a second build step.
