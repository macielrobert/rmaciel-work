#!/usr/bin/env node
'use strict';

/* =========================================================================
   build.js — folds content/*.json into index.html, emits dist/index.html
   =========================================================================

   WHAT THIS IS
     Decap CMS writes JSON into content/. index.html holds the site with an
     EMPTY CONTENT block. This script reads the first, serialises it into the
     second between the CONTENT:START / CONTENT:END markers, and writes the
     result to dist/. The published artifact is unchanged: one file, one
     request, everything inline.

   WHY NODE BUILT-INS ONLY
     No package.json, no install step, nothing to keep up to date. That is why
     the CMS writes JSON and not YAML or Markdown — JSON.parse ships with Node
     and a YAML parser does not. See the header of admin/config.yml.

   WHY IT FAILS LOUDLY
     A silent partial build is worse than a failed one. A missing marker, an
     unmeasurable image, or an absent required field stops the build with the
     offending FILENAME in the message. Netlify shows a red deploy rather than
     publishing a site with a hole in it.

     The split: STRUCTURE and FIELD errors fail. CONTENT-COMPLETENESS issues
     (a section with nothing published in it yet) warn on stderr and continue —
     that is a legitimate state while the site is being written, and failing on
     it would make the CMS unusable until all three sections were full.

   RUN
     node build.js            (from the repo root)
   ========================================================================= */

const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const SRC_HTML = path.join(ROOT, 'index.html');
const CONTENT_DIR = path.join(ROOT, 'content');
const PROJECTS_DIR = path.join(CONTENT_DIR, 'projects');
const IMAGES_DIR = path.join(ROOT, 'images');
const ADMIN_DIR = path.join(ROOT, 'admin');
const FONTS_DIR = path.join(ROOT, 'fonts');
const DIST     = path.join(ROOT, 'dist');

const START = '/* CONTENT:START */';
const END   = '/* CONTENT:END */';

/* THE SECTIONS ARE DEFINED HERE, NOT IN THE CMS.
   A project picks its section from a fixed list (admin/config.yml, the
   `section` select). The list itself is not editable content, because adding a
   fourth section is not a content change — the footer buttons in index.html
   are hand-written markup (`data-nav="build"` and friends) and would need a
   matching entry. Keeping the list here means the two places that must agree
   are both in the repo, not one in the repo and one in a CMS form.
   `id` must match the footer's data-nav value; `label` is what it reads. */
const SECTIONS = [
  { id: 'build',  label: 'BUILD'  },
  { id: 'design', label: 'DESIGN' },
  { id: 'art',    label: 'ART'    },
];

/* ---------------------------------------------------------------- failure */

// Every message names the file it came from. Without that the CMS user gets
// "build failed" and no way to know which of forty entries did it.
function fail(msg) {
  console.error('\nBUILD FAILED\n  ' + msg + '\n');
  process.exit(1);
}

function warn(msg) {
  console.error('  warning: ' + msg);
}

/* ------------------------------------------------------ image dimensions */

/* WHY THE HEADER AND NOT A LIBRARY
     `ratio` is required by the site (without it the page downloads every image
     at load just to measure its shape) and Decap's image widget does not
     report dimensions. An image library would be an npm dependency. But the
     dimensions are in the first few bytes of the file by specification, and
     reading them is about forty lines — so it is forty lines.

   WHAT IS MEASURED, AND WHAT IS NOT
     Only the `images` list, because that is the only place the site READS a
     ratio. Icons and wordmarks are drawn as CSS/WebGL masks at a fixed cap
     (50px cell, 320px wordmark) and their aspect never enters a layout
     calculation. That exemption is not laziness — admin/config.yml actively
     recommends SVG for marks ("transparent PNG or SVG with real
     counterforms"), and an SVG has neither an IHDR nor an SOF to read.
     Requiring a measurement there would reject the recommended format. */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf, label) {
  // 8-byte signature, then the IHDR chunk: 4-byte length, 4-byte type,
  // then width and height as big-endian uint32.
  if (buf.length < 24) fail(`${label}: too short to be a PNG (${buf.length} bytes)`);
  if (buf.slice(12, 16).toString('latin1') !== 'IHDR') {
    fail(`${label}: PNG has no IHDR chunk where the specification requires it. Re-export the file.`);
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// SOFn markers carrying a frame header. C4 (DHT), C8 (JPG) and CC (DAC) share
// the range but are NOT frame headers — reading dimensions out of them yields
// nonsense, which is why this is a list and not a range test.
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(buf, label) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    fail(`${label}: not a JPEG (missing the SOI marker)`);
  }
  let off = 2;
  while (off + 1 < buf.length) {
    if (buf[off] !== 0xff) {
      fail(`${label}: JPEG structure broken at byte ${off} — expected a marker. File is likely truncated or corrupt.`);
    }
    let marker = buf[off + 1];
    // a run of 0xFF bytes is legal padding before a marker
    while (marker === 0xff && off + 2 < buf.length) { off++; marker = buf[off + 1]; }
    off += 2;

    // standalone markers: no length, no payload
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // SOS starts entropy-coded data and EOI ends the file; a frame header
    // must have appeared before either, so reaching one means there isn't one
    if (marker === 0xda || marker === 0xd9) break;

    if (off + 2 > buf.length) fail(`${label}: JPEG segment header runs past the end of the file`);
    const len = buf.readUInt16BE(off);
    if (len < 2) fail(`${label}: JPEG segment at byte ${off} declares an impossible length (${len})`);

    if (JPEG_SOF.has(marker)) {
      // segment: 2-byte length, 1-byte sample precision, 2-byte height, 2-byte width
      if (off + 7 > buf.length) fail(`${label}: JPEG frame header is truncated`);
      return [buf.readUInt16BE(off + 5), buf.readUInt16BE(off + 3)];
    }
    off += len;
  }
  fail(`${label}: no JPEG frame header (SOFn) found — cannot determine dimensions`);
}

// Decap stores paths against `public_folder` ("/images"), while the files land
// in `media_folder` ("images") at the repo root. One is the other without the
// leading slash.
function resolveMedia(src, label) {
  if (typeof src !== 'string' || !src.trim()) fail(`${label}: image path is empty`);
  const rel = src.replace(/^\/+/, '');
  const abs = path.resolve(ROOT, rel);
  // a path that climbs out of the repo is either a mistake or an attack; the
  // build has no business reading outside its own tree either way
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    fail(`${label}: image path "${src}" resolves outside the repository`);
  }
  if (!fs.existsSync(abs)) {
    fail(`${label}: image "${src}" is referenced but does not exist at ${path.relative(ROOT, abs)}`);
  }
  return abs;
}

function measure(src, label) {
  const abs = resolveMedia(src, label);
  const ext = path.extname(abs).toLowerCase();
  const buf = fs.readFileSync(abs);
  if (ext === '.png') {
    if (!buf.slice(0, 8).equals(PNG_SIG)) fail(`${label}: "${src}" has a .png extension but is not a PNG file`);
    return pngSize(buf, `${label}: ${src}`);
  }
  if (ext === '.jpg' || ext === '.jpeg') return jpegSize(buf, `${label}: ${src}`);
  fail(
    `${label}: cannot measure "${src}" — only PNG and JPEG can be read from the file header. ` +
    `Strip images REQUIRE a ratio, so this format cannot be used there. Re-export as PNG or JPEG. ` +
    `(Icons and wordmarks are exempt and may be SVG.)`
  );
}

/* --------------------------------------------------------------- reading */

function readJSON(abs) {
  const label = path.relative(ROOT, abs);
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch (e) { fail(`${label}: cannot be read — ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { fail(`${label}: is not valid JSON — ${e.message}`); }
}

function need(obj, key, label) {
  const v = obj[key];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    fail(`${label}: required field "${key}" is missing or empty`);
  }
  return v;
}

function needList(obj, key, label) {
  const v = need(obj, key, label);
  if (!Array.isArray(v) || !v.length) fail(`${label}: "${key}" must be a non-empty list`);
  v.forEach((line, i) => {
    if (typeof line !== 'string' || !line.trim()) fail(`${label}: "${key}" entry ${i + 1} is empty`);
  });
  return v;
}

/* ------------------------------------------------------------- markdoc */

/* THE ONE DEPENDENCY, LOADED ONLY WHEN IT IS NEEDED.

   Keystatic stores rich text as Markdoc (`.mdoc`), which Node cannot parse
   alone. `@markdoc/markdoc` has ZERO runtime dependencies — one package, no
   tree — and it earns its place: parsing a real AST replaces the whole
   hand-rolled marker layer below, and unknown syntax can no longer leak
   through as literal characters.

   `require`d lazily, inside the function that needs it, so a repository with
   no `.mdoc` files still builds the entire site with node_modules deleted.
   That escape hatch is the reason for the odd shape. */
let _Markdoc = null;
function markdoc(label) {
  if (_Markdoc) return _Markdoc;
  try { _Markdoc = require('@markdoc/markdoc'); }
  catch {
    fail(`${label}: this entry stores its description as Markdoc, which needs the @markdoc/markdoc package. Run \`npm install\` before building.`);
  }
  return _Markdoc;
}

/* THE RENDER VOCABULARY — the complete list of what can reach the page.

   Each entry maps an editor button to markup index.html has a rule for. A
   button with no entry here renders NOTHING, silently, which is why the
   editor's toolbar in keystatic.config.tsx is restricted to exactly this set.
   The two files are one decision; changing either alone breaks the pair.

   The custom marks arrive as Markdoc TAGS named after their component key —
   `{% light %}…{% /light %}` — verified against Keystatic's own deserializer,
   not assumed. Their classes are the ones the site already styles. */
function markdocTags(M) {
  const wrap = (el, cls) => ({
    render: el,
    attributes: {},
    transform(node, config) {
      const attrs = cls ? { class: cls } : {};
      return new M.Tag(el, attrs, node.transformChildren(config));
    },
  });
  return {
    light:     wrap('span', 'w-l'),
    small:     wrap('span', 't-s'),
    large:     wrap('span', 't-l'),
    underline: wrap('u', null),
  };
}

/* SOFT BREAKS ARE HARD BREAKS HERE.

   Markdoc drops a single newline, joining the lines with a space — the exact
   behaviour that flattened a credit list into one running sentence under the
   previous CMS. A line typed as a line stays a line. */
function markdocNodes(M) {
  return {
    softbreak: { transform: () => new M.Tag('br') },
  };
}

function renderMarkdoc(src, label) {
  const M = markdoc(label);
  let ast;
  try { ast = M.parse(String(src)); }
  catch (e) { fail(`${label}: could not parse the description — ${e.message}`); }

  const content = M.transform(ast, { tags: markdocTags(M), nodes: markdocNodes(M) });
  let html = M.renderers.html(content);

  // the html renderer wraps everything in <article>; the window supplies its
  // own container, so unwrap rather than style a tag nothing else uses
  html = html.replace(/^\s*<article>/, '').replace(/<\/article>\s*$/, '');
  return html.trim();
}

/* ------------------------------------------------------- text formatting */

/* ESCAPE FIRST, ALWAYS.
   The site inserts body copy with innerHTML, so any `<` an author types would
   otherwise be live markup. Escaping here and emitting a FIXED set of tags
   afterwards means the vocabulary below is the complete list of what can ever
   reach the page — not the list of what is expected to. */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* THE FORMATTING VOCABULARY.

   Bold and italic are markdown, because the CMS gives them TOOLBAR BUTTONS
   and the editor writes that syntax itself — nothing to memorise.

   Underline, weight and size are bracket tags, because markdown has no
   syntax for any of them. They share one shape so there is one rule to
   remember rather than three: [name]...[/name].

   Deliberately absent: headings, lists, quotes, links, images, code. The
   markdown widget's toolbar is restricted in admin/config.yml to exactly the
   buttons supported here, so no button can produce syntax this does not
   understand. Adding one means adding both, together. */
/* DECAP ESCAPES SQUARE BRACKETS. VERIFIED, NOT ASSUMED.

   The editor's markdown serialiser treats `[` as the start of link syntax, so
   saving `[small]ARTISTS[/small]` stores `\[small]ARTISTS\[/small]`. The
   conversion below still matched, but the stray backslashes survived it and
   would have shipped as visible `\` characters on the page.

   `++underline++` came back untouched in the same save, so this is specific to
   brackets rather than to unknown syntax in general.

   Stripped rather than honoured: the author never types `\[` — the editor
   adds it — so treating it as a deliberate escape would break the tag the
   author meant. The cost is that a literal `[small]` cannot be written in
   copy, which is a sentence nobody is going to want. */
function unescapeBrackets(s) {
  return s.replace(/\\([\[\]])/g, '$1');
}

function inlineFormat(s) {
  return unescapeBrackets(s)
    // bracket tags first: their contents may themselves contain bold/italic
    .replace(/\[light\]([\s\S]+?)\[\/light\]/g, '<span class="w-l">$1</span>')
    .replace(/\[small\]([\s\S]+?)\[\/small\]/g, '<span class="t-s">$1</span>')
    .replace(/\[large\]([\s\S]+?)\[\/large\]/g, '<span class="t-l">$1</span>')
    .replace(/\+\+(?=\S)([\s\S]+?)(?<=\S)\+\+/g, '<u>$1</u>')
    // ** before *, __ before _ — otherwise the single-character rule eats the
    // first half of a double marker and the result is mismatched tags
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]+?)(?<=\S)__/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, '<em>$1</em>')
    // `_` only when it stands alone as a word boundary, so snake_case and
    // file_names in the copy are left alone
    .replace(/(^|[\s(])_(?=\S)([^_]+?)(?<=\S)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

/* PARAGRAPHS. The CMS collects one field with "blank line between paragraphs"
   in the hint. buildData() accepts a string OR a list of strings and
   normalises with paras(). Splitting here means the authoring convention is
   honoured in one place rather than depending on downstream behaviour.

   SINGLE LINE BREAKS ARE KEPT. They used to be collapsed into spaces, which
   silently destroyed any copy laid out as lines rather than prose — a credit
   list typed one name per line came out as one running sentence, with nothing
   to indicate the author's line breaks had been thrown away. A blank line
   still starts a new paragraph; a single newline is now a hard break, which is
   what typing one plainly means. */
/* PLAIN TEXT — for the fields that are NOT body copy.
   Share descriptions and the site description end up in a link preview and a
   search result, where a `<strong>` is not bold text, it is the characters
   `<strong>`. These fields collapse to one line and carry no markup at all,
   which is also why they do not get escaped: nothing here reaches innerHTML. */
function plainText(text, label) {
  if (text === undefined || text === null || !String(text).trim()) return null;
  const flat = String(text).replace(/\r\n/g, '\n').replace(/\s*\n\s*/g, ' ').trim();
  if (!flat) fail(`${label}: field is present but contains no text`);
  return flat;
}

/* HEADING LINES -> THE LARGE STEP.

   This exists so the size control can be a BUTTON rather than something the
   author has to remember. Markdown headings are the only formatting Decap's
   toolbar offers whose on-screen preview MATCHES what the site does: press
   the heading button, the editor shows bigger text, the page shows bigger
   text. Mapping some unrelated button — code, or blockquote — would have put
   a control in the toolbar that previews as one thing and ships as another,
   which is a trap rather than a feature.

   EVERY heading level maps to the SAME step, on purpose and defensively.
   There is one large size, not six, so a document cannot grow a hierarchy the
   layout has no answer for — and it means the mapping holds whichever heading
   button the CMS happens to render, which matters because the exact button
   names could not be verified against Decap's source from the build sandbox.

   Matched per LINE, not per paragraph: a heading typed among other lines in
   one block still takes effect, which is how the credit lists are written. */
function headingLines(html) {
  return html.split('\n').map(line => {
    const m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    return m ? '<span class="t-l">' + m[1].trim() + '</span>' : line;
  }).join('\n');
}

function paragraphs(text, label) {
  if (text === undefined || text === null || !String(text).trim()) return null;
  const parts = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const html = headingLines(inlineFormat(escapeHtml(s)));
      // an unclosed bracket tag is a typo the author cannot see the effect of
      // — it would ship as literal "[large]" in the middle of a sentence
      const stray = html.match(/\[\/?(?:light|small|large)\]/);
      if (stray) {
        fail(`${label}: unclosed formatting tag "${stray[0]}". Every [name] needs a matching [/name].`);
      }
      return html.replace(/\n/g, '<br>');
    });
  if (!parts.length) fail(`${label}: description is present but contains no text`);
  return parts.length === 1 ? parts[0] : parts;
}

/* ---------------------------------------------------------------- fields */

function buildIcon(p, label) {
  const kind = need(p, 'icon_type', label);
  if (kind === 'glyph') {
    const ch = need(p, 'icon_glyph', label);
    // more than one character bakes at the wrong size in the 50px cell
    if ([...String(ch)].length !== 1) {
      fail(`${label}: "icon_glyph" must be exactly one character (got ${[...String(ch)].length})`);
    }
    return { kind: 'glyph', char: String(ch) };
  }
  if (kind === 'image') {
    const src = need(p, 'icon_image', label);
    resolveMedia(src, label);   // existence is checked; dimensions are not needed
    const ext = path.extname(src).toLowerCase();
    // resolveIcon() in index.html passes 'svg' and 'png' straight through and
    // knows no other kind. JPEG is refused on top of that because alpha is the
    // shape — a JPEG mark bakes as a solid block, which is the documented
    // failure mode and worth catching here rather than on the live site.
    if (ext === '.svg') return { kind: 'svg', src };
    if (ext === '.png') return { kind: 'png', src };
    fail(
      `${label}: icon "${src}" must be .svg or .png. Alpha is the shape — a JPEG ` +
      `mark has no transparency and bakes as a solid block.`
    );
  }
  fail(`${label}: "icon_type" must be "glyph" or "image" (got "${kind}")`);
}

function buildImages(p, label) {
  const list = p.images;
  if (list === undefined || list === null) return null;          // no strip
  if (!Array.isArray(list)) fail(`${label}: "images" must be a list`);
  if (!list.length) return null;
  return list.map((im, i) => {
    const where = `${label}: image ${i + 1}`;
    if (!im || typeof im !== 'object') fail(`${where} is not an object`);
    const src = need(im, 'src', where);
    const alt = need(im, 'alt', where);
    const rec = { src, ratio: measure(src, where), alt };
    if (im.caption && String(im.caption).trim()) rec.caption = String(im.caption).trim();
    return rec;
  });
}

function buildProject(p, label) {
  const title = need(p, 'title', label);
  const slug  = need(p, 'slug', label);
  if (!/^[a-z0-9-]+$/.test(slug)) {
    fail(`${label}: "slug" must be lowercase letters, numbers and hyphens only (got "${slug}")`);
  }
  const section = need(p, 'section', label);
  if (!SECTIONS.some(s => s.id === section)) {
    fail(`${label}: unknown section "${section}" — expected one of ${SECTIONS.map(s => s.id).join(', ')}`);
  }
  if (typeof p.order !== 'number' || !Number.isFinite(p.order)) {
    fail(`${label}: required field "order" is missing or not a number`);
  }

  const out = { title, details: needList(p, 'details', label) };

  /* Markdoc from Keystatic renders to HTML; a plain string is legacy Decap
     copy and keeps the marker path until that entry is migrated. */
  const summary = (p.summary && typeof p.summary === 'object' && typeof p.summary.markdoc === 'string')
    ? (renderMarkdoc(p.summary.markdoc, label) || null)
    : paragraphs(p.summary, label);
  if (summary !== null) out.summary = summary;

  out.icon = buildIcon(p, label);

  if (p.wordmark && String(p.wordmark).trim()) {
    const src = String(p.wordmark).trim();
    resolveMedia(src, label);
    // the CMS collects no alt for the wordmark, and none is needed: it is
    // painted as a CSS mask on a div, never as an <img>. Derived so the record
    // matches the documented { src, alt } shape.
    out.wordmark = { src, alt: `${title} — wordmark` };
  }

  const images = buildImages(p, label);
  if (images) out.images = images;

  if (p.layout && p.layout !== 'standard') out.layout = p.layout;
  if (p.expand !== undefined && p.expand !== null) out.expand = !!p.expand;

  /* CARRIED, NOT YET CONSUMED. The CMS collects a per-project share
     description; the share/search metadata that will use it is still open work
     (PLAN.md, Phase 5). buildData() reads named fields and ignores the rest, so
     carrying it is inert today. Dropping it would silently discard something a
     human typed into a form, which is the worse failure. */
  const share = plainText(p.share_description, label);
  if (share !== null) out.shareDescription = Array.isArray(share) ? share[0] : share;

  // kept so the authored value survives the build; see the note in the PR /
  // README about buildData() deriving slugs from titles today
  out.slug = slug;

  return out;
}

/* ----------------------------------------------------------------- gather */

/* TWO LAYOUTS ON DISK, ON PURPOSE.

   Decap wrote one file per project — `content/projects/vessel.json` — with the
   description as a string inside it.

   Keystatic writes a FOLDER per project — `content/projects/vessel/` holding
   `index.json` for the data and `summary.mdoc` for the rich text — because the
   collection is configured `format: { data: 'json', contentField: 'summary' }`.

   Both are read here. Not indecision: it is what makes the migration
   survivable. Entries move one at a time, the site builds at every point in
   between, and nothing has to be converted in a single irreversible pass.
   When the last `.json` file is gone, the legacy branch can be deleted. */
function readProjectEntry(entry) {
  const abs = path.join(PROJECTS_DIR, entry.name);

  if (entry.isDirectory()) {
    const dataFile = path.join(abs, 'index.json');
    const label = path.relative(ROOT, dataFile);
    if (!fs.existsSync(dataFile)) {
      fail(`${path.relative(ROOT, abs)}: project folder has no index.json. Keystatic writes the entry data there.`);
    }
    const raw = readJSON(dataFile);
    const mdoc = path.join(abs, 'summary.mdoc');
    if (fs.existsSync(mdoc)) {
      raw.summary = { markdoc: fs.readFileSync(mdoc, 'utf8') };
    }
    return { raw, label, key: entry.name };
  }

  const label = path.relative(ROOT, abs);
  return { raw: readJSON(abs), label, key: entry.name };
}

function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fail(`content/projects/ does not exist. The CMS writes project files there; the repository layout is wrong.`);
  }
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() || e.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) warn('content/projects/ contains no projects — every section will be empty.');

  const kept = [];
  for (const entry of entries) {
    const { raw, label, key } = readProjectEntry(entry);
    if (raw && raw.draft === true) continue;            // held back, not published
    kept.push({ label, order: raw.order, section: raw.section, project: buildProject(raw, label), file: key });
  }
  return kept;
}

function assemble() {
  const projects = loadProjects();

  const sections = SECTIONS.map(sec => {
    const mine = projects.filter(p => p.section === sec.id)
      // ascending by order; ties resolve by filename so the build is
      // reproducible regardless of how the filesystem lists the directory
      .sort((a, b) => (a.order - b.order) || a.file.localeCompare(b.file));
    if (!mine.length) warn(`section "${sec.id}" has no published projects.`);
    return { id: sec.id, label: sec.label, projects: mine.map(p => p.project) };
  });

  const aboutFile = path.join(CONTENT_DIR, 'about.json');
  const contactFile = path.join(CONTENT_DIR, 'contact.json');
  const siteFile = path.join(CONTENT_DIR, 'site.json');
  for (const f of [aboutFile, contactFile, siteFile]) {
    if (!fs.existsSync(f)) fail(`${path.relative(ROOT, f)}: required content file is missing`);
  }

  const aboutRaw = readJSON(aboutFile);
  const aboutLabel = 'content/about.json';
  const aboutSummary = paragraphs(need(aboutRaw, 'summary', aboutLabel), aboutLabel);
  const about = {
    title:   need(aboutRaw, 'title', aboutLabel),
    details: needList(aboutRaw, 'details', aboutLabel),
    summary: aboutSummary,
  };

  const contactRaw = readJSON(contactFile);
  const contactLabel = 'content/contact.json';
  const email = String(need(contactRaw, 'email', contactLabel)).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`${contactLabel}: "${email}" is not a valid email address — it is what SEND delivers to`);
  }
  const contact = { email };
  // the contact form is hand-built outside the data contract and has no intro
  // slot yet; carried rather than discarded, same reasoning as shareDescription
  const intro = plainText(contactRaw.intro, contactLabel);
  if (intro !== null) contact.intro = intro;

  const siteRaw = readJSON(siteFile);
  const siteLabel = 'content/site.json';
  const content = {
    siteTitle: need(siteRaw, 'site_title', siteLabel),
    about,
    contact,
    copyright: need(siteRaw, 'copyright', siteLabel),
    sections,
  };
  // Phase 5 metadata: collected now, consumed when the share/search tags land
  const desc = plainText(siteRaw.description, siteLabel);
  if (desc !== null) content.description = Array.isArray(desc) ? desc[0] : desc;
  if (siteRaw.share_image && String(siteRaw.share_image).trim()) {
    const src = String(siteRaw.share_image).trim();
    resolveMedia(src, siteLabel);
    content.shareImage = src;
  }

  return content;
}

/* ------------------------------------------------------------ serialising */

/* JSON IS A SUBSET OF JS, so JSON.stringify already emits a valid object
   literal — no serialiser to write. Two things still have to be escaped,
   because this string is going INSIDE A <script> ELEMENT in an HTML file:

     <  >   a caption containing "</script>" would otherwise end the script
            block early and break the page. Structural JSON characters are
            {}[],:" only, so every < and > in this output is inside a string
            and replacing them is always safe.
     U+2028 / U+2029  legal in JSON strings, historically not in JS source. */
function serialise(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function inject(html, content) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1) fail(`index.html: marker ${START} not found. build.js cannot place the content without it.`);
  if (b === -1) fail(`index.html: marker ${END} not found. build.js cannot place the content without it.`);
  if (b < a) fail(`index.html: ${END} appears before ${START}.`);
  if (html.indexOf(START, a + START.length) !== -1) fail(`index.html: ${START} appears more than once.`);
  if (html.indexOf(END, b + END.length) !== -1) fail(`index.html: ${END} appears more than once.`);

  // re-indent to sit inside the IIFE alongside the surrounding declarations
  const body = serialise(content).split('\n').map(l => '  ' + l).join('\n').trim();
  const block =
    '\n  /* GENERATED — written by build.js from content/*.json at deploy.\n' +
    '     Do not hand-edit: the CMS is the source of truth and the next build\n' +
    '     overwrites everything between these two markers. */\n' +
    '  const CONTENT = ' + body + ';\n  ';

  return html.slice(0, a + START.length) + block + html.slice(b);
}

/* ------------------------------------------------------------------ output */

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(src, dst);
    else if (entry.isFile()) { fs.copyFileSync(src, dst); n++; }
  }
  return n;
}

function main() {
  if (!fs.existsSync(SRC_HTML)) fail('index.html: not found at the repository root');

  const content = assemble();
  const html = inject(fs.readFileSync(SRC_HTML, 'utf8'), content);

  // rebuilt from scratch every run: a stale file from a previous build that no
  // longer has a source would otherwise survive and ship
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  // no images/ directory is not an error — it only means nothing has been
  // uploaded yet. Anything actually REFERENCED has already failed the build
  // above, at the point it could not be measured.
  let copied = 0;
  if (fs.existsSync(IMAGES_DIR)) copied = copyDir(IMAGES_DIR, path.join(DIST, 'images'));

  /* THE CMS ITSELF SHIPS TOO. Decap is served from /admin, and the publish
     directory is dist — so without this copy the editor is simply not on the
     deployed site and there is no way in to change anything.
     Unlike images/, a missing admin/ is a FAILURE and not a skip: it is
     checked-in source, not uploaded content, so its absence means the
     repository is wrong rather than merely empty. Publishing a site whose
     editor silently vanished is the exact class of quiet half-build this
     script exists to prevent. */
  if (!fs.existsSync(ADMIN_DIR)) {
    fail('admin/: not found at the repository root. Decap CMS is served from /admin and would be missing from the deployed site.');
  }
  const adminFiles = copyDir(ADMIN_DIR, path.join(DIST, 'admin'));

  /* THE TYPEFACE SHIPS TOO. index.html asks for /fonts/*.woff2 by URL, so a
     missing fonts/ means every request 404s and the whole site silently falls
     back to system-ui — legible, but not the design, and with nothing in the
     build output to say so.
     Same reasoning as admin/: checked-in source, so absence is a broken
     repository rather than an empty one, and it FAILS rather than skips. */
  if (!fs.existsSync(FONTS_DIR)) {
    fail('fonts/: not found at the repository root. index.html references /fonts/*.woff2 and the site would fall back to system fonts.');
  }
  const fontFiles = copyDir(FONTS_DIR, path.join(DIST, 'fonts'));

  const count = content.sections.reduce((n, s) => n + s.projects.length, 0);
  console.log(
    `built dist/index.html — ${count} project${count === 1 ? '' : 's'} across ` +
    `${content.sections.length} sections, ${copied} image file${copied === 1 ? '' : 's'} copied, ` +
    `${adminFiles} admin file${adminFiles === 1 ? '' : 's'} copied, ` +
    `${fontFiles} font file${fontFiles === 1 ? '' : 's'} copied`
  );
}

main();
