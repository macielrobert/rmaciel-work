# Keystatic — setup, renderer and the review-step gap

**Merged and live.** The editor is at `/keystatic`; Decap and `admin/` are
gone. Read this before changing anything about the CMS.

Keystatic's GitHub storage does not use a plain OAuth app the way Decap does.
It needs **a GitHub App you create once**, plus four environment variables in
Netlify.

## The symptom, and exactly what causes it

Clicking "Sign in with GitHub" **downloads an empty file called `login`**.

That is not a fault in this repository's code. Traced to source in
`@keystatic/core/api/generic`: when any of the three server variables is
missing, Keystatic replaces its entire API handler with a stub —

```js
if (!clientId || !clientSecret || !secret) {
  return async (req) => {
    if (joined === 'github/login' || ...) return redirect('/keystatic/setup');
    return { status: 404, body: 'Not Found' };
  };
}
```

— and `redirect()` returns `{ body: null, status: 307 }` with only a
`Location` header. No content type, no body. Safari saves that as a file named
after the last path segment: `login`.

**An empty downloaded `login` file means "not configured" and nothing else.**
The intended destination, `/keystatic/setup`, is worth opening directly — but
note that Keystatic's *automatic* GitHub App creation refuses to run outside
local development (`'App setup only allowed in development'`), so on a deployed
preview the App still has to be created by hand, as below.

Keystatic can create the App for you automatically, but only when running
locally — the code refuses in production with *"App setup only allowed in
development"*. Creating it by hand is the path below and takes a few minutes.

---

## 1. Create the GitHub App

**github.com → Settings → Developer settings → GitHub Apps → New GitHub App**

| Field | Value |
|---|---|
| Name | anything, e.g. `rmaciel-work-cms` |
| Homepage URL | the site URL |
| **Callback URL** | `<site>/api/keystatic/github/oauth/callback` |
| Request user authorization (OAuth) during installation | **ticked** |
| Webhook → Active | **unticked** |
| Where can this be installed | Only on this account |

**Repository permissions:**

- **Contents** — Read and write *(it edits content files)*
- **Metadata** — Read-only *(mandatory, granted automatically)*
- **Pull requests** — Read and write *(only if the PR-per-edit workflow is
  wanted, as Decap had)*

Then **Install** the App on `macielrobert/rmaciel-work`.

### The callback URL is the fiddly part

A GitHub App holds a fixed list of callback URLs, and **Netlify deploy
previews get a different address per pull request**. So testing on a preview
means adding that preview's URL to the list as well as the production one.
GitHub allows several — add both.

For PR #17 that is:
`https://deploy-preview-17--rmaciel-work.netlify.app/api/keystatic/github/oauth/callback`

---

## 2. Set four environment variables in Netlify

**Site configuration → Environment variables.** Names are exact — read out of
`@keystatic/core`'s own source, not from documentation.

| Variable | Where it comes from |
|---|---|
| `KEYSTATIC_GITHUB_CLIENT_ID` | the App's page, "Client ID" |
| `KEYSTATIC_GITHUB_CLIENT_SECRET` | the App's page → "Generate a new client secret" |
| `KEYSTATIC_SECRET` | any random string, **at least 32 characters** |
| `PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` | the App's name as it appears in its URL |

`KEYSTATIC_SECRET` only signs the login cookie. It can be regenerated at any
time; doing so just logs everyone out. Generate one with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`PUBLIC_` is not decoration — that prefix is how Astro exposes a variable to
the browser, and the app slug has to reach the client. The other three must
**not** have it: they are secrets and stay on the server.

---

## 3. Redeploy and try again

Environment variables are read at build time, so an existing deploy will not
pick them up. Trigger a fresh deploy, then open `/keystatic` again.

---

## What this costs, recorded honestly

Decap needed one line of YAML and no accounts. Keystatic needs a GitHub App,
four environment variables, and a callback URL maintained per deploy target.
That is a real difference in setup burden and it is worth weighing against the
formatting capability it buys — which is the whole reason for the move.

It is, however, **one-time**. None of it recurs while writing content.


---

# The renderer — build.js reads Markdoc

## The vocabulary, end to end

Each editor button maps to markup `index.html` has a rule for. **The toolbar in
`keystatic.config.tsx`, the tag map in `build.js`, and the CSS in `index.html`
are one decision in three files.** A button with no renderer entry produces
nothing, silently; a CSS rule with no button is dead. None of the three may
grow alone.

| Button | Markdoc | HTML | Styled as |
|---|---|---|---|
| Bold | `**x**` | `<strong>` | weight 700 |
| Italic | `*x*` | `<em>` | italic cut |
| Strikethrough | `~~x~~` | `<s>` | line-through |
| Underline | `{% underline %}` | `<u>` | offset to clear descenders |
| Lighter | `{% light %}` | `<span class="w-l">` | weight 300 |
| Smaller | `{% small %}` | `<span class="t-s">` | 0.85em |
| Larger | `{% large %}` | `<span class="t-l">` | 1.27em |
| Link | `[x](url)` | `<a>` | underlined, inherits ink — no third colour |
| Bullet / Numbered | `- x` / `1. x` | `<ul>`/`<ol>` | indented INSIDE the measure |
| Quote | `> x` | `<blockquote>` | margin rule, not italics |
| Divider | `---` | `<hr>` | hairline at the seam's accent grey |

Custom marks arrive as Markdoc **tags named after their component key**,
verified against Keystatic's own deserializer rather than assumed.

**Removed: code block.** It needs a monospace face, which this site
deliberately stopped shipping. A rule for inline `<code>` remains anyway,
because Markdoc still honours hand-typed backticks and unstyled code would
look like a mistake rather than a choice.

## Two file formats, on purpose

- **Decap** wrote `content/projects/vessel.json`, description as a string.
- **Keystatic** writes `content/projects/vessel.mdoc` — JSON frontmatter
  between `---` fences, then the rich text as Markdoc.

**This was read off a file the editor actually wrote.** An earlier version of
the loader expected a folder per entry holding `index.json` and `summary.mdoc`,
which is what `format: { data: 'json', contentField: 'summary' }` sounded like
it would produce. It produces neither of those filenames.

The slug comes from the FILENAME. `slugField: 'title'` names the field the slug
is derived from, not a field Keystatic writes — so renaming a file renames a
URL.

**The `.json` reader has since been removed.** It existed only so entries could
migrate one at a time with the site building at every point in between. All
fifteen are `.mdoc` now, so a stray `.json` in `content/projects/` would be a
file no editor wrote.

## The dependency, and the escape hatch

`@markdoc/markdoc` — zero runtime dependencies — is `require`d **lazily, inside
the function that needs it**.

**The escape hatch it used to provide is gone, and this file claimed otherwise
until it was re-tested.** Lazy loading only avoided the dependency while no
`.mdoc` file had a body to parse. All fifteen projects have one, so `node
build.js` with `node_modules` deleted now stops on the first entry:

```
BUILD FAILED
  content/projects/big-deal-project.mdoc: this entry stores its description as
  Markdoc, which needs the @markdoc/markdoc package. Run `npm install` before
  building.
```

That is the designed failure — loud, named, actionable — and Netlify installs
before it builds, so no deploy depends on the old behaviour. What is gone is
building the site from a bare checkout. The lazy `require` is now worth keeping
for the error message, not for the independence.

Soft breaks are configured as hard breaks. Markdoc drops a single newline by
default, which is the exact behaviour that once flattened a credit list into
one running sentence.

## Verified in the build

- [x] Every control round-trips: bold, italic, strikethrough, all four custom
      marks, link, both list types, quote, divider
- [x] `<script>alert(1)</script>` renders as visible text, not as a script
- [x] Bare `<` and `&` survive as characters
- [x] Single line breaks preserved as `<br>`
- [x] All fifteen projects render identically to before the migration —
      compared on text, marks, slugs, details, layout, expand and icons
- [ ] ~~`node build.js` succeeds with `node_modules` deleted~~ — **no longer
      true, and it was true when ticked.** It held while entries were still
      `.json`; every project is `.mdoc` with a body now. See "The dependency,
      and the escape hatch" above.
- [x] CSS braces balanced; script parses

## Still to check on a preview

- [x] Confirmed against a file the editor actually wrote. The tag syntax was
      right; the FILE LAYOUT was not — see above. Reading real bytes beat
      reasoning about the config three separate times in this migration.
- [ ] How formatted text behaves through the character churn. `spanify()` walks
      into child elements, so it should churn normally, but a size span changes
      the line box mid-animation and that has not been seen.
- [ ] Lists, quote and divider at 11px on a phone — spacing is a first guess.


---

# Review before publish — a GitHub setting, not a Keystatic one

Decap had `publish_mode: editorial_workflow`: every save opened a pull request
with its own deploy preview. **Keystatic has no equivalent setting.** Left
alone it commits straight to the default branch, which is what happened to the
first project created through it.

The equivalent lives on GitHub. Keystatic handles a rejected write like this,
read out of its own UI source:

```
BRANCH_PROTECTION_RULE_VIOLATION →
  "Changes must be made via pull request to this branch.
   Create a new branch to save changes."
  [ Create branch and save ]
```

So **protecting `main` restores the whole loop** — edit, branch, pull request,
deploy preview, merge — driven by the repository rather than a CMS flag.

## Enable it

**Repo → Settings → Rules → Rulesets → New branch ruleset**

| Setting | Value |
|---|---|
| Target | `main` (Default branch) |
| Enforcement | Active |
| **Require a pull request before merging** | ticked |
| Required approvals | **0** |

Zero approvals matters: a repository with one person cannot approve its own
pull request, and any higher number locks the owner out of merging.

If Rulesets are unavailable, the older **Settings → Branches → Add branch
protection rule** does the same thing. Availability of each on a free private
repository could not be checked from the build sandbox — if one is missing,
try the other.

**This rule is load-bearing.** Remove it and the editor silently resumes
writing to production content with no review step, and nothing in
`keystatic.config.tsx` will say so.

## `branchPrefix: 'cms/'`

Prefills the new-branch name so branches an editor creates stay
distinguishable from branches code work creates — the same convention Decap
used. It only prefills the field; it does not hide branches.

## ~~Until this branch merges~~ — merged

Kept because the failure it describes is worth recognising if it recurs: while
only the migration branch understood `.mdoc`, a project created in Keystatic
was **silently absent from the site** on `main` — the build went green and the
entry was nowhere. That is resolved; `main` reads `.mdoc` and nothing else.

`content/projects/big-deal-project.mdoc` — the entry written while proving the
editor — is still present and still on the live site. Deleting it is on the
punch list.

---

# The singleton filenames are Keystatic's to choose

Found by a debugging pass after the migration, and worth stating plainly
because it silently split ABOUT in two.

**A singleton with a rich-text `contentField` is stored as ONE `.mdoc` file**,
exactly like a project: JSON frontmatter between `---` fences, then the prose.
Only a singleton with no rich-text field stays pure `.json`. Read out of
`getDataFileExtension()` in `@keystatic/core`, not assumed:

| Singleton | `format` | File Keystatic reads and writes |
|---|---|---|
| `about` | `{ data: 'json', contentField: 'summary' }` | `content/about.mdoc` |
| `contact` | `{ data: 'json' }` | `content/contact.json` |
| `site` | `{ data: 'json' }` | `content/site.json` |

The migration converted every project to `.mdoc` and left ABOUT as
`content/about.json`. The editor therefore looked at `content/about.mdoc`,
found nothing, and showed an **empty ABOUT form** — not an error, just blank
fields, which reads as "nothing written yet" rather than "wrong filename".
Saving it would have written `about.mdoc` alongside the orphaned `about.json`
and failed the next build on the file it could no longer find.

Both halves are fixed: the file is `content/about.mdoc` and `build.js` reads
it. ABOUT now goes through the same Markdoc renderer as a project, so the
toolbar works there too.

**A trailing slash also matters.** `path: 'content/about'` puts the file at
`content/about.mdoc`; `path: 'content/about/'` would put it at
`content/about/index.mdoc`. Do not add one.
