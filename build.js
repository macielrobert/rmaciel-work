#!/usr/bin/env node
'use strict';

/* =========================================================================
   build.js — folds content/ into index.html, emits dist/index.html
   =========================================================================

   WHAT THIS IS
     Keystatic writes `.mdoc` files into content/ — JSON frontmatter, then the
     rich text as Markdoc. index.html holds the site with an EMPTY CONTENT
     block. This script reads the first, serialises it into the second between
     the CONTENT:START / CONTENT:END markers, and writes the result to dist/.
     The published artifact is unchanged: one file, one request, everything
     inline, zero runtime dependencies.

   ONE DEPENDENCY, AND WHY IT IS WORTH IT
     `@markdoc/markdoc`, which has no dependencies of its own, and which is
     required LAZILY — inside the one function that needs it, not at the top.

     THAT LAZINESS NO LONGER MEANS THE BUILD RUNS WITHOUT node_modules, and the
     distinction is worth stating because three documents used to claim it did.
     The escape hatch only holds while NO .mdoc file has a body to parse. Every
     project has one now, so `node build.js` with node_modules deleted fails on
     the first entry — by design, loudly, naming the file and saying to run
     `npm install`. Netlify installs before it builds, so nothing about the
     deploy depends on this; what is gone is the ability to build the site from
     a bare checkout.

     It replaced roughly a hundred lines of regular expressions that could only
     ever approximate a parser. Everything else here is still Node built-ins.
     The editor's own dependencies (Astro, React) are separate: they build the
     admin UI and touch nothing the visitor downloads.

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
const FONTS_DIR = path.join(ROOT, 'fonts');
const DIST     = path.join(ROOT, 'dist');

const START = '/* CONTENT:START */';
const END   = '/* CONTENT:END */';

/* THE SECTIONS ARE DEFINED HERE, NOT IN THE CMS.
   A project picks its section from a fixed list (the `section` select in
   keystatic.config.tsx). The list itself is not editable content, because adding a
   fourth section is not a content change. Keeping the list here means the two
   places that must agree are both in the repo, not one in the repo and one in
   a CMS form. index.html is no longer one of them: the section wheel builds
   its slots from DATA.sections, so a fourth section is this entry plus the
   keystatic select and nothing else.
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
     at load just to measure its shape) and the CMS's image field does not
     report dimensions. An image library would be an npm dependency. But the
     dimensions are in the first few bytes of the file by specification, and
     reading them is about forty lines — so it is forty lines.

   WHAT IS MEASURED, AND WHAT IS NOT
     Only the `images` list, because that is the only place the site READS a
     ratio. Icons and wordmarks are drawn as CSS/WebGL masks at a fixed cap
     (50px cell, 320px wordmark) and their aspect never enters a layout
     calculation. That exemption is not laziness — the CMS actively recommends
     SVG for marks ("transparent PNG or SVG with real counterforms"), and an
     SVG has neither an IHDR nor an SOF to read.
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

// The CMS stores image paths against its public path ("/images"), while the
// files land in the directory of the same name at the repo root. One is the
// other without the leading slash.
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

/* Projects are entered in batches — all titles first, then all descriptions,
   then all icons, and so on — so a project can sit for a while with no detail
   lines yet without that meaning anything is wrong. Unlike needList this never
   fails: missing or absent becomes [], and the array is only checked for the
   shape it must have if it exists (strings, non-empty) so a stray blank line
   still fails loudly rather than shipping a blank row in the window. */
function optionalList(obj, key, label) {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${label}: "${key}" must be a list`);
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

   `require`d lazily, inside the function that needs it. That was once an
   escape hatch — a repository with no `.mdoc` files built the whole site with
   node_modules deleted — and it is now only a clean error message, because
   every project is `.mdoc` with a body. See the header. */
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

/* THE HAND-ROLLED MARKER LAYER USED TO LIVE HERE, AND IS GONE.

   HTML escaping, ++underline++, [small]…[/small] and friends, unclosed-tag
   detection, stripping the backslashes Decap added to every square bracket,
   mapping ## to a size step — roughly a hundred lines of string matching that
   could only ever approximate a parser.

   `renderMarkdoc` above replaced all of it. That is what the one dependency
   bought: @markdoc/markdoc has no dependencies of its own, and in exchange the
   text pipeline became a real AST walk instead of a stack of regular
   expressions each of which had to be right about the others.

   The `.json` reader went with it. Every project is `.mdoc` now; a stray
   `.json` in content/projects/ would be a file no editor wrote. */

/* PLAIN TEXT — for the fields that are NOT body copy.

   Share descriptions and the site description end up in a link preview and a
   search result, where a `<strong>` is not bold text, it is the characters
   `<strong>`. These collapse to one line and carry no markup at all, which is
   also why they are not escaped: nothing here reaches innerHTML. */
function plainText(text, label) {
  if (text === undefined || text === null || !String(text).trim()) return null;
  const flat = String(text).replace(/\r\n/g, '\n').replace(/\s*\n\s*/g, ' ').trim();
  if (!flat) fail(`${label}: field is present but contains no text`);
  return flat;
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

  const out = { title, details: optionalList(p, 'details', label) };

  const summary = (p.summary && typeof p.summary.markdoc === 'string')
    ? (renderMarkdoc(p.summary.markdoc, label) || null) : null;
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
     (TO-DO.md, Phase 5). buildData() reads named fields and ignores the rest, so
     carrying it is inert today. Dropping it would silently discard something a
     human typed into a form, which is the worse failure. */
  const share = plainText(p.share_description, label);
  if (share !== null) out.shareDescription = Array.isArray(share) ? share[0] : share;

  // THE URL. buildData() prefers this over a title-derived one, which is what
  // makes the CMS's "set once and never change it" promise true — the value
  // here is the filename, and the filename is the permanent address.
  out.slug = slug;

  return out;
}

/* ----------------------------------------------------------------- gather */

/* TWO FILE FORMATS ON DISK, ON PURPOSE.

   Decap wrote `content/projects/vessel.json` — pure JSON, description as a
   string.

   Keystatic writes `content/projects/vessel.mdoc` — JSON frontmatter between
   `---` fences, then the rich text as Markdoc:

       ---
       { "title": "Big Deal Project", "section": "build", ... }
       ---
       this is {% large %}{% underline %}test{% /underline %}{% /large %}.

   This shape was READ OFF A FILE THE EDITOR ACTUALLY WROTE. An earlier version
   of this function expected a folder per entry holding index.json and
   summary.mdoc, which is what `format: { data: 'json', contentField: 'summary' }`
   sounded like it would produce. It produces neither of those filenames. The
   lesson is the same one this project keeps learning: read the bytes.

   ONLY `.mdoc` IS READ NOW. Both formats were read during the migration so
   entries could move one at a time with the site building at every point in
   between; all fifteen arrived, so the `.json` branch is gone and
   `loadProjects()` ignores anything that is not `.mdoc`. A stray `.json` in
   content/projects/ would be a file no editor wrote.

   THE SLUG COMES FROM THE FILENAME. Keystatic stores it there rather than as a
   field — `slugField: 'title'` names the field the slug is DERIVED from, not a
   field it writes. So the filename is the permanent address, which is also why
   renaming a file is renaming a URL. */
function parseMdoc(raw, label) {
  if (!raw.startsWith('---')) {
    fail(`${label}: expected JSON frontmatter between --- fences and found none.`);
  }
  // find the CLOSING fence only — the body may legitimately contain `---`,
  // which is exactly what the editor's divider button writes
  const end = raw.indexOf('\n---', 3);
  if (end === -1) fail(`${label}: frontmatter opens with --- but never closes.`);

  const head = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');

  let data;
  try { data = JSON.parse(head); }
  catch (e) { fail(`${label}: the frontmatter is not valid JSON — ${e.message}`); }

  if (body.trim()) data.summary = { markdoc: body };
  return data;
}

function readProjectEntry(entry) {
  const abs = path.join(PROJECTS_DIR, entry.name);
  const label = path.relative(ROOT, abs);
  const base = entry.name.replace(/\.mdoc$/i, '');

  const raw = parseMdoc(fs.readFileSync(abs, 'utf8'), label);
  // the filename IS the slug; buildProject requires the field, so supply it
  if (!raw.slug) raw.slug = base;
  return { raw, label, key: base };
}

function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fail(`content/projects/ does not exist. The CMS writes project files there; the repository layout is wrong.`);
  }
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && /\.mdoc$/i.test(e.name))
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

  /* THE THREE SINGLETON FILENAMES ARE NOT A CHOICE — Keystatic derives each
     one from the singleton's `format`, and reading a different name means the
     editor and the build are looking at two different files.

       about    format: { data:'json', contentField:'summary' }  ->  about.mdoc
       contact  format: { data:'json' }                          ->  contact.json
       site     format: { data:'json' }                          ->  site.json

     The rule, read out of getDataFileExtension() in @keystatic/core rather
     than assumed: a singleton with a contentField is written as ONE .mdoc
     file — JSON frontmatter, then the rich text — exactly like a project. Only
     a singleton with no rich-text field stays pure .json.

     ABOUT was left as about.json by the migration, which the editor cannot
     see: opening ABOUT showed an empty form, and the first save would have
     written about.mdoc alongside it and failed this build on the missing
     about.json. Both halves are fixed together — the file was converted and
     this reader follows it. */
  const aboutFile = path.join(CONTENT_DIR, 'about.mdoc');
  const contactFile = path.join(CONTENT_DIR, 'contact.json');
  const siteFile = path.join(CONTENT_DIR, 'site.json');
  for (const f of [aboutFile, contactFile, siteFile]) {
    if (!fs.existsSync(f)) fail(`${path.relative(ROOT, f)}: required content file is missing`);
  }

  const aboutLabel = 'content/about.mdoc';
  const aboutRaw = parseMdoc(fs.readFileSync(aboutFile, 'utf8'), aboutLabel);
  // parseMdoc hands the body back as { markdoc } — the same shape a project's
  // summary arrives in, so ABOUT gets the same toolbar and the same renderer.
  const aboutBody = need(aboutRaw, 'summary', aboutLabel);
  if (typeof aboutBody.markdoc !== 'string') {
    fail(`${aboutLabel}: the description is empty. It is the ABOUT copy and the site has nowhere else to get it.`);
  }
  const aboutSummary = renderMarkdoc(aboutBody.markdoc, aboutLabel);
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

/* THE <title> TAG, written from content/site.json at build time.

   WHY IT IS GENERATED RATHER THAN TYPED. index.html already sets
   document.title at runtime — updateDocTitle() builds it from
   CONTENT.siteTitle on every route change. So the tag in the source is only
   the PRE-BOOT value: the tab label during first paint, and what a crawler
   with JS disabled reads. Typed by hand it was a second copy of the site
   name that nothing kept in step, and it drifted — it still said
   "SVG Noise Lab — v80" long after the site had a real name. One source,
   content/site.json, now feeds both.

   NO NEW MARKER COMMENT, unlike the CONTENT block. <title> is unique in a
   valid document by definition, so the tag IS the marker and there is
   nothing extra for a future editor to preserve by accident. A missing or
   duplicated one is a broken template and FAILS rather than silently
   skipping, matching how the CONTENT markers are handled below.

   ESCAPED, because site_title comes from a CMS field a human types into.
   "Maciel & Co" is a plausible thing to enter and a bare & in an HTML text
   node is invalid; < would be worse. */
const TITLE_RE = /<title>[\s\S]*?<\/title>/gi;

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectTitle(html, siteTitle) {
  const found = html.match(TITLE_RE);
  if (!found)             fail('index.html: no <title> tag found. build.js writes the site name into it and cannot place it without one.');
  if (found.length !== 1) fail(`index.html: ${found.length} <title> tags found, expected exactly 1.`);
  return html.replace(TITLE_RE, `<title>${escapeHtmlText(siteTitle)}</title>`);
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
  let html = inject(fs.readFileSync(SRC_HTML, 'utf8'), content);
  html = injectTitle(html, content.siteTitle);

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



  /* THE TYPEFACE SHIPS TOO. index.html asks for /fonts/*.woff2 by URL, so a
     missing fonts/ means every request 404s and the whole site silently falls
     back to system-ui — legible, but not the design, and with nothing in the
     build output to say so.
     Opposite of images/ above: fonts are checked-in source, so an absence is a
     broken repository rather than an empty one, and it FAILS rather than
     skips. */
  if (!fs.existsSync(FONTS_DIR)) {
    fail('fonts/: not found at the repository root. index.html references /fonts/*.woff2 and the site would fall back to system fonts.');
  }
  const fontFiles = copyDir(FONTS_DIR, path.join(DIST, 'fonts'));

  const count = content.sections.reduce((n, s) => n + s.projects.length, 0);
  console.log(
    `built dist/index.html — ${count} project${count === 1 ? '' : 's'} across ` +
    `${content.sections.length} sections, ${copied} image file${copied === 1 ? '' : 's'} copied, ` +
    `${fontFiles} font file${fontFiles === 1 ? '' : 's'} copied`
  );
}

main();
