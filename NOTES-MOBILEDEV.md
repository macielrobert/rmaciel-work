# NOTES-MOBILEDEV

Branch memory for `mobiledev`. Read first, update last.

## What this branch is for

A preview branch that deploys to its own URL so changes can be seen in a
browser without touching the live site. Mobile formatting and layout work
happens here. `main` stays clean until a deliberate merge.

## Before merging to main — MUST DO

**Remove the blue dot.** `#branch-dot` in `index.html`: a `<div>` just after
`<body>` and a CSS rule at the end of the stylesheet. Both are labelled
`TEMPORARY — REMOVE BEFORE MERGING TO main`. It is a 10px blue dot fixed to
the top-left corner, there only to prove at a glance that the tab is showing
the branch preview and not production.

```
grep -n "branch-dot\|TEMPORARY" index.html
```

Two hits in markup, one block in CSS. If that grep is empty, it is already gone.

## Setup, already done

- Branch deploy enabled in Netlify (Site configuration → Build & deploy →
  Branches and deploy contexts). URL: `https://mobiledev--rmaciel-work.netlify.app`
- Every push to `mobiledev` rebuilds it, about a minute. Refresh the browser.

## Known limitation

`/keystatic` on the preview URL will not log in. A GitHub App holds a fixed
list of callback URLs and this one is not on it. Adding
`https://mobiledev--rmaciel-work.netlify.app/api/keystatic/github/oauth/callback`
to the App fixes it — it is a stable URL, so it is a one-time add, unlike
per-PR previews. Until then, edit content on the live site instead; those
saves land on `main` and will merge in normally.

See `NOTES-KEYSTATIC-SETUP.md`, "The callback URL is the fiddly part".

## Commits so far

1. `<title>` set to the real site title, replacing `SVG Noise Lab — v80`;
   temporary branch-preview dot added.
2. `<title>` now written by `build.js` from `site_title` in
   `content/site.json`, so the site name has one source and cannot drift.
   The template carries a loud `PLACEHOLDER` string instead of the real name.

Neither is mobile layout work. Both were the vehicle for getting the branch
to build the first time.

## Three writers to this repo

| Writer | Writes to |
|---|---|
| Desktop clone via GitHub Desktop | `main` |
| Mobile sessions (Claude) | `mobiledev` |
| Keystatic at `/keystatic` | `main`, immediately |

Keystatic commits to `main` while this branch is open, so `mobiledev` will
fall behind on `content/`. Expected, and not a problem: content and layout
are different files. If a merge conflict does appear, merge `main` into
`mobiledev` rather than the other way round.

## Picking back up on desktop

```
git fetch origin
git checkout mobiledev
git pull origin mobiledev
```

Then remove the dot, merge to `main`, and delete the branch deploy in Netlify
if it is no longer wanted.
