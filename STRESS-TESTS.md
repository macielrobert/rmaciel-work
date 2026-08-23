# SVG Noise Lab — Stress Test Log

Running list. One section per closed debt item. Items marked **[capability]**
test something that can genuinely fail on a visitor's device; the rest are
visual or behavioural confirmation.

## Where these can be run

The Claude artifact preview is a **sandboxed iframe with no address bar**.
That makes a whole class of these untestable there — not "harder", impossible:

| Needs | Why the preview can't do it |
|---|---|
| `?nogl` fallback | no way to set a query string |
| Any deep link | no way to enter a URL |
| Back / forward button | no address bar, no session history |
| iOS edge-swipe back | same |
| `document.title` | not displayed |
| Console warnings | not reachable |
| Real WebGL failure | can't change browser flags |

Everything else — layout, spacing, churn, keyboard nav, window behaviour,
theme, the measure — previews fine.

**Implication for sequencing:** roughly half of the closed debt can only be
verified on a real URL. That is an argument for deploying earlier rather than
later, even to a throwaway subdomain — the host decision (items 7 and 8)
unblocks testing, not just launch.

---

## Measure cap — text column width (v70 / v71 / v74 / v75)

Mostly visual, but it produced a real bug, so it earns tests.

- [ ] A **one-line `summary`** and a **60-character `title`** in every layout,
      both orientations. This is the shrink-to-fit class of bug; medium-length
      placeholder copy hides it completely.
- [ ] Drag a desktop window slowly through the point where **width passes
      height** (the portrait→landscape flip). Nothing should jump or re-flow.
- [ ] Browser **zoom to 200%** — `ch` should scale with it, character count
      should hold.
- [ ] Contact form at 390 / 844 / 1512 / 2560 px — fields fill to the form
      measure and stop.

---

## Grid keyboard navigation (v72)

- [ ] Chrome. (Safari needs *Settings → Advanced → Press Tab to highlight each
      item* — without it this will look broken when it isn't.)
- [ ] Tab in, arrow around, Tab out to the footer. Must **never trap focus**.
- [ ] Arrow **past the first and last item** — should clamp, not wrap.
- [ ] Enter on an already-open project **closes** it.
- [ ] Enter **while the contact form is open** must do nothing (matches the
      pointer locks).
- [ ] Use a footer section link while focused in the grid — focus must survive
      (the layer no longer rebuilds; one row holds every section).
- [ ] Rotate the device with the grid focused; focus targets must follow the
      new geometry.
- [ ] **VoiceOver:** 13 options, correct titles, selected state announced.
- [ ] **VoiceOver:** confirm window copy reads as words, not letter-by-letter
      (the `spanify` per-character wrapping). *Also debt item 10.*

---

## The band (ALL / BUILD / DESIGN / ART as ink)

- [ ] Load the site cold: ALL is lit and every icon is ink.
- [ ] Tap a section, then scroll to its far edge — the change from ink to
      accent grey must land exactly on the section boundary, in BOTH themes.
- [ ] Keep scrolling until none of that section is on screen: the footer must
      fall back to ALL and the row return to ink, and the URL must change by
      REPLACE — check the back button still goes where it did.
- [ ] ALL must not move the row. It lights everything where you are standing.
- [ ] Band a section, then tap an ACCENTED icon: the whole row returns to ink
      and the footer to ALL, while that project opens. Tapping an ink one
      inside the band leaves the band alone.
- [ ] The same from the keyboard (arrow onto a dimmed icon, Enter) and from a
      deep link — all three go through commit(), so all three must agree.
- [ ] Deep-link `#design` and `#all`. Both must paint the band on the first
      frame — this is the path that skips commit().
- [ ] `?nogl`: the same three levels in type — ink for the open one, accent for
      the band, accent-dim for the rest.
- [ ] The footer at 320px wide. Six labels now; confirm the row still clears
      the viewport and the tighter tracking is still readable.

## The menu row is a ring

- [ ] Swipe (or wheel) past the last ART icon — BUILD follows on, with an even
      gap, and it keeps going. There must be no end, no bounce, and no seam
      where the row joins itself.
- [ ] On a screen WIDER than the whole row, confirm the row fills the width and
      repeats, and that BUILD / DESIGN / ART each still land their first icon at
      the left margin. This is the case the ring exists for.
- [ ] On that same wide screen, open a project whose icon is visible TWICE —
      both copies must freeze together, and tapping either must open it.
- [ ] A footer link from the far side of the row must take the SHORT way round.
- [ ] The icon a footer link lands on must arrive at FULL ink, not part-way
      through the edge dissolve (`ROW_SNAP_INSET`). Check it at several widths
      — the ramp is one pitch wide wherever the pitch ends up.
- [ ] The icon BEFORE it — the last of the previous section — should be half
      there, trailing off the left edge. That half-visibility is the indent
      doing its job, not the fade failing to.
- [ ] The same for scroll-into-view, which uses the same inset: deep-link a
      project, and arrow across the row until icons are pulled in from the
      right. Both edges, same clearance.
- [ ] Load a deep link (`#art`, and `#build/vca`). The row must already be in
      place on the first frame — no travel, no bounce.
- [ ] Rotate the phone mid-flick and mid-jump; nothing should fight itself.
- [ ] Enter the field and wheel over it — the field is a grid, not a ring, and
      must not scroll.

## Vertical copyright (v73)

- [ ] A deliberately **long copyright string** on a short landscape phone —
      does it run off the top of the content half?
- [ ] Light mode.
- [ ] iOS with the home indicator present (safe-area interaction).
- [ ] With a project window open — the line and the window's right edge are
      adjacent strips; confirm they don't read as colliding.

---

## No-WebGL fallback (v76 / v77 / v78) **[capability]**

The one that most needs stressing.

- [ ] `?nogl` on **phone portrait, phone landscape, tablet, desktop**. Seam
      must sit tight under the titles in all four — no dead space.
- [ ] With no shader, confirm every path still works: all three sections,
      ABOUT, CONTACT, the form, opening a project, image expand, the read-more
      caret, theme switch.
- [ ] Keyboard navigation in fallback mode.
- [ ] Temporarily set `CONTENT` to **~40 projects**; confirm the list scrolls
      inside its own half (GRID_MAX_FRAC) instead of eating the window.
- [ ] **Real capability test**, not the flag: Firefox with
      `webgl.disabled=true` in `about:config`, or Chrome with hardware
      acceleration switched off. Confirm the console warning names the reason.
- [ ] Confirm the shader build is **not** degrading silently — on a normal
      load the console should be clean.
- [ ] Old Android via BrowserStack if available (the real-world case).

---

## Deep links and history (v79) **[capability-adjacent]**

- [ ] Paste each URL shape cold into a new tab: `#build`,
      `#build/vessel-series`, `#build/vessel-series/2`, `#about`, `#contact`.
      Each must land in the right state with the right window open.
- [ ] **Malformed / stale hashes** must fall back to rest, never a broken
      state: `#nonsense`, `#build/deleted-project`, `#build/vessel-series/99`,
      `#build/vessel-series/0`, `#///`, `#about/extra/parts`.
- [ ] **Back button ladders correctly:** expanded image → project → rest.
      Matches what Escape does.
- [ ] Back from a **deep link landing** (no prior history) exits the site
      cleanly rather than erroring.
- [ ] Forward button re-enters the state it left.
- [ ] Swipe through several images while expanded, then press back **once** —
      should close the image, not step back through every image.
- [ ] Footer section link, then back. The link scrolls the row rather than
      swapping it; `#build` / `#design` / `#art` must land that section's first
      icon at the left margin **at every width**, including one wider than the
      whole row, and must take the short way round from wherever you are.
- [ ] **Reload on a deep link** returns to the same place.
- [ ] iOS Safari **edge-swipe back gesture**, not just the button.
- [ ] Confirm URL never changes on a bare load (no `#build` appearing
      unprompted in a clean address bar).
- [ ] `document.title` updates per entry; check the browser history menu shows
      meaningful names.
- [ ] **Known accepted behaviour:** back closes the contact form and loses a
      draft. Confirm it is only *back*, and that the × / stray-tap lock still
      holds.
- [ ] Deep link into a project, then use the footer to switch sections —
      confirm no stale hash.
- [ ] Routing under `?nogl` (both systems at once).
