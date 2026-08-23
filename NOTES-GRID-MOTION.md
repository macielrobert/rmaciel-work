# Design note — animated grid reorganization

**Branch:** `grid-motion` · **Status:** mechanism built (steps 1–3),
**switched OFF by default** (`?motion`), and **now unhooked**: the section
swap it animated no longer exists — every section lives in one row and the
footer scrolls to it, so nothing calls `armGridMotion()`. The code is still in
`index.html`. Either give it a new moment to animate or delete it; leaving it
uncalled indefinitely is the one thing not to do. The arrangement itself
(step 4) is still undesigned, and until it exists the motion makes the site
worse. See the last status-log entry.

A long-running change worked on intermittently, in parallel with launch. This
file is the memory: read it first, update it last. Nothing about it survives in
a chat window.

---

## What this is

Today the icon grid changes content by churning: every icon drives to full
noise, the icon set is exchanged at the midpoint, and the new set re-forms out
of noise. Position never changes. The grid is a fixed lattice that things
dissolve in and out of.

The change: **let the icons move.** During the churn state, animate their
positions so the grid reorganizes into a new arrangement — arriving somewhere
that reads as a different page with different content, rather than the same
lattice holding different icons.

The motion is the transition. Not decoration on top of a page change — the
page change itself.

---

## What the code already gives us

This was read out of `index.html` before writing any of the below. It matters
because it makes the change substantially smaller than it sounds.

**Position is already per-icon, per-frame, and mutable.** `frame()` draws one
quad per icon and sets its position from a plain JS property every frame:

```js
gl.uniform2f(loc.uTranslate, ic.cx - qw * 0.5, ic.cy - qh * 0.5);
```

`ic.cx` / `ic.cy` are clip-space centres written by `relayout()`. Nothing
caches them, nothing batches them into a buffer. **Writing different numbers
into `ic.cx` / `ic.cy` between frames moves the icon. No shader change, no
new geometry, no render-architecture change.**

**The easing machinery already exists.** Every icon already carries its own
animated state — `ic.mix` (churn), `ic.still` (frozen-ness), `ic.phase` (its
own noise clock) — advanced by `dt` in `frame()` against `ON_TIME` /
`OFF_TIME`, and shaped by `smooth()`. Position animation is another value on
the same pattern: a target, a current, an asymmetric clock. The idiom to copy
is already in the file, twice.

**There is already a transition moment to hook into.** A section switch churns
the whole grid to noise on the fast clock, hard-swaps the icon set at the
midpoint, and re-forms. That midpoint is the natural place for a rearrangement
to happen, and the existing comment at the window layer says as much: *"the
rearrangement happens inside the churn."*

**Reduced motion is already wired.** `reduceMotion` exists, tracks
`prefers-reduced-motion`, and already collapses the text churn to an instant
swap. Position animation must respect the same flag — that is a hook, not new
work.

---

## The hazards — these are the real content of this note

Each one is a load-bearing invariant that animating position can break.

### 1. Hit-testing and the DOM twin read the same numbers

`relayout()` writes two coordinate pairs per icon:

- `ic.pxCx` / `ic.pxCy` — CSS pixels. Used by the pointer hit-test **and** to
  position `#nl-keys`, the DOM twin that carries keyboard and screen-reader
  semantics.
- `ic.cx` / `ic.cy` — clip space. Used by the shader.

The existing comment states the invariant plainly: *"All geometry comes from
`relayout()`'s output — the same numbers the pointer hit-test uses — so the two
paths cannot disagree about where an icon is."*

Animating position puts that invariant at risk. **Decide deliberately:** does
the hit target follow the icon mid-flight, or does the grid stop accepting
input during a rearrangement? A moving hit target that lags what is drawn is
the worst outcome — taps land on the wrong project.

Recommended default, unless a reason appears to prefer otherwise: **input is
inert during the rearrangement**, matching the existing contact lock, which
already makes the grid inert during a transition. Simple, honest, no
disagreement possible.

**RESOLVED — took the recommended default.** `gridInert()` in `index.html`.
Displacement is a draw-time offset; nothing writes into `pxCx` / `pxCy` /
`cx` / `cy`, so `relayout()` is still the only thing that says where an icon
*is*, and the two paths cannot disagree because input is refused outright.

The important part is the *extent* of the lock. `gSwapTo` covers only the
0.12s churn-out; the icons keep travelling through the 0.80s re-form after
it, and the old guard let taps through during exactly that window — landing
on the project that would *end up* there. `gridInert()` is
`gSwapTo !== null || moveActive`, and `moveActive` clears only when the last
icon has settled. Applied to all three input paths that shared the old
`gSwapTo` test: pointer, `onKeyNav`, and the `#nl-keys` click handler.

The footer is deliberately *not* covered — `switchSection()` keeps its own
`gSwapTo` guard, so a second section tap during the re-form still lands.
Only the things actually moving stop accepting input.

### 2. `relayout()` runs on resize and will fight an in-flight animation

`relayout()` recomputes every position from scratch. A resize (or a phone
rotation, which is the likely real case) part-way through a rearrangement will
overwrite the animation's current values. Either cancel the animation and snap
to the settled layout, or re-target it. It cannot be ignored.

**RESOLVED — neither, structurally.** The framing above assumed the animation
would own absolute positions and therefore have to fight `relayout()` for
them. It doesn't. Displacement is stored as an **offset from the resting
cell**, so `relayout()` moves the rest *under* an in-flight animation and the
icon simply keeps converging on the new grid. Nothing to cancel, nothing to
re-target.

Amplitude is in **cell widths**, not pixels, which finishes the job: a resize
that changes the cell rescales the offset with it instead of leaving a stale
pixel count. Verified by resizing the viewport mid-flight — the icons land
correctly and the input lock does not jam.

### 3. The no-WebGL path cannot have this

When WebGL is unavailable, `#nl-keys` **becomes the visible menu** — the icons
are not drawn at all. There is no animation to run. This must degrade to the
existing instant swap, and `boot()` must still never return early.

**RESOLVED**, with a trap worth recording. `armGridMotion()` returns early when
`!gl` — but it must *zero the offsets*, not merely return. Two reasons, and
the second is the sharp one:

1. A set left displaced by an earlier swap would otherwise stay displaced.
2. **`moveActive` would be set with nothing able to clear it.** The settle
   check that clears the lock lives inside `frame()`'s `if (gl)` block, so
   without a shader it never runs — arming the flag would make the fallback
   menu permanently inert. A degrade path silently disabling the menu is
   precisely the failure the no-WebGL work exists to prevent.

Same handling for `prefers-reduced-motion`, including when the preference
flips *mid-flight*: the media-query listener calls `cancelGridMotion()`, which
snaps the icons home and lifts the lock with them, rather than leaving the
grid inert waiting on an ease that no longer runs. Both paths verified in a
browser (`?nogl`, and an emulated reduce preference): the grid still selects
immediately after a section switch in each.

### 4. "Exactly one thing is coherent at any moment"

A rearrangement is a moment with no selection. What is coherent while
everything is moving? The footer label is the existing answer for fixtures and
is probably the answer here too — but it is a decision, and the rule is
explicit enough in `CLAUDE.md` that breaking it silently would be a
regression.

**RESOLVED — no change needed; the existing behaviour was already right.**
`switchSection()` already clears `selected` and `fixture` and calls
`updateNav()`, so the footer label is the coherent thing for the whole
transition. Motion doesn't touch selection state. Recorded rather than
changed, so the next session doesn't re-open it.

### 5. The taskbar rule still applies

Icons are a fixed 50 CSS px and only the count adapts. A rearrangement changes
*where* icons are, never *how big*. Scaling icons as part of the motion would
break the rule that governs the whole layout.

**RESPECTED** — `uScale` is untouched; only `uTranslate` changes.

But the rule bites in an unexpected place, and this is the most useful thing
found this session. **The canvas hugs the grid with exactly one margin**, so
there is very little room to move *into*. The headroom before an icon runs off
the canvas edge is:

```
MARGIN_RATIO / (1 - GAP_RATIO)  =  0.20 / 0.80  =  0.25 cells
```

in every direction and at every size — when the `GRID_MAX_FRAC` cap shrinks
the canvas it scales pitch, cell and margin together, so the ratio is
invariant. (A second reason to hold amplitude in cell widths: the limit
travels with it.)

This was measured, not assumed. The first amplitude tried, 0.55 cells, clipped
hard against the canvas edge at the peak of the churn. It now sits at **0.22**.

**This is a real constraint on step 4.** A quarter of a cell is enough to read
as travel but not enough for a *reorganisation* worth the name. Any arrangement
that moves icons meaningfully needs one of:

- a per-icon clamp (edge icons travel less than middle ones),
- displacement biased *inward*, which has room but piles icons up at the
  centre,
- or a canvas with slack in it — which is a layout change, and would have to
  argue with the taskbar rule and the seam rule first.

Not decided here. Whichever it is, it belongs to the arrangement design.

---

## The open question worth deciding early

`CLAUDE.md` rejects anime.js with a specific carve-out:

> Only justifies itself for orchestration, timelines, stagger, or spring
> physics. For a single fixed-curve transition it equals a CSS transition.

**A staggered reorganization of ~13 icons is precisely that carve-out.** This
is the one change in the project that could legitimately reopen that decision.

Against it: the top of `CLAUDE.md` is unambiguous that the *shipped* file has
zero runtime dependencies, and a second request needs to clear a high bar.
`build.js` was exempted because its output is still one file; an animation
library would not be — it would ship.

Not resolved here on purpose. Try it hand-rolled first: the per-icon state and
easing idiom already in the file may well be enough, and the honest test of
"does a library justify itself" is having felt the absence. Record the answer
here when it is known.

**ANSWERED FOR THE MECHANISM: no library. Keep the rejection.**

The hand-rolled version was written and the absence was not felt. Concretely,
stagger — the strongest item in the carve-out — cost three lines:

```js
if (ic.moveDelay > 0) ic.moveDelay = Math.max(0, ic.moveDelay - dt);
else if (ic.move < ic.moveTarget) ic.move = Math.min(ic.moveTarget, ic.move + dt / ON_TIME);
else if (ic.move > ic.moveTarget) ic.move = Math.max(ic.moveTarget, ic.move - dt / OFF_TIME);
```

That is a per-icon delay counter bolted onto the `mix` / `still` idiom already
in the file, and it *is* stagger. There is no timeline to orchestrate: the
whole transition is one churn with a known start, and the icons are already
independent state machines advanced by `dt` in a loop that has to run anyway
for the shader. A library would replace three lines and take over a clock the
render loop already owns.

One asymmetry worth keeping: **stagger is on the return only.** The way out is
`ON_TIME` (0.12s) and has no room to spread; the way back is `OFF_TIME` (0.80s)
and does. The set leaves together and settles raggedly.

Caveat on the scope of this answer: it covers the *mechanism*. If step 4's
arrangement turns out to need genuinely sequenced motion — several phases with
dependencies between them, rather than one displacement per icon — the question
is open again. Nothing found so far suggests it will.

---

## Order of work

1. ~~Move icons to a target with no reorganization — same grid, small offsets —
   purely to prove the per-frame position write works and feels right.~~
   **Done.** Verified in a browser, not asserted: the drawn ink spreads from
   405px wide at rest to 592px at the peak of the churn and returns to 406px.
2. ~~Decide the input question (hazard 1) and implement the lock.~~ **Done** —
   inert during the whole motion, `gridInert()`.
3. ~~Handle resize (hazard 2) and reduced motion.~~ **Done** — resize by
   construction (offsets from rest, in cell units); reduced motion and no-GL
   both zero the offsets and never arm the lock.
4. Only then design what the new arrangement actually *is* — this is the
   design problem, and it is separate from the mechanism. **Still open, and
   deliberately so.** What ships today is a placeholder: radial-from-centre
   with a random jitter and a random per-icon return delay, chosen so the
   mechanism is legible while being watched. It is motion, not yet a
   rearrangement — every icon returns to the cell it left, so the grid does
   not actually reorganise. Read hazard 5 before designing: the 0.25-cell
   headroom is the binding constraint.

Steps 1–3 are mechanism and are answerable in code. Step 4 is the piece of
work, and should not be rushed by having built the mechanism.

---

## Status log

Append to this. Newest at the bottom.

- **Set up.** Branch, draft PR and this note created. No code written. The
  findings above come from reading `index.html`, not from implementation.

- **Mechanism built — steps 1–3.** `main` merged in first as agreed; it had not
  moved since the branch was cut, so the merge was a no-op this time.

  Displacement rides the same asymmetric clock as `mix` and `still`, on its own
  target so that **selection never moves anything** — only a section switch
  does. Out on `ON_TIME` arriving exactly as the icon set is exchanged; the new
  set arrives displaced and converges on `OFF_TIME`, staggered. New per-icon
  fields `move` / `moveTarget` / `moveDelay` / `mvx` / `mvy`; new functions
  `armGridMotion()`, `cancelGridMotion()`, `gridInert()`; three knobs in the
  config block. The prediction in the original note held: no shader change, no
  new geometry, no render-architecture change.

  All five hazards are resolved or consciously respected — see the inline
  RESOLVED notes above. The two that changed shape on contact with the code:

  - **Hazard 2 dissolved.** Storing an *offset from rest* rather than an
    absolute position means `relayout()` and the animation stop competing
    entirely. The note had framed this as a choice between cancelling and
    re-targeting; it turned out to be neither.
  - **Hazard 3 had a sharper edge than written.** Skipping the animation
    without a shader is not enough — arming `moveActive` where the settle
    check cannot run would leave the fallback menu permanently inert. Zeroing
    rather than returning is what makes it safe.

  The anime.js question is **answered for the mechanism: no.** Stagger cost
  three lines against the idiom already in the file. Written out above.

  Verified in headless Chromium against the built `dist/index.html`, not by
  inspection: taps and Enter are refused mid-rearrangement and accepted once
  settled; `?nogl` and an emulated reduced-motion preference both still select
  immediately after a switch; a viewport resize mid-flight lands correctly
  without jamming the lock; a second switch during a re-form does not strand
  the set. Ink extent measured through a full switch to confirm the icons
  actually move and return. No console errors on any path.

  **One thing got measured that changes step 4** — the canvas hugs the grid, so
  there is only 0.25 cells of headroom before icons clip at its edge. The first
  amplitude tried clipped; it is now 0.22. That ceiling is derived, invariant
  under resize, and is the real constraint on what any future arrangement can
  do. Hazard 5 has the derivation and the three ways out.

  **Still a placeholder, and the honest limit of this session:** every icon
  returns to the cell it left. This is motion, not yet reorganisation. Step 4
  is untouched on purpose.

- **Judged in the preview and switched OFF by default.** Robert's read: it
  feels clunkier than what was there before. Correct, and worth recording in
  full because it is a finding about the *design*, not a tuning failure.

  **The lock is the cost, and the lock is unavoidable.** Motion forces input
  to be refused until the icons settle — measured at roughly 1300ms after a
  section switch with `?motion`, against ~400ms without it (probe granularity
  and the window's own open animation are inside both figures; the ratio is
  the signal). Paying more than 3x the dead time on the primary navigation
  gesture, for a transition that communicates nothing new, is a straight
  regression. Any future arrangement pays this same toll, so **step 4 has to
  be worth roughly a second of inert grid** — that is now the bar, and it is a
  higher one than "does the motion look nice".

  **A placeholder that returns home is not a preview of a rearrangement.**
  Wiggling outward and coming back is a different motion from icons arriving
  at different cells. Tuning amplitude, stagger or easing cannot close that
  gap, which is why the answer was to switch it off rather than soften it.

  **Correction to the measurement in the previous entry.** The "405 → 592 →
  406" figure compared a peak measured in one section against a resting extent
  measured in another — different icon count, different canvas width — so most
  of that spread was the section change, not displacement. Comparing within a
  single section: peak 585×66 with `?motion` against 550×50 without, both
  settling to ~533×37. Displacement therefore contributes ~36×16 backing px
  across the whole set, about **11 CSS px of travel per icon**. Real, but
  jitter — which is exactly what was seen. The earlier entry overstated it.

  One flag, `GRID_MOTION`, gates the whole thing, and it gates the lock too
  because `moveActive` only ever arms inside `armGridMotion()`. Verified: with
  the flag absent the grid takes input on the old timing and the offsets are
  zero; with it present the motion and every hazard behaviour still work as
  built. Nothing was reverted — the mechanism and all five hazard resolutions
  are intact and tested, waiting on an arrangement worth showing.
