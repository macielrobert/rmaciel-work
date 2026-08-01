# Design note — the icon field (desktop-only interaction)

**Status:** built and working, with a goal. Placeholder art.
**Name is provisional.** "The field" is a placeholder until Robert names it.

Lives on `grid-motion` for now because it shares one structural piece with that
branch's step 4 (see *Why it is here* at the bottom). It moves to its own
branch when it is actually built — it is a mode change, not grid work.

---

## What this is

A desktop-only interaction that is **not a container for portfolio content**.
An interaction for its own sake — the site's one piece that is the work rather
than a way to reach the work.

From the inactive state (all menu options for the current category visible,
content window empty), a button triggers:

1. All icons churn together, on the existing churn settings.
2. The horizontal dividing line — the seam — moves up toward and off the
   screen.
3. The churning icons follow the line upward and **multiply** into a full grid
   of churning icons. They are no longer links, and no longer conceptually
   represent the icons they were derived from.
4. Clicking a churning shape **resolves** it into a geometric SVG — a different
   shape from the icon it came from. The field fills in as you click.

---

## What is specified

**Grid and icon proportions are respected.** `CELL_PX` stays 50, `GAP_RATIO`
and `MARGIN_RATIO` are unchanged, cells stay square, gaps stay uniform. The
taskbar rule holds here exactly as it holds everywhere else: things have a
fixed size, only the count adapts.

**Row count derives from available screen real estate.** This is the one
inversion. Today `resize()` runs:

```
icon count -> COLS (from width) -> ROWS = ceil(N / COLS) -> canvas -> seam
```

The field runs it the other way:

```
viewport -> COLS and ROWS (both from the fixed pitch) -> cell count
```

Same pitch, same formula, applied to *both* axes against the full viewport —
there is no seam in this mode, so "available" means the whole screen. It is
the existing `COLS` derivation with a second line, not a new layout model.

### What that produces

Pitch is `CELL_PX / (1 - GAP_RATIO)` = 62.5px; cell 50px, gap 12.5px.

| viewport | cols | rows | cells |
|---|---:|---:|---:|
| MacBook Pro 14", windowed (~1512×860) | 23 | 13 | **299** |
| MacBook Pro 14", fullscreen (1512×982) | 23 | 15 | 345 |
| 1280×800 laptop | 20 | 11 | 220 |
| 1920×1080 desktop | 30 | 15 | 450 |
| 2560×1440 desktop | 40 | 21 | **840** |

**The "6 rows" of the original description becomes 13–15 at these
proportions.** That is the direct consequence of holding the cell fixed and
deriving the count, and it is the specified behaviour — recorded here so the
density is not a surprise later. The field is denser and finer than the
first sketch of it.

---

## The open technical question: draw calls

Today the render loop issues one draw call per icon — 14 of them — with a
uniform update and a texture bind each. Nothing batches. That property is what
made the grid-motion work free, and it is the same property that makes this
mode expensive:

- 14 icons today
- ~300 cells on Robert's laptop
- ~840 cells on a 2560-wide display

At 840 that is roughly 6,000 GL calls per frame, ~360k/sec at 60fps. Fill rate
is the smaller worry (`RENDER_SCALE_MAX` caps at 2×, so ~8M fragments/frame of
simplex noise at the top end) — **driver overhead from the call count is the
thing to watch.**

**Not measured, and cannot be measured here.** The only GPU available in this
environment is a software rasteriser, whose numbers would say nothing about an
M2 Max. This needs a real machine. Do not take a number from a headless run.

**The escape hatch, if it is needed:** WebGL2 has instancing natively
(`drawArraysInstanced`), which collapses the whole field to one draw call with
per-cell attributes. That would be the first genuine render-architecture change
in this file, so it should be reached for only if measurement demands it —
measure first, on hardware.

---

## Open questions — not decided

1. **The trigger.** Where the button lives, what it looks like, whether it
   reads as part of the site or as a door out of it.
2. **The exit.** Unspecified. Needs an answer that a keyboard can reach.
3. **The shapes.** A set of geometric SVGs, repeated across the field — how
   many distinct forms, and how they are assigned to cells. Alpha is the
   shape, same as every other icon: transparent source with real counterforms.
4. ~~**Whether resolved shapes can un-resolve**, and whether the field has a
   completed state.~~ **Answered — see the status log.** Yes to both: a click
   puts a cell back, a budget evicts the oldest, and finding the needle
   resolves the whole field for a few seconds.
5. **The desktop gate.** Cleanest available signal is WebGL present +
   `(hover: hover)` + a minimum width. `(hover: hover)` already has precedent
   in the stylesheet.

---

## Rules this mode deliberately suspends

Both are load-bearing in `CLAUDE.md`, and both stop applying the moment the
seam leaves the screen — because at that moment this is no longer the
portfolio. Written down as intentional so they are not "fixed" later.

- **"The seam follows the menu."** There is no menu and no seam here.
- **"Exactly one thing is coherent at any moment."** The field *accumulates*
  coherence — every click resolves another shape and they stay resolved. That
  inversion of the site's central grammar reads as the point of the piece
  rather than a violation of it.

Two rules that do **not** get suspended:

- **The taskbar rule** — explicitly confirmed above.
- **`boot()` never returns early / every degrade path warns.** No shader, no
  field, and the trigger should not be offered.

Under `prefers-reduced-motion` the button should not be offered at all. A
reduced-motion version of a motion piece is worse than its absence.

---

## The accessibility half of "no longer links"

`#nl-keys` is not decoration — it is the real menu for a keyboard and a screen
reader, one focusable span per icon. In this mode the cells are not links, so
that layer has to stand down, and the field needs its own reachable exit.
Otherwise a keyboard user can enter and cannot leave.

Whether the resolvable cells are themselves reachable by keyboard, or whether
the field is announced as a single non-interactive region with an exit, is
part of open question 2.

---

## Why it is here

The field needs a canvas sized to the **viewport**, with the count derived from
it. `grid-motion`'s step 4 needs the same thing for a different reason: the
canvas currently hugs the grid with exactly one margin, which leaves only 0.25
cells of headroom before icons clip at the edge (see hazard 5 in
`NOTES-GRID-MOTION.md`). That headroom is the binding constraint on any real
rearrangement.

**One piece of work unblocks both**, which is the only reason this note is on
this branch. Doing step 4 first would build a narrower version of the same
sizing and then replace it.

---

## Status log

Append to this. Newest at the bottom.

- **Specified.** Proportions and the row-count rule fixed by Robert. The
  consequences table above was computed from the real constants, not
  estimated. Everything under *Open questions* is still open. No code written.

- **Built, first pass.** The whole described interaction runs: the button
  churns the menu out, the seam travels up and off the top on a 900ms CSS
  transition, the cell set is exchanged at the churn midpoint (noise to noise,
  so 14 icons becoming 286 cells is never seen to happen), and a click
  resolves a cell into a geometric form. Escape or the button exits and the
  menu comes back.

  **Defaults taken rather than asked**, all easy to change:

  - **Placeholder art** — 13 forms drawn in code (disc, ring, square, frame,
    triangle, hexagon, hexframe, diamond, cross, chevron, half, quarter,
    bars), through the same bake and upload path as the icons. Real drawings
    drop in by replacing `FIELD_FORMS`; nothing downstream cares which.
  - **The control** is a small diamond at the right end of the footer strip.
    In the field the section links hide and it becomes the way out.
  - **Entry is restricted to the inactive state** — nothing selected, no
    fixture open, no section swap in flight — which is what was described.

  **Two bugs found by driving it in a browser, not by reading it:**

  1. **Rows were derived from the raw viewport height**, but the canvas is
     anchored above the footer reserve. The field overfilled by about half a
     row and the top row clipped off the screen. Rows now come off
     `height - FOOTER_RESERVE`, which is the honest reading of "available
     screen real estate".
  2. **The seam's transition window was armed at the click**, but the height
     does not move until the cell set is exchanged one churn later. On a slow
     first frame the window expired before the height ever changed and the
     seam jumped instead of travelling. It is now armed where the height
     actually moves, and deliberately NOT armed when a window resize changes
     it — otherwise the seam chases a drag 900ms behind the pointer.

  **Verified in a browser:** the seam reaches full height and returns; the
  canvas grows and fits inside the stage without clipping; `#nl-keys` empties
  on entry and is rebuilt on exit; the section links hide and come back; the
  menu still selects normally after a round trip; clicks resolve cells; no
  console errors on any path. All five gates hold — the button appears on a
  wide desktop with a pointer and is absent on a narrow window, without WebGL,
  under `prefers-reduced-motion`, and on a touch device.

  At 1400x900 the field is **22 x 13 = 286 cells**, matching the predicted
  arithmetic.

  **Still open:** everything under *Open questions* except the trigger and the
  exit. Resolved cells cannot currently be un-resolved and there is no
  completed state. Performance is unmeasured — see the draw-call section; that
  still needs real hardware.

- **Resolved into an exercise.** Robert's read of the first pass: it feels like
  the start of a puzzle or a needle-in-a-haystack search, but with no goal. He
  asked for it to become a UX exercise and skipped the direction question, so
  the call was made and is recorded here.

  **The diagnosis:** the field was already a search — every cell looks
  identical until clicked, so clicking is sampling hidden information. What it
  lacked was not a theme but a **constraint**. With ~300 cells and free clicks
  there is nothing at stake; you resolve all of them and stop.

  **The budget.** Only twelve cells may be coherent at once; resolve a
  thirteenth and the oldest dissolves back into the churn. This does not break
  the site's central rule, it *generalises* it — the portfolio says exactly one
  thing is coherent at a time, the field says exactly twelve, same grammar with
  a different number. The consequence is the point: the field is larger than
  the attention it allows, so it forgets behind you and searching it becomes a
  real activity rather than a completionist sweep.

  **The needle, found by looking.** One cell churns quieter and slower than its
  neighbours — `calm` scales the existing amplitude and speed rather than
  adding a tell of its own, so it is perceptible to attention and invisible to
  a glance. That is the site's whole thesis (noise resolves into form under
  attention) turned into an interaction. Resolve it and it is exempt from the
  budget and never dissolves: one permanent mark on a surface that forgets
  everything else.

  **The payoff.** Finding it resolves the ENTIRE field at once. For a few
  seconds the whole array is legible — the only time it ever is — and then
  everything dissolves back except the cell that was found.

  **A real flaw the reveal exposed immediately.** Shapes were assigned by
  `i % forms`, which tiles: the first reveal came out as regular diagonal
  stripes and read as wallpaper, throwing away the one moment the field is
  worth looking at. Assignment is now random, and the needle carries a
  compound form (`target`) held back from the pool so the cell you found is
  visibly singular among the simple ones. This is the kind of thing that only
  shows up by running it.

  **Verified in a browser:** twenty clicks leave exactly twelve shapes on
  screen, the eight oldest having dissolved; clicking a resolved cell returns
  it, swapping its texture under the noise so the change is never seen;
  clicking every cell reaches the needle and resolves all 286 at once, then
  settles back. No console errors.

  **Tuning knobs, all in the config block:** `FIELD_BUDGET` (12),
  `FIELD_CALM_AMP` / `FIELD_CALM_SPD` (how much quieter the needle is — the
  failure mode to avoid is a cell that announces itself), `FIELD_REVEAL` (2.6s).

  **Still open:** the keyboard cannot resolve cells — the field is
  pointer-only, with the exit reachable. Whether that is acceptable or the
  cells need to be focusable is the remaining accessibility question.
