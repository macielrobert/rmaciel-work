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
