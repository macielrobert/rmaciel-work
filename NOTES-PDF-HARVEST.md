# Design note — harvesting the 2025 PDF portfolio

**Branch:** `portfolio-pdf-migration` · **Status:** in progress — nothing harvested yet

What to pull out of `RMaciel_Portfolio_2025.pdf` (44 spreads), project by project,
and where each piece lands in the CMS.

**This is a harvest list, not a port.** The PDF's page design does not come
across — it was a container built for a codex. The assets and the structure do.

---

## Read this part first

### The five rules that apply to everything below

1. **Nothing is exported from the PDF.** Every asset comes from the source —
   Rhino, Illustrator, the original render, the original photograph. The PDF is
   the index that tells you which source files matter.

2. **No type burned into any image.** No titles, no taglines, no title block, no
   page number, no `© Robert Maciel 2024`. Every one of those has a field in
   the CMS. An image that contains its own caption can't be recaptioned, can't
   be read by anything, and can't follow the site's typeface.

3. **One drawing per file.** The PDF sheets carry three to five views each
   because a bound page is expensive and a scroll is not. p39 puts five
   assembly diagrams in a row 200px tall; split apart, each is legible. This is
   the single highest-value change and it applies to every drawing sheet.

4. **Callout text becomes the `caption` field.** This is the answer to "the
   annotations are too small to read." Leader lines and dimension strings stay
   in the drawing; the sentence they point at moves to the caption, where it is
   real text in the site's face. `Detail 2.1A — bushings, Shore 80A. Allows the
   seatback to tilt; seatback moves with user.`

5. **Leave `wordmark` empty.** With no wordmark, the first image in `images`
   automatically becomes the hero and is drawn *contained, unmasked* — a
   photograph reads as itself. Filling `wordmark` masks the file to ink, which
   is right for a logotype and wrong for everything in this PDF.

### Field map

The CMS fields, and what goes in each. Schema is `keystatic.config.tsx`.

| Field | Holds | From the PDF |
|---|---|---|
| `title` | Window header | The project name |
| `details[]` | Short lines under the header | Client / venue / materials / dimensions / year |
| `summary` | Body copy | Brief + Challenge + any essay |
| `images[]` | `src` + `alt` + `caption` | Hero first, then drawings |
| `layout` | `standard` / `grid` / `text` | Almost always `standard` — see below |
| `share_description` | Link previews | The Brief line, plain |
| `order` | Position in the icon grid | Currently `10` on all 18 — arbitrary |

### Layout: use `standard` unless the images are many-of-a-kind

`grid` crops every cell to fill at 16:9. That is correct for a wall of similar
objects and destructive for a drawing — it will cut the callouts off the edges.
Only **Vessels**, **Posters**, **Drawings**, and **Daily Shapes** are grid
candidates.

Two mechanical notes if you do use `grid`:

- **Tick "Allow image expand" explicitly.** It defaults *on* for standard but
  *off* for grid (`en.expand = ... : (en.layout !== 'grid')`). A cropped
  thumbnail that opens to the whole uncropped image is fine; a cropped
  thumbnail that opens to nothing is not.
- **There is no hero slot in grid.** `#nl-mark` is excluded from `.l-grid`. If
  one image deserves to lead, the entry wants `standard`.

### Promote "Challenge" to body copy

It's the best writing in the document and it's set in 8pt grey below the fold on
every dayjob page. *"A budget so big we couldn't say 'no' to any changes."*
*"Incorporate accessible desiccant, ballast chambers without visible access
panels."* *"No site survey."* That is the text that gets you hired.

---

## Studio projects

### 1 · Canopy — **no `.mdoc` yet**

Pages 2–5. Section `design`. The PDF's opener and one of its four best projects;
completely absent from the site.

| Page | Asset |
|---|---|
| 2 | Hero render — the piece in a daylit lobby, plants trailing |
| 3 | General dims: Top / Left / Front at 1:30, with the rainwater callouts |
| 4 | Component breakdown P1–P6 + S1, S2 — **split into 2: the parts array, the relief sections below it** |
| 5 | Exploded axon → single downspout path → elbow and tube details — **split into 3** |

- `details[]`: `A place to sit` · `2024`
- `summary`: the concept is already written on p3 — *"Rainwater pulled through
  roof, sculptural downspout directs excess waterflow to feed draping plants."*
  Add the material notes: Ø4" brass tube, 2" maple hardwood bench and table,
  indoor-tolerant vining plants.
- `layout`: `standard`

### 2 · Bus Stop

Pages 6–10. `.mdoc` exists — `section: design`, empty details, empty images.

| Page | Asset |
|---|---|
| 6 | Four renders on black, three-quarter views |
| 7 | "Times of Day" — four renders on black |
| 8 | General dims: four elevations at 1":6' + two annotated isos — **split into 2** |
| 9 | Exploded iso, fins (A)(B)(C) — the strongest Bus Stop drawing |
| 10 | Front + plan at 1":8', footprint dims, LED strip callout |

- `details[]`: `Outdoor structure for public installation` · `2023`
- `summary`: p6's line verbatim, then the materials from p8 — marble-clad wall
  (Rosso Levanto), cast concrete fins 7½" thick, tinted curved glass, LVL
  exterior shade, polished brass bench *"natural patina to accumulate"*,
  Spanish Gold marble tile 12"×12".
- `layout`: `standard`
- ⚠️ **These renders are on a black ground.** They're the one set that already
  assumes a dark page. Load p6 and p9 before deciding the dark-mode question —
  p9 is black line on white and p6 is the opposite, so this project alone shows
  you both cases.

### 3 · SP Chair

Pages 11–15. `.mdoc` exists and is the most complete entry on the site — details
and body copy already written.

| Page | Asset |
|---|---|
| 11 | Hero — three chairs, side / three-quarter / front on blue gradient |
| 12 | Exploded parts on the floor beside the assembled chair and shipping box |
| 13 | Features — two views with Detail 2.1A / 2.1B bushing callouts — **split into 3: the two views, then each detail** |
| 14 | Parts + Packaging — box iso + full component sheet — **split into 2** |
| 15 | Assembly — four numbered steps — **split into 4** |

- `details[]`: already correct — `A Serious Chair for Playful People` · `2024`
- `summary`: already written. Add p12's lines — *"At home at desks and
  worktables, studios and classrooms. For long term use and short term
  attention spans."*
- `layout`: `standard`. The assembly steps are ordered, so they want the
  carousel, not the grid.
- ⚠️ **Materials conflict.** The `.mdoc` says DLMS 3D-printed aluminium frame,
  moulded plywood seat, moulded urethane feet. p14 says 3DP 316L stainless
  frame, Ø1" tube legs (6061 aluminium *or* mild steel, TBC), injection-moulded
  feet Shore 80A. Which is current?

### 4 · Ring

Pages 16–17. `.mdoc` exists, `section: design`, already has an icon SVG.

| Page | Asset |
|---|---|
| 16 | The photograph — one of the two best pages in the document |
| 17 | Drawing sheet — **split into 3: the orthographic set, the stone detail, the wedding-band pairing** |

- `title`: consider `ENGAGEMENT RING`. The slug is frozen as `ring`, so the
  title can change freely without breaking a link.
- `details[]`: `18k gold, sapphire` · `2024`
- `summary`: *"Inspired by the wearer's affinity for swims in the ocean."* Then
  the stone: 1.4ct Umba sapphire, modified brilliant cut, odd symmetry,
  half-bezel setting. Precision faceted by Tyler Ferrari, Edmonton.
- `layout`: `standard`

### 5 · Vessels

Pages 18–19. `.mdoc` exists, `section: art`.

| Page | Asset |
|---|---|
| 18 | Two photographs — grey stoneware pair; white porcelain group. **Split into 2** |
| 19 | Photo of the grey/yellow vessel + the derivation sheet. **Split into 3: the photo, the orthographic set, the Boolean sequence** |

- `details[]`: `Stoneware, Porcelain` · `2020–2022`
- `summary`: write out the derivation, because it's the argument — cone
  intersected with a rectangular prism, layered, merged, blended surfaces,
  added base. Then the note that makes it real: *dimensions are scaled to
  account for ~10% shrinkage during firing.*
- `layout`: `grid` — you have more vessels than the PDF shows. **Tick "Allow
  image expand".**
- **p19 is the best page in the document.** Object beside the geometry that
  produced it beside the material fact that constrained it. If one page argues
  for putting drawings on the site, it's this one.

### 6 · Picnic Basket / Picnic Table

Pages 20–22. `.mdoc` exists, `section: design`.

⚠️ **Name mismatch.** The PDF calls it *Picnic Table* throughout; the site says
`PICNIC BASKET`. Same work, or two? Slug is `picnic-basket` and frozen either way.

| Page | Asset |
|---|---|
| 20 | Hero — three components lined up in a white studio |
| 21 | In-situ in the forest; the mould/formwork photo. **Split into 2** |
| 22 | The fluted sphere on the saw; the cast slab on the cart. **Split into 2** |

- `details[]`: `Hydrostone, glass fibers, concrete anchors` · `24 × 19½ × 19½" (stacked)` · `2021`
- `summary`: both essays, near-verbatim — "Reimagining an Archetype" and
  "Process + Materials". They're already good prose and need almost no editing.
  The compressive-strength comparison (10,000 psi vs ~5,000 for concrete, hence
  the glass fibre) is the kind of specific that carries.
- `layout`: `standard`

### 7 · Loveseat

Pages 23–24. `.mdoc` exists but is **`draft: true`**. The PDF gives it enough to publish.

| Page | Asset |
|---|---|
| 23 | Hero — the piece on maple against white |
| 24 | The two components separated; the assembled seat. **Split into 2** |

- `details[]`: `Plywood, dowel, glue, india ink` · `23 × 16 × 21"` · `2020`
- `summary`: "A Depiction of Mutual Support" verbatim — two components that
  assemble into a seat, but with capacity for one person, *"negating the work's
  title and challenging its metaphor, but accurately demonstrating the
  isolation of the COVID-19 pandemic."*
- `layout`: `standard`

---

## Dayjob projects → section `build`

All eight follow one pattern: **one install photograph, then the drawings.** The
fact block maps to `details[]`, Brief and Challenge to `summary`.

Set `details[]` in a consistent order across all eight so the section reads as a
body of work rather than eight unrelated entries. Suggested:
**client · venue · design firm · your role.**

### 8 · Nike: Vomero — **no `.mdoc` yet**

Pages 26–27.

- Assets: p26 install photo (mannequins, projection wall, the red Vomero
  lettering); p27 install photo at right; p27 CAD dims sheet — **split into 2**
- `details[]`: `Satis&Fy` · `NYC in-store` · `Production Design, Technical Specialist`
- `summary`: Brief — modelling, CNC prep, fabrication design. Challenge — make a
  rough 3D model buildable. Materials — HDU, wood, paint.

### 9 · Shaping the Future Through Tradition — **no `.mdoc` yet**

Pages 28–29. AMNH.

- Assets: p28 install photo (Northwest Coast Hall, the blue gallery with
  visitors at the AV stations) — strong image, and the only one for this project
- `details[]`: `American Museum of Natural History` · `Northwest Coast Hall, NYC` · `Production Design, Technical Specialist`
- `summary`: Challenge — *"AV display housing and partition wall on a shoestring
  budget with no site survey."* Materials — aluminium, MDF, MDO.
- ⚠️ Thinnest project in the document. Either find more from your files or
  consider whether it earns an icon in the grid.

### 10 · (Re)Generations — **no `.mdoc` yet**

Pages 30–31. Asia Society.

- Assets: p30 install photo (the long white plinth run with stools); p31
  sections TV1–TV4; p31 front elevation with the ballast chambers picked out;
  p31 exploded iso — **split into 3**
- `details[]`: `Asia Society, NYC` · `Agency–Agency` · `Production Design, Technical Specialist`
- `summary`: Brief — large-scale furniture build for a museum exhibition.
  Challenge — *"incorporate accessible desiccant, ballast chambers without
  visible access panels."* Materials — MDO, Medite, acrylic.

### 11 · Scaife Seating Program — **no `.mdoc` yet**

Pages 32–33. Carnegie Museum of Art.

- Naming: the PDF titles the spread by the exhibition (*Charles "Teenie" Harris
  Archive*) but the project is the *Scaife Seating Program*. Use the project as
  `title`, the exhibition as a `details[]` line.
- Assets: p32 install photo; p33 chair elevation and section; p33 modular table
  iso with the curved return; p33 joint detail — **split into 3**
- `details[]`: `Carnegie Museum of Art, Pittsburgh` · `Charles "Teenie" Harris Archive` · `Agency–Agency` · `Production Design, Technical Specialist`
- `summary`: Brief — modular suite of exhibition furniture: tables, chairs,
  benches. Challenge — structurally sound low-profile seating with tight
  tolerances; concurrent upholstery and metalwork on a short timeline.
  Materials — lasercut ½" steel, 4130 chromoly, wood, upholstery.

### 12 · Book of Hov

Pages 34–35. `.mdoc` exists.

- Assets: p34 the BPL rotunda photo — one of the best images in the document;
  p35 vitrine iso; p35 vitrine section; p35 Zone 7 dims; p35 MDO carcass iso —
  **split into 4**
- `details[]`: `Roc Nation` · `Brooklyn Public Library` · `K2 World` · `Production Design, Technical Specialist`
- `summary`: Brief — exhibition furniture and displays for a retrospective of
  Jay-Z's career. Challenge — *"an enormous exhibition on an extremely
  compressed timeline with a budget so big we couldn't say 'no' to any changes.
  The biggest project I have ever been a part of."* Materials — wood, steel,
  glass, acrylic.
- The weight tally on p35 is worth setting as its own block in the `Smaller`
  mark: ~808 lbs glass · ~205 lbs steel brackets and hardware · ~400 lbs steel
  counterweights · ~558 lbs wood · **~1,971 lbs total assembly.**

### 13 · Puma: Forever Better

Pages 36–37. `.mdoc` exists.

- Assets: p36 cover install photo; p37 install photo (the timber vitrine with
  the mannequin); p37 four shop-drawing sheets — **these are four separate
  sheets already, export at full size, not as the thumbnail grid**
- `details[]`: `Puma` · `5th Ave Flagship, NYC` · `Faculty` · `Production Design, Technical Specialist`
- `summary`: Brief — fabricate a fine-furniture-grade retail installation.
  Challenge — a modular furniture system from FSC-certified sustainable
  materials, assembled onsite with limited load-in access. Materials — wood,
  steel, aluminium, recycled rubber.

### 14 · The Calculated Curve — **no `.mdoc` yet**

Pages 38–40. The Met, American Wing.

- Assets: p38 cover install photo; p39 the large exploded platform iso; p39 five
  assembly diagrams — **split into 5**; p40 steel plan; p40 front; p40 iso and
  iso btm; p40 exploded — **split into 4**
- `details[]`: `The Metropolitan Museum of Art` · `The American Wing` · `Production Design, Technical Specialist`
- `summary`: Brief — a permanent gallery installation. Challenge — *"develop,
  oversee production for 25 painted wood platforms, 13 steel plate platforms,
  each assembly weighing 500–1000 lbs."* Materials — wood, steel. p40 adds the
  engineering note: estimated weight 530 lbs, nominal tensile strength ~60 kpsi
  for mild steel, 120 kpsi for the mounting bolts.
- Most drawings of any project here. Best test of the one-drawing-per-file rule.

### 15 · Karl Lagerfeld: A Line of Beauty

Pages 41–43. `.mdoc` exists as `a-line-of-beauty`.

- Assets: p41 the Costume Institute install photo; p43 the dark phone-pedestal
  install photo — **the best image in the dayjob section**; p43 pedestal
  drawing set — **split into 3: the two isos, the top and detail, the elevations**
- `details[]`: `The Metropolitan Museum of Art` · `The Costume Institute` · `Architect: Tadao Ando · Design: SAT3` · `Technical Specialist`
- `summary`: Brief — develop production and install methods for Met Gala
  exhibition platforms and plinths. Challenge — integrate seamlessly with
  installed work by others; develop a functional pedestal as exhibition focal
  point. Materials — wood, steel, aluminium, PLA.
- The finish callouts on p43 are the good detail: body and lid to match
  Benjamin Moore OC-17, etched text to match BM 1603 Graphite, Valspar
  Automotive #18S6406, bullet catch securing a lid that pivots to reveal
  concealed battery storage.

---

## Not in the PDF

Nine site entries have no PDF source and need assets from elsewhere:

`lexus-on` · `light-work` · `maria-nila` · `daily-shapes` · `drawings` ·
`noise` · `posters` · `toner` · `west-of-the-sierras`

`light-work` already has full body copy and `details[]` — it needs only images.
The four art entries (`daily-shapes`, `drawings`, `posters`, plus `vessels`) are
the `grid` layout's real constituency.

---

## What to leave behind, and why

| In the PDF | Why it doesn't come across |
|---|---|
| The title block on ~10 pages | It's from a shop-drawing template, where a sheet leaves the office alone and must self-identify. Inside a bound document it repeats your email nine times. The site's CONTACT fixture and the URL already do this job |
| The dotted square grid beside it | Not a legend, not a key, not a scale. It filled a gap |
| Page numbers, `Version: 9/4/2024`, `©` | The site's routing, git history, and copyright line |
| Both contents pages (1, 25) | The icon grid is the contents page |
| "Section 1: Studio / Section 2: Dayjob" | BUILD / DESIGN / ART already splits this better, and "dayjob" undersells the Met, Asia Society, Carnegie and BPL |
| The white type dropped on the cover photos | The weakest convention in the document — it lands in busy tile on p28 and collides with the platform edge on p41 — and it's the `title` field's job anyway |
| Four typefaces | The site has one, deliberately |

---

## Order of work

1. **One project end to end first, as a test.** Use **Ring** — five images, short
   copy, already has an icon. It tells you whether the export settings and the
   caption convention hold before you do it fourteen more times.
2. Then **Vessels**, because p19 is the argument for the whole approach and the
   grid layout needs proving.
3. Then the five projects with no `.mdoc` at all: Canopy, Nike, AMNH, Asia
   Society, Carnegie. These are pure gain — the site currently doesn't know
   they exist.
4. Then fill in the ten that have entries but no images.
5. Set `order` deliberately while you're in there. All eighteen are `10`, so the
   grid order is currently whatever the sort happened to produce.

**Regenerate the PDF from the site once this is done**, rather than maintaining
two designs. One voice, one place to edit. Maintaining them separately is how
the current document ended up with five typefaces.
