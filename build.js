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

/* PARAGRAPHS. The CMS collects one text area with "blank line between
   paragraphs" in the hint. buildData() accepts a string OR a list of strings
   and normalises with paras(). Splitting here means the authoring convention
   is honoured in one place rather than depending on downstream behaviour. */
function paragraphs(text, label) {
  if (text === undefined || text === null || !String(text).trim()) return null;
  const parts = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .map(s => s.trim().replace(/\s*\n\s*/g, ' ')).filter(Boolean);
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

  const summary = paragraphs(p.summary, label);
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
  const share = paragraphs(p.share_description, label);
  if (share !== null) out.shareDescription = Array.isArray(share) ? share[0] : share;

  // kept so the authored value survives the build; see the note in the PR /
  // README about buildData() deriving slugs from titles today
  out.slug = slug;

  return out;
}

/* ----------------------------------------------------------------- gather */

function loadProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fail(`content/projects/ does not exist. The CMS writes project files there; the repository layout is wrong.`);
  }
  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.toLowerCase().endsWith('.json')).sort();
  if (!files.length) warn('content/projects/ contains no .json files — every section will be empty.');

  const kept = [];
  for (const f of files) {
    const abs = path.join(PROJECTS_DIR, f);
    const label = path.relative(ROOT, abs);
    const raw = readJSON(abs);
    if (raw && raw.draft === true) continue;            // held back, not published
    kept.push({ label, order: raw.order, section: raw.section, project: buildProject(raw, label), file: f });
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
  const intro = paragraphs(contactRaw.intro, contactLabel);
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
  const desc = paragraphs(siteRaw.description, siteLabel);
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
