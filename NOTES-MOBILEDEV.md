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

The first two are not mobile layout work — both were the vehicle for getting
the branch to build the first time.

3. **The menu is one swipeable row.** The first real mobile layout change.

## The menu row (commit 3)

The icon grid no longer wraps. At every width it is ONE row; when the row is
wider than the screen it scrolls, and you swipe it left and right with
momentum. Icon size never changes — that was the point.

On a 390px phone it was 6 x 3, and three rows of icons spent 252px of an 844px
screen on navigation. It is 127px now, and the extra 125px goes to the window,
which is where the work is.

What to know if you touch it:

- **Two different things in this file are called a carousel.** The old one is
  the image strip at the foot of the window (`#nl-car`, `--car-h`, `.car`).
  The new one is the menu row, and everything belonging to it is named
  `ROW_` / `row` / `.scroll-row` so the two can never be confused in a grep.
- **A tap now commits on RELEASE, not on press** — but only while the row
  actually scrolls. Under `ROW_TAP_SLOP` (8px) of travel it was a tap; over
  it, a swipe. Selecting on press, which is what it did before and still does
  on a wide screen, opened a project every time a swipe started on an icon.
- **The feel knobs are all near `CELL_PX`** — friction, the flick ceiling, the
  overscroll resistance, the settle rate. Every one is per SECOND, so a change
  behaves the same on a 60Hz phone and a 120Hz one. `ROW_FRICTION` is the one
  to touch first if the glide runs too long or too short.
- **Keyboard, deep links and section switches all move the row.** Arrowing off
  the visible end pulls the row along; opening `#build/vca` scrolls that icon
  into view; switching section starts the new row at its first icon.
- The no-WebGL fallback is untouched. There the menu is a wrapped list of
  titles and always was.

### Verified in a real browser

Chromium at 390x844 with touch, over the built `dist/`: one row of 50px cells;
swipe glides on after release and clamps at both ends; overscroll rubber-bands
and springs back; a tap selects, a drag from an icon does not; a 5px jiggle
still counts as a tap; deep link scrolls into view; section switch resets;
landscape (844x390) fits all 13 and does not scroll; `?nogl` unchanged; no page
errors. Confirm on a real iPhone anyway — momentum is a feel, not a number.

### One thing left open, deliberately

At rest on a 390px screen the row happens to end almost exactly at the right
edge, so nothing peeks past it and there is no visual hint that it scrolls.
Once you swipe, the cut-off icon on the left makes it obvious. Fixing the rest
state means an edge treatment (a fade, or offsetting the row) and that is a
design decision, not a bug — flagged, not decided.

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
