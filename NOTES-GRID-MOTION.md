# Design note — animated grid reorganization

**Branch:** `grid-motion` · **Status:** not started, nothing implemented yet

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

### 2. `relayout()` runs on resize and will fight an in-flight animation

`relayout()` recomputes every position from scratch. A resize (or a phone
rotation, which is the likely real case) part-way through a rearrangement will
overwrite the animation's current values. Either cancel the animation and snap
to the settled layout, or re-target it. It cannot be ignored.

### 3. The no-WebGL path cannot have this

When WebGL is unavailable, `#nl-keys` **becomes the visible menu** — the icons
are not drawn at all. There is no animation to run. This must degrade to the
existing instant swap, and `boot()` must still never return early.

### 4. "Exactly one thing is coherent at any moment"

A rearrangement is a moment with no selection. What is coherent while
everything is moving? The footer label is the existing answer for fixtures and
is probably the answer here too — but it is a decision, and the rule is
explicit enough in `CLAUDE.md` that breaking it silently would be a
regression.

### 5. The taskbar rule still applies

Icons are a fixed 50 CSS px and only the count adapts. A rearrangement changes
*where* icons are, never *how big*. Scaling icons as part of the motion would
break the rule that governs the whole layout.

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

---

## Order of work

1. Move icons to a target with no reorganization — same grid, small offsets —
   purely to prove the per-frame position write works and feels right.
2. Decide the input question (hazard 1) and implement the lock.
3. Handle resize (hazard 2) and reduced motion.
4. Only then design what the new arrangement actually *is* — this is the
   design problem, and it is separate from the mechanism.

Steps 1–3 are mechanism and are answerable in code. Step 4 is the piece of
work, and should not be rushed by having built the mechanism.

---

## Status log

Append to this. Newest at the bottom.

- **Set up.** Branch, draft PR and this note created. No code written. The
  findings above come from reading `index.html`, not from implementation.
