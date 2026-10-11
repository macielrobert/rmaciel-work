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
- [x] Arrow **past the first and last item** — should clamp, not wrap. *(UX-6, 2026-10-11)*
- [x] Enter on an already-open project **closes** it. *(UX-6, 2026-10-11)*
- [x] Enter **while the contact form is open** must do nothing (matches the
      pointer locks). *(UX-6, 2026-10-11)*
- [ ] Use a footer section link while focused in the grid — focus must survive
      (the layer no longer rebuilds; one row holds every section).
- [ ] Rotate the device with the grid focused; focus targets must follow the
      new geometry.
- [ ] **VoiceOver:** 13 options, correct titles, selected state announced.
- [ ] **VoiceOver:** confirm window copy reads as words, not letter-by-letter
      (the `spanify` per-character wrapping). *Also debt item 10.*
      **UX-6, 2026-10-11:** still open, and now likelier to matter. Chrome's
      accessibility tree has one text node PER CHARACTER in the window copy
      (3,573 spans in LIGHT WORK), even with `TEXT_CHURN` off. Needs VoiceOver
      on the iPhone. If it reads letters, the fix is to skip `spanify()` while
      `churnOff()` — which changes the AGENTS.md rule that it always runs.

---

## The band (ALL / BUILD / DESIGN / ART as ink)

- [ ] Load the site cold: ALL is lit and every icon is ink.
- [ ] Tap a section, then scroll to its far edge — the change from ink to
      accent grey must land exactly on the section boundary, in BOTH themes.
- [ ] Keep scrolling until none of that section is on screen: the footer must
      fall back to ALL and the row return to ink, and the URL must change by
      REPLACE — check the back button still goes where it did.
- [ ] ALL must not move the row. It lights everything where you are standing.
- [ ] ALL from ABOUT, from CONTACT, and from an open project: each must close
      the window AND light the row, without the row moving. ABOUT was the case
      that failed — with the band already clear there was nothing left for ALL
      to do, so it did nothing.
- [ ] ALL inside the field must do nothing at all. The footer is still live
      there, and a commit() would repaint the field's cells as menu icons.
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

## Below-the-seam exit

- [ ] With a project open, tap the empty footer strip, the band under the icon
      row, and the margins either side of it — each closes the project.
- [ ] Tap just ABOVE the seam (window, its margins, near the `←` mark): must
      NOT close. This is the misclick protection the rule was built around.
- [ ] Tap a footer LINK: it navigates, it does not merely exit.
- [x] **Contact form up: tapping below the seam must do nothing.** The `×` is
      the only exit from a half-written message. *(UX-6, 2026-10-11)* Escape too.
- [ ] Swipe the row and release over the footer — the project must survive. The
      click that follows a drag belongs to the canvas.
- [ ] With an image expanded, a below-seam tap ejects the whole thing (like the
      `×`), while Escape and `←` still pop one level.

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
- [x] Confirm the shader build is **not** degrading silently — on a normal
      load the console should be clean. *(UX-6, 2026-10-11)* Only the favicon's 404.
- [ ] Old Android via BrowserStack if available (the real-world case).

---

## Deep links and history (v79) **[capability-adjacent]**

- [ ] Paste each URL shape cold into a new tab: `#build`,
      `#build/vessel-series`, `#build/vessel-series/2`, `#about`, `#contact`.
      Each must land in the right state with the right window open.
- [x] **Malformed / stale hashes** must fall back to rest, never a broken
      state *(UX-6, 2026-10-11)* — a deleted or held-back slug lands on its section, a picture
      number out of range clamps to the first or last: `#nonsense`, `#build/deleted-project`, `#build/vessel-series/99`,
      `#build/vessel-series/0`, `#///`, `#about/extra/parts`.
- [x] **Back button ladders correctly:** expanded image → project → rest.
      Matches what Escape does. *(UX-6, 2026-10-11)*
- [ ] Back from a **deep link landing** (no prior history) exits the site
      cleanly rather than erroring.
- [x] Forward button re-enters the state it left. *(UX-6, 2026-10-11)*
- [ ] Swipe through several images while expanded, then press back **once** —
      should close the image, not step back through every image.
- [ ] Footer section link, then back. The link scrolls the row rather than
      swapping it; `#build` / `#design` / `#art` must land that section's first
      icon at the left margin **at every width**, including one wider than the
      whole row, and must take the short way round from wherever you are.
- [ ] **Reload on a deep link** returns to the same place.
- [ ] iOS Safari **edge-swipe back gesture**, not just the button.
- [x] Confirm URL never changes on a bare load (no `#build` appearing
      unprompted in a clean address bar). *(UX-6, 2026-10-11)*
- [ ] `document.title` updates per entry; check the browser history menu shows
      meaningful names.
- [ ] **Known accepted behaviour:** back closes the contact form and loses a
      draft. Confirm it is only *back*, and that the × / stray-tap lock still
      holds.
- [ ] Deep link into a project, then use the footer to switch sections —
      confirm no stale hash.
- [x] Routing under `?nogl` (both systems at once). *(UX-6, 2026-10-11)*

---

## Editor journeys — Harvest to the live site (UX-6)

**How to run them.** `tools/test-rig.sh <empty folder>` builds an isolated
copy: a clone of the site, a local bare repository standing in for GitHub, a
stand-in `gh` (`gh-mode`: `no-pr`, `no-merge`, `no-deploy` make it fail on
purpose) and a stand-in Netlify serving what merged. Nothing reaches GitHub,
Robert's working copy or his running Harvest. Source material goes in the
rig's `home/Documents` (the scratch home is the folder tree's root). The site
checks run best in headless Chrome over the DevTools protocol: the in-app
browser pauses animation frames while its pane is hidden, and the site never
finishes booting there.

Run 2026-10-11 by Claude on the `ux-6-acceptance` branch, 1024×768 unless
noted. Everything below passed after the fixes listed in `TO-DO.md`, UX-6.

- [x] **BUS STOP, one whole session.** A "Wave House" folder (a working
      title) with a HEIC photo, a crop of a site render, two new pictures and
      a .docx: crawl → 5 found → keep all → Edit groups the crop as "Same work
      as #1?" → merge → HEIC first by drag, turned → one render removed → alt
      text and a caption → the docx passage placed in the description, a
      line moved to detail lines, bold → Collection by keyboard → Editing
      preview, Desktop and Phone, Beside and Large → Save stops on the one
      work without alt text and opens it → alt added → Save asks a second
      click for the picture coming off → saved.
- [x] **Save = what the Editing preview showed.** Editing preview, Saved
      preview and a fresh `node build.js` byte-identical after Save. LIGHT
      WORK (13 new pictures, longer copy) captured BEFORE Save: identical to
      the saved build once stand-in paths map to saved ones and a picture's
      size is read as its shape (Save shrinks to 2400px; same shapes).
- [x] **Reopen.** Quit and restart Harvest: same address, Edit mode, BUS STOP,
      the saved fields, *Saved on this Mac, not published*, nothing marked
      unsaved. Unsaved fields also survive a restart (drafts).
- [x] **Source files untouched** — the material folder hashed before and
      after: identical.
- [x] **Publishing.** Pull request refused: *Nothing was published*, commit
      undone, branch deleted, files still saved. Merge refused: *Sent to
      GitHub, not merged*, pull request #1 left open. Then published: merged,
      stand-in live page byte-identical to the saved build, *Published*.
- [x] **Held back.** CANOPY held back: the Editing preview shows it and says
      so (fixed — it read only the saved flag), the review names it once,
      the live site leaves it off (`#design/canopy` lands on DESIGN).
- [x] **Sparse** (CANOPY, title only): Images says "No pictures yet…", the
      preview shows the title alone.
- [x] **Many pictures** (LIGHT WORK, 13: portrait, square, landscape,
      panorama): whole pictures at their own shapes, desktop and phone; a
      picture from the scrolled grid and back: place kept (122 → 122).
- [x] **Portrait first picture, Project layout:** desktop fine. **Phone: the
      description falls below the fold behind a tall picture; the text column
      scrolls, but nothing says it does** — open, for Robert (`TO-DO.md`).
- [x] **Long session.** 20 project switches (BUS STOP / LIGHT WORK / CANOPY /
      ABOUT): 7–42 ms each to the works drawn, always the right project. 12
      one-step moves with Later: 7–17 ms each to the grid redrawn.
- [x] **Both themes, narrow windows, keyboard:** header at 900, 1024 and 1440
      wide, light and dark — fits, Save hit-testable. Tab reaches every
      control with a visible mark; layouts move with arrow keys.
- [x] **Site regressions** on the published rig build, headless Chrome with
      WebGL: deep links and malformed hashes, back / forward ladder, image
      return, contact lock (Escape, below the seam, Enter on the menu), a tap
      inside the window keeps it, below the seam closes it, 1280×800,
      1920×1080, 375×812, 812×375, 768×1024, 320×640 (menu half 127, no
      sideways scroll), `?nogl` (warning names the reason, titles open
      projects, routing to a picture), listbox options named, the open one
      selected.
- [ ] **Not run:** VoiceOver itself, iOS edge-swipe back, a real WebGL
      failure, Harvest.app's own WebKit (the in-app browser and Chrome only),
      the real `gh` and SSH push.
