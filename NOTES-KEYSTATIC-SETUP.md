# Keystatic — GitHub App setup

**Branch:** `keystatic-spike`

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

`build.js` reads both. That is what makes the migration survivable: entries
move one at a time and the site builds at every point in between. When the last
loose `.json` is gone, the legacy branch can be deleted.

## The dependency, and the escape hatch

`@markdoc/markdoc` — zero runtime dependencies — is `require`d **lazily, inside
the function that needs it**. A repository with no `.mdoc` files still builds
the entire site with `node_modules` deleted. Verified by deleting it and
building.

Soft breaks are configured as hard breaks. Markdoc drops a single newline by
default, which is the exact behaviour that once flattened a credit list into
one running sentence.

## Verified in the build

- [x] Every control round-trips: bold, italic, strikethrough, all four custom
      marks, link, both list types, quote, divider
- [x] `<script>alert(1)</script>` renders as visible text, not as a script
- [x] Bare `<` and `&` survive as characters
- [x] Single line breaks preserved as `<br>`
- [x] Legacy Decap entries still render through the old marker path
- [x] `node build.js` succeeds with `node_modules` deleted
- [x] CSS braces balanced; script parses

## Still to check on a preview

- [ ] Save a project through the editor and confirm the `.mdoc` on the branch
      matches the syntax above — the tag format is verified from Keystatic's
      source, but not yet from a file Keystatic actually wrote.
- [ ] How formatted text behaves through the character churn. `spanify()` walks
      into child elements, so it should churn normally, but a size span changes
      the line box mid-animation and that has not been seen.
- [ ] Lists, quote and divider at 11px on a phone — spacing is a first guess.


---

# The editor is pointed at `main`

`storage: { kind: 'github', repo: … }` names no branch, so Keystatic commits to
the repository's default branch: **`main`, directly, with no pull request.**

Two consequences, both live now:

1. **No review step.** Decap's editorial workflow opened a PR per edit with its
   own preview. Keystatic as configured writes straight to production content.
   Adding `branchPrefix` or working on a branch restores something like the old
   loop, and is worth doing before real content is written this way.
2. **`main` cannot read what the editor writes.** Only this branch's `build.js`
   understands `.mdoc`. On `main` a `.mdoc` file is simply skipped, so a project
   created in Keystatic is **silently absent from the site** — it builds green
   and the entry is nowhere. That is the failure mode this project has been
   bitten by repeatedly, and it will persist until this branch merges.
