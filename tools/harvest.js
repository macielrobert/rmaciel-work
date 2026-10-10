#!/usr/bin/env node
/* HARVEST — a crawler with a review queue in front of it.

     node tools/harvest.js            (or double-click tools/Harvest.command)

   WHAT IT DOES
     1. Reads the projects already in Keystatic (content/projects/*.mdoc).
     2. You pick a folder in its file tree and CRAWL it. Every folder whose
        name matches a project title, every image whose filename does, and
        every PDF / Illustrator / Word / text page that MENTIONS a title,
        becomes a finding filed under that project.
     3. Each finding sits in PENDING until you accept or reject it. Text is
        editable inline. Accepting a FOLDER pulls in everything inside it —
        images and every page of every document — as new pending findings,
        because a folder named after the project is about the project even
        where the title is never written down.
     4. WRITE puts the accepted ones into the project's .mdoc: images copied
        in, text appended to the description, detail lines or share line.
        Existing content is never removed or replaced, except the share line,
        which is one value by nature.

   WHY THE MATCH IS A QUEUE AND NOT A DECISION
     Matching is by name, and names are ambiguous: NOISE matches every folder
     with "noise" in it. A smarter matcher would still be wrong sometimes and
     would hide where. Making every match visible and one click to reject is
     cheaper than making the matcher clever.

   HOW TEXT IS READ — all of it native to macOS, nothing installed
     PDF and .ai   PDFKit, through osascript's JavaScript bridge. An .ai file
                   saved "PDF compatible" (Illustrator's default) is a PDF.
     .indd         InDesign itself, scripted, OFF unless ticked — it launches
                   InDesign and the first file took ~3 minutes cold.
     .docx .doc .rtf .odt   textutil.   .txt .md   read directly.
     PDF pages that are PICTURES of text (Rhino's tiled-PNG exports, and
                   InDesign layouts built from them) — text recognition,
                   Apple's Vision framework. See TEXT RECOGNITION below.
     .3dm          the Rhino Notes panel. See RHINO NOTES below.
     A website     "Crawl website": the sitemap lists every page, linked or
                   not. See WEBSITE MODE below.
   Results are cached by path + size + date, so a second crawl only reads
   what changed.

   WHERE ITS MEMORY LIVES
     ~/Library/Application Support/Harvest — the crawl root, every finding and
     your accept/reject decisions, and the text cache. Outside the repo on
     purpose: none of it is site content, and a re-crawl must remember what
     you already rejected or the queue refills with it.

   WHAT IT DOES NOT DO
     No git and no publishing. It only writes files into the repo; going live
     is one step, done the usual way. */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const PROJECTS = path.join(REPO, 'content/projects');
const HOME = path.resolve(os.homedir());
const STORE = path.join(HOME, 'Library/Application Support/Harvest');
fs.mkdirSync(STORE, { recursive: true });
const STATE_FILE = path.join(STORE, 'state.json');
// Image fingerprints are tiny and live in one file. Document text does NOT:
// it is up to 6000 characters a page across every document ever crawled, and
// as one JSON file it was rewritten whole every ten documents — slower each
// time, and past ~512 MB V8 cannot build the string at all. One small file per
// document is written once and never rewritten.
const CACHE_FILE = path.join(STORE, 'hash-cache.json');
const TEXT = path.join(STORE, 'text');
const THUMBS = path.join(STORE, 'thumbs');
fs.mkdirSync(TEXT, { recursive: true });
fs.mkdirSync(THUMBS, { recursive: true });

// A file that exists but will not parse is set aside and SAID, not quietly
// replaced: the next save would otherwise overwrite every accept/reject
// decision with an empty state and nothing would tell anyone.
function load(f, d) {
  if (!fs.existsSync(f)) return d;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) {
    const bad = `${f}.unreadable-${Date.now()}`;
    fs.renameSync(f, bad);
    console.warn(`${path.basename(f)} could not be read (${e.message}); kept as ${path.basename(bad)}, starting empty`);
    return d;
  }
}
// Write beside, then rename: a rename is all-or-nothing, so a crash or sleep
// mid-write leaves the previous file intact instead of half a file.
const writeAtomic = (f, s) => { fs.writeFileSync(f + '.tmp', s); fs.renameSync(f + '.tmp', f); };
const state = load(STATE_FILE, { root: null, findings: {} });
const cache = load(CACHE_FILE, {});
// Saves are coalesced: a click, an inline edit and a crawl's progress all ask
// for one, and each used to re-serialise every finding on the spot. At most one
// write per 300 ms; flushed on the way out, so closing the window loses nothing.
let saveTimer = null;
const flush = () => { clearTimeout(saveTimer); saveTimer = null; writeAtomic(STATE_FILE, JSON.stringify(state)); };
const persist = () => { saveTimer ||= setTimeout(flush, 300); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { if (saveTimer) flush(); process.exit(0); });
// Started by Harvest.app: if the app goes away without asking (Force Quit, a
// crash), this server is orphaned — still running, still holding the state
// file — so it watches for that and saves and exits too.
if (process.env.HARVEST_APP) {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { if (saveTimer) flush(); process.exit(0); } }, 2000).unref();
}

// Formats build.js can measure go in as-is; HEIC/TIFF become JPEG on the way
// in. GIF was left out until 2026-10-06, when build.js learned its size: NOISE
// is animated GIFs (hundreds of frames each), and a JPEG keeps one of them.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.tif', '.tiff']);
const KEEP_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
// Longest side written into the repo. Netlify's image CDN resizes per screen;
// this only keeps 40 MB camera files out of git.
const MAX_SIDE = 2400;
// A GIF cannot be shrunk here (sips writes one frame), so it goes to the site
// at the size it comes in. NOISE's run 1-7 MB; one is 66 MB, which is a video,
// and a file that size stays in git history for good once published.
// ponytail: a flat cap, not a re-encode; gifsicle/ffmpeg if big GIFs keep coming.
const MAX_GIF = 20 * 1024 * 1024;
// Never descended into: system and app internals, and libraries that are
// thousands of files of someone else's structure.
const SKIP = /^(\.|node_modules$|Library$|Applications$)|\.(app|photoslibrary|lrdata|lrcat-data|fcpbundle|bundle|framework)$/i;
const MAX_DEPTH = 12;
const MAX_FOLDER_IMAGES = 300;   // per accepted folder; past this it is a dump, not a project

/* ------------------------------------------------------------- helpers */

const ext = (p) => path.extname(p).toLowerCase();
const id = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
// let the server answer between chunks of work — and notice a Stop
const tick = () => new Promise(r => setImmediate(r)).then(alive);

/* STOP — one flag, checked between every folder, file, page and picture
   (walk, tick and pool all call alive()). A stopped job ends at the next
   check, keeps what it already found, and says 'Stopped'. */
let stopping = false;
const STOPPED = new Error('stopped');
function alive() { if (stopping) throw STOPPED; }
// The exit code decides. stdout rides on the error, because sips exits non-zero
// for a batch with one bad file in it and the rest of its answer is still good.
const sh = (cmd, args) => new Promise((ok, no) =>
  execFile(cmd, args, { maxBuffer: 256 << 20, timeout: 600000 }, (e, out) => e ? no(Object.assign(e, { stdout: out })) : ok(out)));

// A finding's path is a file on this Mac or, from a website crawl, a URL.
const isRemote = (p) => /^https?:\/\//.test(p);
const present = (p) => isRemote(p) || fs.existsSync(p);

function readMdoc(file) {
  const s = fs.readFileSync(file, 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${path.basename(file)} has no frontmatter`);
  return { data: JSON.parse(m[1]), body: m[2] };
}

// "images/<slug>/images/<n>" is Keystatic's own layout. The repo path and the
// public URL are the same string, the URL with a leading slash.
const imgRel = (slug, n) => `images/${slug}/images/${n}`;

// Every write to a project goes through here, so the project list read below
// can be kept between polls and dropped only when something actually changed.
const mdocText = (data, body) => { body = String(body).trim(); return `---\n${JSON.stringify(data, null, 2)}\n---\n${body ? body + '\n' : ''}`; };
function writeMdoc(file, data, body) {
  fs.writeFileSync(file, mdocText(data, body));
  projectsCache = null;
  unpublished.add(path.basename(file, '.mdoc'));
}

/* ------------------------------------------------------------- publishing */

/* PUBLISH — the same steps Claude takes, behind one button.
     1. Only content/ and images/ are committed. Code is never published from
        here, so a half-finished change to the site cannot ride along.
     2. build.js must pass first. A build that fails on Netlify stops every
        later deploy until it is fixed — the BUS STOP alt-text stall.
     3. Pull (rebasing on top of any edits saved from the phone), then push to
        main, which Netlify deploys. A clash stops with a message and changes
        nothing on GitHub.
   Which projects are waiting is read from git once at start, then kept up to
   date by writeMdoc, rather than asking git on every poll. */
const git = (...a) => sh('git', ['-C', REPO, ...a]);
const unpublished = new Set();
const changedProjects = (porcelain) => porcelain.split('\n').map(l => (l.slice(3).match(/^(?:content\/projects\/([^/]+)\.mdoc|images\/([^/]+)\/)/) || []).slice(1).find(Boolean)).filter(Boolean);
// CATCH UP — the latest from GitHub immediately before anything is written
// into the repo (Write, Organize's Save, a new project), not only at launch:
// Keystatic saves from the phone land on GitHub, and writing onto an old copy
// is how a Publish ends in a clash. Fast-forward only, as at launch. Offline,
// or with this Mac's unpublished edits in the way of an incoming one, it is
// skipped and logged — a rebase there would leave conflict marks inside a
// project file, which is worse than the clash it was meant to prevent.
const catchUp = () => new Promise((ok) => execFile('git', ['-C', REPO, 'pull', '-q', '--ff-only'], { timeout: 20000 }, (e, out, err) => {
  if (e) console.warn('not caught up with GitHub before writing: ' + String(err || e.message).trim().split('\n')[0]);
  projectsCache = null;   // the pull may have changed any project
  ok();
}));

async function publish() {
  const changed = await git('status', '--porcelain', '--', 'content', 'images');
  if (!changed.trim()) { unpublished.clear(); return { message: 'Nothing new to publish.' }; }
  try { await sh(process.execPath, [path.join(REPO, 'build.js')]); }
  catch (e) { throw new Error('The site would not build, so nothing was published: ' + String(e.stderr || e.message).trim().split('\n').pop()); }
  const slugs = [...new Set(changedProjects(changed))];
  await git('add', '--', 'content', 'images');
  await git('commit', '-q', '-m', `Harvest: ${slugs.join(', ') || 'content'}`);
  try { await git('pull', '-q', '--rebase', '--autostash'); }
  catch {
    // back to exactly where it started: the commit is undone and its changes
    // left in place, so they still show as waiting and a later Publish (or
    // Claude) picks them up — a commit left behind would read "nothing new"
    await git('rebase', '--abort').catch(() => {});
    await git('reset', '--soft', 'HEAD~1').catch(() => {});
    for (const s of slugs) unpublished.add(s);
    throw new Error('GitHub has edits that clash with these. Nothing was published — ask Claude to publish.');
  }
  await git('push', '-q', 'origin', 'HEAD');
  unpublished.clear();
  projectsCache = null;   // the pull may have brought in edits from the phone
  return { message: `Published ${slugs.join(', ')}. Live in about a minute.` };
}

// Matches Keystatic's slug for a new entry: lowercase letters and digits,
// anything else one hyphen. The filename IS the slug, and the slug is the URL.
const slugify = (t) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function newProject(title, section) {
  title = String(title || '').trim();
  const slug = slugify(title);
  if (!slug) throw new Error('A new project needs a title.');
  if (!['build', 'design', 'art'].includes(section)) throw new Error('Pick a section.');
  const file = path.join(PROJECTS, slug + '.mdoc');
  if (fs.existsSync(file)) throw new Error(`There is already a project called "${slug}".`);
  // A draft until it has a grid icon: build.js skips drafts before checking
  // them, so the site keeps building. Finish it in /keystatic.
  writeMdoc(file, { title, section, order: 10, draft: true, details: [], layout: 'standard', expand: true, icon_type: 'glyph', images: [] }, '');
  return slug;
}

/* ------------------------------------------------------------- project panel */

/* THE PROJECT PANEL — every field Keystatic edits except the pictures, which
   are Organize's. Harvest is the editor now (Robert, 2026-10-04: he does not
   want to edit in Keystatic on his phone); Keystatic stays the fallback and
   keystatic.config.tsx the schema of record. Field names, value shapes and
   file names follow what Keystatic writes, so either editor can open what
   the other saved.

   VALIDATION IS build.js ITSELF, not a copy of its rules — run on a small
   copy of the site holding only this project and the projects tied to it by
   "Sub-project of" (checkAlone below), once as the file is and once as the
   save would leave it. If the save adds a failure, nothing is written and
   the build's own message is shown. Not the whole site: build.js stops at
   the FIRST failure, so one broken project anywhere hid every problem this
   save could cause (review, 2026-10-04). A failure this project already had
   does not block a save that leaves it the same — refusing would stop it
   being fixed a field at a time. Whether the whole site builds is
   Publish's question, and Publish asks it.

   ONLY WHAT WAS CHANGED IS SENT. The page sends the fields that differ from
   what it loaded, and the rest are left as the file has them now — which,
   after the catch-up with GitHub, may be newer than the form: an edit made
   in Keystatic on the phone while the panel was open survives a save here.

   ICON AND WORDMARK FILES are uploaded to Harvest's own folder first and
   only copied into images/<slug>/ on Save, named as Keystatic names them
   (<field>.<ext>). Uploading alone changes nothing on the site. */
const UPLOADS = path.join(STORE, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const MOVED = path.join(STORE, 'moved');   // site pictures moved to another project, until that project's Save (organizeOp)
fs.mkdirSync(MOVED, { recursive: true });
// Harvest's own temporary copies, swept at every start. A moved picture is
// needed only while a card still points at it — once its project's Save has
// copied it in (or it was rejected), it is done. An upload a day old was
// abandoned: a Save copies its upload in and deletes it the same moment.
function sweep() {
  const live = new Set(Object.values(state.findings).filter(f => f.status === 'pending' || f.status === 'accepted').map(f => f.path));
  for (const n of fs.readdirSync(MOVED)) if (!live.has(path.join(MOVED, n))) fs.rmSync(path.join(MOVED, n), { force: true });
  for (const n of fs.readdirSync(UPLOADS)) { const f = path.join(UPLOADS, n); if (Date.now() - fs.statSync(f).mtimeMs > 864e5) fs.rmSync(f, { force: true }); }
}
const MARK_EXT = new Set(['.png', '.svg']);   // alpha is the shape: build.js refuses anything else for an icon
const lines = (v) => String(v ?? '').split('\n').map(x => x.trim()).filter(Boolean);

function projectFile(slug) {
  const file = path.join(PROJECTS, String(slug) + '.mdoc');
  if (!/^[a-z0-9-]+$/.test(String(slug)) || !fs.existsSync(file)) throw new Error('No such project.');
  return file;
}
function projectData(slug) {
  const { data, body } = readMdoc(projectFile(slug));
  const { images, ...rest } = data;
  return { slug, data: rest, body };
}

// The projects a save of `slug` can affect through "Sub-project of": its lead
// (old and new), the projects that name it, and theirs, all the way round —
// the only way build.js judges one project by another.
function tiedTo(slug, leads) {
  const all = projects(), set = new Set([slug, ...leads.filter(Boolean)]);
  for (let n = -1; n !== set.size;) {   // until a pass adds nothing
    n = set.size;
    for (const p of all) { if (set.has(p.part_of)) set.add(p.slug); if (set.has(p.slug) && p.part_of) set.add(p.part_of); }
  }
  return [...set].filter(k => fs.existsSync(path.join(PROJECTS, k + '.mdoc')));
}

// build.js run on a throwaway copy of the site: the real build.js, index.html,
// fonts and singletons (linked, not copied), the tied projects, and `text` as
// this project's file. Pictures are linked, and build.js copies only real
// files, so nothing is duplicated. `uploads` stand in for files a save would
// put in images/<slug>/. Returns the build's message, or null if it built.
async function checkAlone(slug, text, uploads, tied) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-check-'));   // the system's temp folder: one cut short by a quit is cleared by macOS
  try {
    fs.copyFileSync(path.join(REPO, 'build.js'), path.join(root, 'build.js'));
    for (const n of ['index.html', 'fonts', 'node_modules']) fs.symlinkSync(path.join(REPO, n), path.join(root, n));
    fs.mkdirSync(path.join(root, 'content', 'projects'), { recursive: true });
    const content = path.join(REPO, 'content');
    for (const n of ['about.mdoc', 'contact.json', 'site.json']) if (fs.existsSync(path.join(content, n))) fs.symlinkSync(path.join(content, n), path.join(root, 'content', n));
    fs.mkdirSync(path.join(root, 'images', slug), { recursive: true });
    for (const k of tied) {
      fs.writeFileSync(path.join(root, 'content', 'projects', k + '.mdoc'), k === slug ? text : fs.readFileSync(path.join(PROJECTS, k + '.mdoc')));
      const dir = path.join(REPO, 'images', k);
      if (k !== slug) { if (fs.existsSync(dir)) fs.symlinkSync(dir, path.join(root, 'images', k)); continue; }
      const replaced = new Set(uploads.map(([, rel]) => path.basename(rel)));
      if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (!replaced.has(n)) fs.symlinkSync(path.join(dir, n), path.join(root, 'images', k, n));
    }
    for (const [from, rel] of uploads) fs.symlinkSync(from, path.join(root, rel));
    return await sh(process.execPath, [path.join(root, 'build.js')]).then(() => null, e => String(e.message).trim().split('\n').pop().trim());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function saveProject(slug, v, newBody) {
  await catchUp();
  const file = projectFile(slug);
  const old = fs.readFileSync(file, 'utf8');
  const { data, body } = readMdoc(file);
  const next = { ...data };
  const str = (x) => String(x ?? '').trim();
  const optional = (k, val) => { if (val === '' || val === null || (Array.isArray(val) && !val.length)) delete next[k]; else next[k] = val; };
  // one rule per field; a field the page did not send is left as the file has it
  const set = {
    title: (x) => { if (!str(x)) throw new Error('A project needs a title.'); next.title = str(x); },
    section: (x) => { if (!['build', 'design', 'art'].includes(x)) throw new Error('Pick a section.'); next.section = x; },
    order: (x) => { const n = Number(x); if (str(x) === '' || !Number.isFinite(n)) throw new Error('Position in grid must be a number.'); next.order = Math.round(n); },
    draft: (x) => { next.draft = !!x; },
    part_of: (x) => optional('part_of', str(x)),
    client: (x) => optional('client', str(x)),
    details: (x) => { next.details = lines(x); },   // Keystatic always writes the list, even empty
    layout: (x) => { if (!['standard', 'grid', 'text'].includes(x)) throw new Error('Pick a layout.'); next.layout = x; },
    expand: (x) => { next.expand = !!x; },
    icon_type: (x) => { if (!['glyph', 'image'].includes(x)) throw new Error('Pick a kind of grid icon.'); next.icon_type = x; },
    icon_glyph: (x) => optional('icon_glyph', str(x)),
    share_description: (x) => optional('share_description', str(x)),
    nicknames: (x) => optional('nicknames', lines(x)),
  };
  for (const [k, apply] of Object.entries(set)) if (k in v) apply(v[k]);
  const uploads = [], gone = [];
  for (const k of ['icon_image', 'wordmark']) {
    if (!(k in v)) continue;
    const val = v[k];
    if (val && typeof val === 'object' && val.upload) {
      const from = path.resolve(String(val.upload));
      if (!from.startsWith(UPLOADS + path.sep) || !fs.existsSync(from)) throw new Error('That upload is gone — choose the file again.');
      const rel = `images/${slug}/${k}${ext(from)}`;
      uploads.push([from, rel]);
      next[k] = '/' + rel;
    } else optional(k, str(val));
    // a mark replaced by one of another kind (.png by .svg) or removed: its
    // old file goes, because build.js ships everything under images/
    if (data[k] && data[k] !== next[k]) gone.push(data[k]);
  }
  const text = mdocText(next, newBody === undefined ? body : newBody);
  if (text === old && !uploads.length) return { unchanged: true };

  const tied = tiedTo(slug, [data.part_of, next.part_of]);
  const [before, after] = await Promise.all([checkAlone(slug, old, [], tied), checkAlone(slug, text, uploads, tied)]);
  if (after && after !== before) throw new Error('Not saved — the site would not build: ' + after);

  // the checks passed: now for real. Marks first, so a project file never
  // names one that is not there yet; a failed copy puts back what it replaced.
  const backups = [];
  try {
    for (const [from, rel] of uploads) {
      const to = path.join(REPO, rel);
      backups.push([to, fs.existsSync(to) ? fs.readFileSync(to) : null]);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    writeMdoc(file, next, newBody === undefined ? body : newBody);
  } catch (e) {
    for (const [f, bytes] of backups) if (bytes) fs.writeFileSync(f, bytes); else fs.rmSync(f, { force: true });
    fs.writeFileSync(file, old);
    projectsCache = null;
    throw e;
  }
  for (const [from] of uploads) fs.rmSync(from, { force: true });   // copied in: the waiting copy is done with
  const mine = path.join(REPO, 'images', slug) + path.sep;
  const used = new Set([next.icon_image, next.wordmark, ...(next.images || []).map(i => i.src)].filter(Boolean));
  for (const src of gone) {
    const f = path.join(REPO, String(src).replace(/^\/+/, ''));
    if (f.startsWith(mine) && !used.has(src)) fs.rmSync(f, { force: true });
  }
  return {};
}

function upload(name, b64) {
  const e = ext(String(name || ''));
  if (!MARK_EXT.has(e)) throw new Error('A grid icon or wordmark must be a PNG or SVG with a transparent background — the transparency is the shape.');
  const out = path.join(UPLOADS, id(name, Date.now()) + e);
  fs.writeFileSync(out, Buffer.from(String(b64 || ''), 'base64'));
  return out;
}

/* PREVIEW of a description, with the site's own parser (the repo's
   @markdoc/markdoc, installed for build.js). The tags below MIRROR
   markdocTags() in build.js — they only shape this preview; what reaches the
   site is decided by build.js, which Save runs. Change one, change both. */
let Markdoc = null;
function preview(src) {
  Markdoc ||= require(path.join(REPO, 'node_modules', '@markdoc', 'markdoc'));
  const M = Markdoc;
  const wrap = (el, cls) => ({ render: el, attributes: {}, transform: (node, config) => new M.Tag(el, cls ? { class: cls } : {}, node.transformChildren(config)) });
  const tags = { light: wrap('span', 'w-l'), small: wrap('span', 't-s'), large: wrap('span', 't-l'), underline: wrap('u', null) };
  const nodes = { softbreak: { transform: () => new M.Tag('br') } };
  return M.renderers.html(M.transform(M.parse(String(src || '')), { tags, nodes }));
}

// Kept, not re-read: the page asks for this on every poll, and parsing every
// project each time is wasted. Harvest's own writes clear it (writeMdoc); edits
// made elsewhere while it runs appear after a restart — the launcher pulls first.
let projectsCache = null;
function projects() {
  return projectsCache ||= fs.readdirSync(PROJECTS).filter(f => f.endsWith('.mdoc')).map(f => {
    const { data } = readMdoc(path.join(PROJECTS, f));
    return {
      slug: f.slice(0, -5), title: data.title || f, section: data.section, order: data.order ?? 10,
      draft: !!data.draft, nicknames: data.nicknames || [], part_of: data.part_of || null,
      siteImages: (data.images || []).map(i => path.join(REPO, String(i.src || '').replace(/^\/+/, ''))),
    };
  }).sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.order - b.order || a.title.localeCompare(b.title));
}

/* ------------------------------------------------------------- matching */

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'for', 'in', 'on', 'at', 'to']);
const compact = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A name matches when the whole title appears in it with the spaces squeezed
// out ("Asia Society" ~ "AsiaSociety_2023"), or when every real word of the
// title does ("Book of Hov" ~ "HOV book final"). Text matches the title as a
// phrase, any run of spaces / hyphens / underscores standing for a space.
// The working titles ("Wave House" for BUS STOP) count exactly as the title
// does: files are saved under whatever the work was called at the time.
function matcher(names) {
  const each = names.map(n => String(n || '').trim()).filter(Boolean).map(title => {
    const whole = compact(title);
    const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
    // Under three letters ("H&M" -> "hm") a substring test would match
    // "rhythm", so a short title must stand alone: the letters in order, any
    // punctuation between them, nothing alphanumeric either side.
    const short = whole.length && whole.length < 3 && new RegExp('(^|[^a-z0-9])' + [...whole].join('[^a-z0-9]*') + '($|[^a-z0-9])', 'i');
    return {
      name: (n) => {
        if (short) return short.test(n);
        const c = compact(n);
        return (whole.length >= 3 && c.includes(whole)) || (words.length > 1 && words.every(w => c.includes(w)));
      },
      text: title.split(/\s+/).map(escRe).join('[\\s\\-_]+'),
    };
  });
  return { name: (n) => each.some(m => m.name(n)), text: new RegExp(each.map(m => m.text).join('|'), 'i') };
}

/* ------------------------------------------------------------- text */

const PDF_JS = path.join(STORE, 'pdf-text.js');
fs.writeFileSync(PDF_JS, `ObjC.import('Quartz');
function run(argv) {
  const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!d || d.isNil()) return '[]';
  const out = [];
  for (let i = 0; i < d.pageCount; i++) out.push(ObjC.unwrap(d.pageAtIndex(i).string) || '');
  return JSON.stringify(out);
}`);

const INDD_AS = path.join(STORE, 'indd-text.applescript');
fs.writeFileSync(INDD_AS, `on run argv
  tell application id "com.adobe.InDesign"
    set user interaction level of script preferences to never interact
    set d to open (POSIX file (item 1 of argv)) without showing window
    try
      set t to contents of every story of d
    on error msg
      close d saving no
      error msg
    end try
    close d saving no
  end tell
  set AppleScript's text item delimiters to (ASCII character 30)
  return t as text
end run`);

// Paragraph-ish chunks of at most ~1500 characters, for formats that have no
// pages of their own. A whole Word document as one card is unreviewable.
function chunk(text) {
  const out = []; let cur = '';
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > 1500) { out.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + para.trim();
  }
  if (cur) out.push(cur);
  return out;
}

// One table of which reader handles which extension; isDoc and extract both
// read it, so a new format is one line.
const READERS = {
  '.pdf': pdfText, '.ai': pdfText,
  '.docx': textutilText, '.doc': textutilText, '.rtf': textutilText, '.odt': textutilText,
  '.txt': async (f) => chunk(await fs.promises.readFile(f, 'utf8')), '.md': async (f) => chunk(await fs.promises.readFile(f, 'utf8')),
  '.indd': async (f) => (await sh('osascript', [INDD_AS, f])).split('\x1e'),
  '.3dm': rhinoNotes,
};
const isDoc = (e, indesign) => Object.hasOwn(READERS, e) && (e !== '.indd' || indesign);

// A PDF's own text layer first. Pages with none are pictures of text — Rhino
// exports tiled PNGs, and InDesign layouts built from them keep that — and only
// those pages go to text recognition, so an ordinary PDF stays fast.
// "None" means fewer than 20 letters, not an empty layer: the portfolio's BUS
// STOP pages are one placed picture each plus a typed page number, and that
// lone "6" kept them from being read, so they never matched — only the
// contents pages listing them did (2026-10-07).
const pictureOfText = (t) => (t.match(/\p{L}/gu) || []).length < 20;
async function pdfText(f) {
  const pages = JSON.parse(await sh('osascript', ['-l', 'JavaScript', PDF_JS, f]));
  const blank = pages.flatMap((t, i) => (pictureOfText(t) ? [String(i)] : []));
  if (!blank.length) return pages;
  const bin = await ocrTool();
  if (!bin) return pages;
  const seen = JSON.parse(await sh(bin, [f, ...blank]));
  return pages.map((t, i) => (pictureOfText(t) && seen[i] ? seen[i] : t));
}

/* TEXT RECOGNITION (OCR)
     Apple's own Vision framework, the one Live Text uses; nothing installed.
     It has no command-line tool, so a 30-line Swift helper is compiled once
     into the Harvest folder (about a minute, the first time a PDF needs it)
     and reused. Recompiled only when this source changes. Each page is drawn
     at ~3000 px on its long side: smaller loses 8 pt type on a 12 x 18 sheet. */
const OCR_SRC = `import Foundation
import ImageIO
import PDFKit
import Vision
func ocr(_ img: CGImage) -> String {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
}
let args = CommandLine.arguments
// --image a.jpg : the text in one picture, drawn at most 3000 px on its long
// side as a PDF page is. Not turned first: Vision reads sideways and
// upside-down text as it is (tried at 90, 180 and 270).
if args.count > 2 && args[1] == "--image" {
  let opts = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 3000] as CFDictionary
  var text = ""
  if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil),
     let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts) { text = ocr(img) }
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: [text]))
  exit(0)
}
// --page a.pdf 4 out.jpg 2400 : page 5 drawn as a JPEG, 2400 px on its long
// side, as Preview shows it (the crop box), for a page wanted as a picture
if args.count > 5 && args[1] == "--page" {
  guard let doc = PDFDocument(url: URL(fileURLWithPath: args[2])), let i = Int(args[3]), let page = doc.page(at: i),
        let side = Double(args[5]) else { exit(1) }
  let box = page.bounds(for: .cropBox)
  let scale = side / max(box.width, box.height)
  let pic = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .cropBox)
  guard let img = pic.cgImage(forProposedRect: nil, context: nil, hints: nil),
        let out = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[4]) as CFURL, "public.jpeg" as CFString, 1, nil) else { exit(1) }
  CGImageDestinationAddImage(out, img, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
  exit(CGImageDestinationFinalize(out) ? 0 : 1)
}
// --prints a.jpg b.png ... : one feature vector per picture, for grouping copies
if args.count > 1 && args[1] == "--prints" {
  var out: [Any] = []
  for p in args.dropFirst(2) {
    let req = VNGenerateImageFeaturePrintRequest()
    guard (try? VNImageRequestHandler(url: URL(fileURLWithPath: p), options: [:]).perform([req])) != nil,
          let o = req.results?.first as? VNFeaturePrintObservation, o.elementType == .float
    else { out.append(NSNull()); continue }
    out.append(o.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }.map { Double($0) })
  }
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
  exit(0)
}
let want = Set(args.dropFirst(2).compactMap { Int($0) })
var pages: [String] = []
if let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) {
  for i in 0..<doc.pageCount {
    guard want.isEmpty || want.contains(i), let page = doc.page(at: i) else { pages.append(""); continue }
    let box = page.bounds(for: .mediaBox)
    let scale = min(3.0, 3000.0 / max(box.width, box.height))
    let pic = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
    pages.append(pic.cgImage(forProposedRect: nil, context: nil, hints: nil).map(ocr) ?? "")
  }
}
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: pages))
`;
const OCR_BIN = path.join(STORE, 'ocr');
let ocrReady = null;
function ocrTool() {
  return (ocrReady ||= (async () => {
    const src = path.join(STORE, 'ocr.swift');
    if (fs.existsSync(OCR_BIN) && fs.existsSync(src) && fs.readFileSync(src, 'utf8') === OCR_SRC) return OCR_BIN;
    fs.writeFileSync(src, OCR_SRC);
    const was = job.phase;
    job.phase = "Preparing Apple's image tools (first time only, about a minute)";
    try { await sh('swiftc', ['-O', src, '-o', OCR_BIN]); return OCR_BIN; }
    catch (e) { console.warn(`text recognition unavailable — compiling it failed: ${e.message.split('\n')[0]}`); return null; }
    finally { job.phase = was; }
  })());
}

/* RHINO NOTES
     The Notes panel lives in the .3dm's properties table, near the start of
     the file, and Rhino writes it only when there are notes. So: read the first
     8 MB of a model that can run to hundreds, walk the chunks (a 4-byte code
     and a length — 8 bytes from Rhino 5 on, 4 before; codes with the top bit
     set carry no payload) to the notes chunk, and take its longest run of text.
     Checked against real Rhino 7 and 8 files for the walk; not yet against a
     file that HAS notes, so the text extraction is the unverified part. */
// Asynchronous on purpose, like every read of the user's files: a file kept in
// iCloud but not on this Mac downloads when read, and a synchronous read held
// the whole server — every click, every status check — for as long as that
// took. Measured: one status check took 37 s during a folder expansion.
async function rhinoNotes(f) {
  const fh = await fs.promises.open(f, 'r');
  const buf = Buffer.alloc(8 << 20);
  const { bytesRead: n } = await fh.read(buf, 0, buf.length, 0).finally(() => fh.close());
  const b = buf.subarray(0, n);
  const L = (+b.toString('latin1', 24, 32).trim() || 0) >= 50 ? 8 : 4;
  const len = (at) => (L === 8 ? Number(b.readBigUInt64LE(at)) : b.readUInt32LE(at));
  const table = b.indexOf(Buffer.from([0x14, 0x00, 0x00, 0x10]));   // properties table, 0x10000014
  if (table < 0) return [];
  const end = Math.min(n, table + 4 + L + len(table + 4));
  for (let at = table + 4 + L; at + 4 + L <= end;) {
    const code = b.readUInt32LE(at), size = len(at + 4);
    if (code === 0x20008022) {
      const c = b.subarray(at + 4 + L, at + 4 + L + size);
      const runs = [c, c.subarray(1)].flatMap(x => x.toString('utf16le').match(/[\x20-\x7e -ɏ‐-…\n\r\t]{3,}/g) || [])
        .concat(c.toString('utf8').match(/[\x20-\x7e\n\r\t]{8,}/g) || []);
      const best = runs.sort((x, y) => y.length - x.length)[0];
      return best && best.trim() ? [best.trim()] : [];
    }
    at += 4 + L + ((code & 0x80000000) ? 0 : size);
  }
  return [];
}

// textutil exits 0 even when it cannot read the file ("You don't have
// permission" goes to stderr, nothing to stdout), so nothing back is treated
// as a failure HERE, where that quirk lives. A genuinely empty document is
// therefore re-read on each crawl, which costs nothing.
async function textutilText(f) {
  const t = await sh('textutil', ['-convert', 'txt', '-stdout', f]);
  if (!t.trim()) throw new Error('textutil returned no text (locked, or not really this format)');
  return chunk(t);
}

// Returns an array of text units: pages, stories or chunks. Cached by path,
// size and date, so an unchanged file is read once — per READ_V, which goes up
// when the readers start finding more (2: near-empty PDF pages are read as
// pictures), so a file already read is read again once.
const READ_V = 2;
async function extract(file) {
  const st = await fs.promises.stat(file);
  const cached = path.join(TEXT, id(file, st.size, st.mtimeMs, READ_V) + '.json');
  if (fs.existsSync(cached)) return JSON.parse(await fs.promises.readFile(cached, 'utf8'));
  let units;
  try {
    units = await READERS[ext(file)](file);
  } catch (err) {
    // A locked, damaged or password-protected file must not stop the crawl —
    // but it must say so, or a missing result looks like a missing match.
    // NOT cached: most failures are passing (InDesign still starting, a file
    // still downloading from iCloud), and a cached empty result would skip
    // the file on every crawl until it happened to change.
    console.warn(`could not read ${file}: ${err.message.split('\n')[0]}`);
    return [];
  }
  units = units.map(u => String(u).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000));
  writeAtomic(cached, JSON.stringify(units));
  return units;
}

/* ------------------------------------------------------------- image info */

// One sips call per 200 files: per-file calls take minutes on a big shoot,
// one call for everything can overrun the argument limit.
async function sipsInfo(files) {
  const info = {};
  for (let i = 0; i < files.length; i += 200) {
    let out = '';
    try { out = await sh('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'make', '-g', 'model', '-g', 'creation', ...files.slice(i, i + 200)]); }
    catch (e) { out = e.stdout || ''; }   // one unreadable file must not hide the rest
    let cur = null;
    for (const line of out.split('\n')) {
      const m = line.match(/^\s+(\w+): (.*)$/);
      if (!m) { if (line) info[cur = line] = {}; continue; }
      if (cur && m[2] !== '<nil>') info[cur][m[1]] = m[2];
    }
  }
  return info;
}

/* ------------------------------------------------------------- findings */

// Same id for the same thing every crawl, so a decision already made sticks
// and a re-crawl only ever ADDS what is new.
function add(f) {
  f.id = id(f.project, f.kind, f.path, f.th ?? '');
  if (state.findings[f.id]) return false;
  state.findings[f.id] = { status: 'pending', ...f };
  rev++;
  return true;
}
// Goes up whenever a card is added or dropped. The page compares it to decide
// whether to fetch the cards again — instead of refetching and redrawing every
// card on every status check while a crawl runs.
let rev = 0;

// Text is identified by its CONTENT, not its page number: after pages are
// inserted into a PDF, "page 5" is different text, and keying on the number
// carried the old text and the old decision forward onto it. Pending cards for
// text the document no longer contains are dropped; decided ones stay, as a
// record of what was chosen. The clean-up only touches cards made by the same
// kind of pass (`from`: none for a crawl's title mentions, the folder's id for
// a folder's every-page cards) so the two cannot delete each other's — and
// only cards of the projects this pass was reading FOR (`scope`). Without
// that, a crawl for one project found nothing for the others (it was not
// looking) and deleted their waiting cards from the same documents: a card
// still on screen was gone on the server, and deciding it said "Unknown
// finding" — the loose end seen once in the 2026-10-04 handoff.
function addTexts(file, units, pick, from, scope) {
  const live = new Set();
  units.forEach((text, i) => {
    const th = id(text);
    for (const project of pick(text)) {
      live.add(project + th);
      job.added += add({ project, kind: 'text', path: file, unit: i, th, text, from });
    }
  });
  for (const [k, f] of Object.entries(state.findings)) {
    if (f.kind === 'text' && f.path === file && f.status === 'pending' && (f.from ?? null) === (from ?? null) && scope.includes(f.project) && !live.has(f.project + f.th)) { delete state.findings[k]; rev++; }
  }
}

let job = { running: false, phase: 'idle', done: 0, total: 0, added: 0, error: null };

// Asynchronous on purpose: listing a home folder takes a while, and a
// synchronous walk froze the server — no status, no thumbnails — until done.
async function walk(root, visit, depth = 0) {
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    alive();
    if (SKIP.test(e.name)) continue;
    const p = path.join(root, e.name);
    // the site's own images would match themselves and teach nothing
    if (p === REPO) continue;
    if (e.isDirectory()) { visit(p, true); if (depth < MAX_DEPTH) await walk(p, visit, depth + 1); }
    else if (e.isFile()) visit(p, false);
  }
}

/* A crawl is FOR chosen projects, never all of them at once: matching every
   title against a studio folder files the noise of thirty projects together,
   and the review queue drowns. Only those projects' titles, working titles and
   site pictures are looked for. Crawling the same folder again for another
   project is quick — document text and picture fingerprints are cached. */
function crawlTargets(slugs) {
  const projs = projects().filter(p => slugs.includes(p.slug)).map(p => ({ ...p, m: matcher([p.title, ...p.nicknames]) }));
  if (!projs.length) throw new Error('Pick a project to crawl for.');
  job.for = projs.map(p => p.title).join(', ');
  return projs;
}

async function crawl(root, slugs) {
  const indesign = state.indesign;
  const projs = crawlTargets(slugs);
  const docs = [], imgs = [];
  await walk(root, (p, dir) => {
    job.done++;
    const name = path.basename(p);
    for (const pr of projs) {
      if (!pr.m.name(dir ? name : path.parse(name).name)) continue;
      if (dir) job.added += add({ project: pr.slug, kind: 'folder', path: p });
      else if (IMAGE_EXT.has(ext(p))) job.added += add({ project: pr.slug, kind: 'image', path: p });
    }
    if (!dir && isDoc(ext(p), indesign)) docs.push(p);
    if (!dir && IMAGE_EXT.has(ext(p))) imgs.push(p);
  });
  persist();
  job.phase = 'Reading documents'; job.done = 0; job.total = docs.length;
  for (const d of docs) {
    const units = await extract(d);
    alive();   // a Stop during a long read must not still file that document
    addTexts(d, units, (text) => projs.filter(pr => pr.m.text.test(text)).map(pr => pr.slug), undefined, projs.map(pr => pr.slug));
    job.done++;
    if (job.done % 10 === 0) persist();
    await tick();
  }
  await lookalikes(projs, imgs, root);
}

// An accepted folder is about the project whether or not the title is written
// anywhere inside it, so everything in it becomes a finding.
async function expandFolder(f) {
  const indesign = state.indesign;
  const imgs = [], docs = [];
  await walk(f.path, (p, dir) => {
    if (dir) return;
    if (IMAGE_EXT.has(ext(p)) && imgs.length < MAX_FOLDER_IMAGES) imgs.push(p);
    else if (isDoc(ext(p), indesign)) docs.push(p);
  });
  for (const p of imgs) job.added += add({ project: f.project, kind: 'image', path: p, from: f.id });
  job.total = docs.length;
  for (const d of docs) {
    const units = await extract(d);
    alive();   // an Undo of this folder mid-read must not let its cards back in
    addTexts(d, units, (text) => text.length >= 40 ? [f.project] : [], f.id, [f.project]);
    job.done++;
    if (job.done % 10 === 0) persist();   // a big folder takes a while; a stop part-way keeps what was found
    await tick();
  }
  f.expanded = true;
}

async function sizeImages() {
  // Resolved once per image (sips reports real paths). A file moved or renamed
  // since it was found has nothing to measure: marked measured (null) so it is
  // not retried — its missing path used to throw and fail every later job.
  const todo = [];
  for (const f of Object.values(state.findings)) {
    if (f.kind !== 'image' || f.w !== undefined) continue;
    try { todo.push([f, fs.realpathSync(f.path)]); } catch { f.w = null; }
  }
  const info = await sipsInfo(todo.map(([, real]) => real));
  for (const [f, real] of todo) {
    const i = info[real] || {};
    f.w = +i.pixelWidth || null; f.h = +i.pixelHeight || null;
    f.camera = [i.make, i.model].filter(Boolean).join(' ') || null;
    f.taken = i.creation ? i.creation.replace(/^(\d+):(\d+):(\d+)/, '$1-$2-$3').slice(0, 10) : null;
  }
}

// Jobs run one after another, and every job starts and ends the same way:
// fresh counters; then image sizes measured and state saved, even on failure.
let queue = Promise.resolve();
let gen = 0;   // bumped by Stop: jobs queued before it are dropped when their turn comes
function run(phase, fn, target) {
  const mine = gen;
  queue = queue.then(async () => {
    if (mine !== gen) return;
    stopping = false;
    job = { running: true, phase, done: 0, total: 0, added: 0, error: null, target };
    try { await fn(); await sizeImages(); job.phase = 'Done'; }
    catch (e) { if (e === STOPPED) job.phase = 'Stopped'; else { job.error = e.message; console.warn(e); } }
    finally { prune(); flush(); job.running = false; }
  });
}

// Stop everything: the running job ends at its next check, and the queue is
// emptied. Folders that were waiting or mid-expansion are marked stopped, so
// opening Harvest again does not quietly start them over (accepting one again
// clears the mark). Before this, the only way to stop a 4,715-file folder
// was to quit — and reopening resumed it.
function stopAll() {
  gen++;
  if (job.running) stopping = true;
  for (const fid of queued) if (state.findings[fid]) state.findings[fid].stopped = true;
  if (job.running && state.findings[job.target]) state.findings[job.target].stopped = true;
  queued.clear();
  persist();
}

// A pending card whose file has been moved or deleted is dropped, so the count
// beside a project matches the cards shown. Decided ones stay as a record.
// A re-crawl finds the file again wherever it went.
function prune() {
  for (const [k, f] of Object.entries(state.findings)) if (f.status === 'pending' && !present(f.path)) { delete state.findings[k]; rev++; }
}

// The SAVED state is the queue of folders to expand: any accepted folder not
// yet expanded is queued whenever this runs — after an accept, and at startup.
// So closing the window mid-crawl strands nothing, and accepting the same
// folder twice (Accept, Undo, Accept) cannot expand it twice.
const queued = new Set();
function drain() {
  for (const f of Object.values(state.findings)) {
    if ((f.kind !== 'folder' && f.kind !== 'page') || f.status !== 'accepted' || f.expanded || f.stopped || queued.has(f.id)) continue;
    queued.add(f.id);
    run(`Reading ${f.title || path.basename(f.path)}`, async () => {
      // re-checked when its turn comes: it may have been undone while it waited
      try { if (f.status === 'accepted') await (f.kind === 'page' ? expandPage(f) : expandFolder(f)); } finally { queued.delete(f.id); }
    }, f.id);
  }
}

// Counts files under a folder, stopping once past `limit`: only "is it big?"
// matters, and a full count of a studio folder takes a while.
async function countFiles(dir, limit) {
  let n = 0;
  const stop = {};
  try {
    await walk(dir, (p, isDir) => { if (!isDir && ++n > limit) throw stop; });
  } catch (e) { if (e !== stop) throw e; }
  return n;
}

// Pointing at a folder — by hand, or by accepting a working title — is the
// same as accepting a match for it.
function acceptFolder(project, p, extra) {
  const f = { project, kind: isRemote(p) ? 'page' : 'folder', path: p, ...extra };
  add(f);
  state.findings[f.id].status = 'accepted';
  drain();
  return state.findings[f.id];
}

/* ------------------------------------------------------------- look-alikes */

/* INFERRING A WORKING TITLE FROM THE PICTURES
     A name match cannot find BUS STOP's files if they are all saved as "Wave
     House". But the photos on the site were exported from those files, so the
     same picture usually exists in that folder. Find it, and the folder it
     sits in names the work as it was called then.

   THE FINGERPRINT — a "difference hash"
     sips shrinks the image to 9 x 8 pixels; each of the 64 bits says whether a
     pixel is brighter than its right-hand neighbour. Re-exports, resizes and
     recompressions of one picture land within a few bits of each other;
     different pictures land ~32 apart. It does NOT survive a crop or a
     different angle — this finds the same photo, not the same object.
     Chosen over a learned image model because it is fifty lines, runs on
     what the Mac already has, and its mistakes are easy to see on a card.

   WHAT IT SUGGESTS
     The nearest folder above the found copy whose name is not filing furniture
     ("renders", "final", "2024", "Desktop"...), cleaned of dates and version
     tags. It is a SUGGESTION card with the two pictures side by side — the
     name is a guess and is editable before it is accepted. */

const LOOKALIKE = 6;   // bits of 64. Re-exports measured 0-4; unrelated photos ~32
const pop = (x) => { let n = 0; while (x) { x &= x - 1n; n++; } return n; };
// A near-blank image (white page, flat logo) hashes to almost all one bit and
// "matches" every other near-blank image. Those say nothing.
const useful = (h) => { if (!h) return false; const n = pop(BigInt('0x' + h)); return n >= 8 && n <= 56; };
// How close counts as "the same picture" scales with how much a fingerprint
// says. A detailed photo keeps the full 6 bits; a mostly flat one (an object on
// a plain ground) has few bits set, sits a few bits from any other flat image,
// and must match almost exactly. Measured: BUS STOP's 4th image, 15 bits set,
// was within 4-10 bits of 19 unrelated pictures on the old site at 6.
const tolerance = (a, b) => Math.min(LOOKALIKE, ...[a, b].map(x => { const n = pop(x); return Math.floor(Math.min(n, 64 - n) / 5); }));

let hashN = 0;
async function dhash(file) {
  const st = fs.statSync(file);
  const key = `dhash|${file}|${st.size}|${st.mtimeMs}`;
  if (key in cache) return cache[key];
  const tmp = path.join(STORE, `dh-${process.pid}-${hashN++}.bmp`);
  let h = null;
  try {
    await sh('sips', ['-z', '8', '9', '-s', 'format', 'bmp', file, '--out', tmp]);
    const b = fs.readFileSync(tmp);
    const off = b.readUInt32LE(10), w = b.readInt32LE(18), ht = b.readInt32LE(22);
    const bytes = b.readUInt16LE(28) / 8, stride = Math.ceil(w * bytes / 4) * 4;
    // BMP rows run bottom-up when the height is positive; pixels are B, G, R
    const grey = (x, y) => { const i = off + (ht > 0 ? ht - 1 - y : y) * stride + x * bytes; return 0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2]; };
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (grey(x, y) > grey(x + 1, y) ? 1n : 0n);
    h = bits.toString(16).padStart(16, '0');
  } catch (e) {
    // No fingerprint means no match — not worth stopping for, but said, so a
    // parsing mistake here cannot pass for "no look-alikes found".
    console.warn(`no fingerprint for ${file}: ${e.message.split('\n')[0]}`);
  }
  finally { fs.rmSync(tmp, { force: true }); }
  cache[key] = h;
  return h;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { alive(); await fn(items[i++]); } }));
}

const FILING = /^(renders?|images?|imgs?|photos?|pictures?|pics|exports?|finals?|output|out|web|jpe?gs?|pngs?|tiffs?|heics?|selects?|edits?|edited|process|wip|archive|old|new|misc|assets|links|docs?|documentation|stills|(hi|lo|low)[ -]?res|print|social|instagram|desktop|documents|downloads|dropbox|google drive|icloud drive.*|creative cloud files.*|projects?|work|clients?|portfolio|unsorted|screenshots?|jobs?|others?|temp|tmp|stuff|untitled.*|new folder.*|(\w+ )?versions?|variants?|options?|alts?|alternates?|v ?\d+|r ?\d+|\d+)$/i;
// "240512_Wave-House_v3" -> "Wave House"
const clean = (s) => s.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-.]+/g, ' ')
  .replace(/^(\s*\d+\b)+/, '').replace(/(\s+(v ?\d+|r ?\d+|final|\d+))+\s*$/i, '').replace(/\s+/g, ' ').trim();

function namingFolder(file, root) {
  // The crawl root counts too — pointing at "Wave House" itself is the most
  // direct way to ask — but never the home folder, which names the person.
  for (let d = path.dirname(file); (d === root || d.startsWith(root + path.sep)) && d !== HOME; d = path.dirname(d)) {
    const c = clean(path.basename(d));
    if (c.length > 2 && !FILING.test(c)) return d;
  }
  return null;
}

// Fingerprints of every picture already on the site, by project. Both the
// folder crawl and the website crawl compare against these.
async function siteFingerprints(projs) {
  const site = [];
  await pool(projs.flatMap(pr => pr.siteImages.map(f => ({ pr, f }))), 8, async ({ pr, f }) => {
    if (!fs.existsSync(f)) return;
    const h = await dhash(f);
    if (useful(h)) site.push({ pr, f, h: BigInt('0x' + h) });
  });
  return site;
}

async function lookalikes(projs, imgs, root) {
  job.phase = 'Comparing pictures'; job.done = 0; job.total = imgs.length;
  const site = await siteFingerprints(projs);
  const hits = {};
  await pool(imgs, 8, async (img) => {
    const h = await dhash(img);
    job.done++;
    if (!useful(h) || !site.length) return;
    const hb = BigInt('0x' + h);
    for (const s of site) {
      if (pop(hb ^ s.h) > tolerance(hb, s.h)) continue;
      // A copy of a picture already on the site belongs to that project
      // whatever it is called: a card for it, as well as any working title
      // its folder suggests. These were found and then dropped before.
      job.added += add({ project: s.pr.slug, kind: 'image', path: img, copyOf: s.f });
      if (s.pr.m.name(img)) continue;   // the path already names the project: no working title to learn
      const folder = namingFolder(img, root);
      ((hits[s.pr.slug + '|' + folder] ||= { pr: s.pr, folder, pairs: [] }).pairs).push([img, s.f]);
    }
  });
  for (const { pr, folder, pairs } of Object.values(hits)) {
    // No named folder above it means a stray copy (IMG_4412 on the Desktop):
    // a filename is a camera counter, not a working title.
    if (!folder) continue;
    const name = clean(path.basename(folder));
    if (!name || pr.m.name(name)) continue;
    job.added += add({ project: pr.slug, kind: 'nickname', path: folder, text: name, pairs: pairs.slice(0, 4), count: pairs.length });
  }
  writeAtomic(CACHE_FILE, JSON.stringify(cache));
}

/* ------------------------------------------------------------- websites */

/* WEBSITE MODE — for the old Squarespace site, whose pages are public but
   mostly unlinked. The sitemap (/sitemap.xml) lists every page, linked or not,
   and on Squarespace the pictures on each one too. Each page is read for its
   text and pictures and filed like a folder: a page whose address or title
   names a project becomes a PAGE card; accepting it pulls in its text and
   pictures. A page whose pictures match ones already on the site is offered
   for that project too — that is how "/prototype3" finds its project.

   Pictures stay on the website until written: thumbnails load from it, and an
   image is downloaded at full size only when Write copies it into the repo. */

const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh) Harvest' };
async function fetchText(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}
async function download(url, file) {
  if (fs.existsSync(file)) return file;
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
// Squarespace's image CDN resizes on request; any other host gets the original.
const sized = (url, w) => (/squarespace-cdn\.com/.test(url) ? `${url}?format=${w}w` : url);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', copy: '©' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
function htmlText(html) {
  return decode(html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|figcaption|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function sitePages(start) {
  const origin = new URL(start).origin;
  try {
    const xml = await fetchText(origin + '/sitemap.xml');
    const pages = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, u]) => ({
      url: decode((u.match(/<loc>([^<]+)/) || [])[1] || '').trim(),
      images: [...u.matchAll(/<image:loc>([^<]+)/g)].map(m => decode(m[1]).trim()),
    })).filter(p => p.url && new URL(p.url).origin === origin);
    if (pages.length) return pages;
  } catch (e) { console.warn(`no sitemap at ${origin} (${e.message}); reading only the page given`); }
  return [{ url: start, images: [] }];
}

// One page's title, text and pictures. Squarespace serves any page's content
// as JSON (?format=json) without the site's menus and footer, which would
// otherwise repeat on every page as text cards; other sites get their HTML.
const pageCache = new Map();
async function readPage(pg) {
  if (pageCache.has(pg.url)) return pageCache.get(pg.url);
  let title = '', html = '';
  try {
    const d = JSON.parse(await fetchText(pg.url + (pg.url.includes('?') ? '&' : '?') + 'format=json'));
    if (typeof d.mainContent !== 'string') throw new Error('not Squarespace');
    title = d.collection?.title || ''; html = d.mainContent;
  } catch {
    const full = await fetchText(pg.url);
    title = decode((full.match(/<title>([^<]*)/i) || [])[1] || '').trim();
    html = (full.match(/<main[\s\S]*?<\/main>/i) || full.match(/<body[\s\S]*<\/body>/i) || [full])[0];
  }
  const inline = [...html.matchAll(/(?:data-src|data-image|src)="(https?:\/\/[^"]+?\.(?:jpe?g|png|webp|heic|tiff?))(?:\?[^"]*)?"/gi)].map(m => decode(m[1]));
  const c = { title, units: chunk(htmlText(html)), images: [...new Set([...pg.images, ...inline])] };
  pageCache.set(pg.url, c);
  return c;
}

async function crawlSite(start, slugs) {
  const projs = crawlTargets(slugs);
  job.phase = 'Reading the sitemap';
  const pages = await sitePages(start);
  state.site = { start, pages: [] };
  job.phase = 'Reading pages'; job.total = pages.length; job.done = 0;
  const pics = [];
  for (const pg of pages) {
    let c;
    try { c = await readPage(pg); } catch (e) { console.warn(`could not read ${pg.url}: ${e.message}`); job.done++; continue; }
    // its sitemap pictures are kept with it: expanding the page later, after a
    // restart, has no other way to know them
    state.site.pages.push({ url: pg.url, title: c.title || new URL(pg.url).pathname, images: pg.images });
    const where = decodeURIComponent(new URL(pg.url).pathname);
    for (const pr of projs) {
      if (pr.m.name(where) || (c.title && pr.m.name(c.title))) job.added += add({ project: pr.slug, kind: 'page', path: pg.url, title: c.title });
    }
    addTexts(pg.url, c.units, (text) => projs.filter(pr => pr.m.text.test(text)).map(pr => pr.slug), undefined, projs.map(pr => pr.slug));
    for (const u of c.images) pics.push({ url: u, page: pg.url, title: c.title });
    job.done++;
    await tick();
  }
  persist();

  // Pictures that match the site's own say which project an unnamed page is.
  job.phase = 'Comparing pictures'; job.done = 0; job.total = pics.length;
  const site = await siteFingerprints(projs);
  const WEB = path.join(STORE, 'web');
  fs.mkdirSync(WEB, { recursive: true });
  const hits = {};
  await pool(pics, 6, async ({ url, page, title }) => {
    let h = null;
    try { h = await dhash(await download(sized(url, 300), path.join(WEB, id(url) + '.jpg'))); }
    catch (e) { console.warn(`could not fetch ${url}: ${e.message}`); }
    job.done++;
    if (!useful(h)) return;
    const hb = BigInt('0x' + h);
    for (const s of site) if (pop(hb ^ s.h) <= tolerance(hb, s.h)) ((hits[s.pr.slug + '|' + page] ||= { pr: s.pr, page, title, pairs: [] }).pairs).push([url, s.f]);
  });
  for (const { pr, page, title, pairs } of Object.values(hits)) {
    job.added += add({ project: pr.slug, kind: 'page', path: page, title, pairs: pairs.slice(0, 4), count: pairs.length });
  }
  writeAtomic(CACHE_FILE, JSON.stringify(cache));
}

// An accepted page is about the project, so all of it becomes cards. Its
// PICTURES arrive accepted: they were chosen once already, when the page was
// published (Robert, 2026-10-04 — "they should just transfer over"). Left
// pending they sat among a mis-linked folder's 1,950 cards, and one Clear of
// that queue took all 126 of Daily Shapes' with it. Its text still arrives
// pending: a page's words are a draft for the description, not the copy.
// A picture already decided keeps that decision (add() leaves it alone).
async function expandPage(f) {
  const c = await readPage((state.site?.pages || []).find(p => p.url === f.path) || { url: f.path, images: [] });
  // `auto`: accepted by this rule, not by Robert. Unlinking the page takes
  // these back with it, as it does its pending cards; deciding one clears it.
  for (const u of c.images) job.added += add({ project: f.project, kind: 'image', path: u, from: f.id, status: 'accepted', auto: true });
  addTexts(f.path, c.units, (text) => (text.length >= 40 ? [f.project] : []), f.id, [f.project]);
  f.expanded = true;
}

// One card's decision, from the card or from the bulk bar.
function decide(f, b) {
  for (const k of ['status', 'edited', 'target', 'alt', 'caption', 'used']) if (k in b) f[k] = b[k];
  if ('status' in b) delete f.auto;   // decided now: a page's Unlink leaves it alone
  // READ AGAIN — an accepted folder or page is read once. This reads it again,
  // adding only what is missing: cards cleared since come back, decided ones
  // are untouched. Also how a stopped one is finished.
  if (b.reread && (f.kind === 'folder' || f.kind === 'page') && f.status === 'accepted') { f.expanded = false; delete f.stopped; drain(); }
  // undoing the folder that is being expanded right now stops that expansion
  // (first, so it cannot add cards after the clean-up below)
  if (b.status && b.status !== 'accepted' && job.running && job.target === f.id) stopping = true;
  if ((f.kind === 'folder' || f.kind === 'page') && b.status === 'accepted') { delete f.stopped; drain(); }
  // Undoing or rejecting a folder (or page) takes back the cards it brought in
  // that are still undecided. Decided ones stay: they were a choice. Before
  // this, undoing a linked studio folder left its 1,950 cards behind.
  // (finished or not: one undone mid-expansion has brought cards in too)
  if ((f.kind === 'folder' || f.kind === 'page') && b.status && b.status !== 'accepted') {
    // and the pictures it accepted by itself (old-site pages), which no one has decided since
    for (const [k, g] of Object.entries(state.findings)) if (g.from === f.id && (g.status === 'pending' || (g.auto && g.status === 'accepted'))) { delete state.findings[k]; rev++; }
    f.expanded = false;
  }
  // An accepted working title is written to the project at once (it is what
  // the NEXT crawl matches on), and its folder is taken as the work's.
  if (f.kind === 'nickname' && b.status === 'accepted') {
    const name = String(f.edited ?? f.text).trim();
    if (name) addNickname(f.project, name);
    if (fs.statSync(f.path, { throwIfNoEntry: false })?.isDirectory()) acceptFolder(f.project, f.path);
    f.status = 'written';
  }
}

// Moving a card the crawler filed under the wrong project. It arrives in the
// right one ACCEPTED — choosing where it goes is the decision — and the
// original is kept as rejected and hidden. Simply relabelling it would let the
// next crawl, which files it by the same rule, put it back where it was.
function moveFinding(f, project) {
  if (f.project === project || f.status === 'written') return null;
  const { id: _old, status: _s, cleared: _c, expanded: _e, from: _f, auto: _a, ...rest } = f;
  const g = { ...rest, project };
  add(g);
  decide(state.findings[g.id], { status: 'accepted' });
  f.status = 'rejected'; f.cleared = true; f.movedTo = project;
  return g.id;
}

function addNickname(slug, name) {
  const file = path.join(PROJECTS, slug + '.mdoc');
  const { data, body } = readMdoc(file);
  if ((data.nicknames || []).some(n => compact(n) === compact(name))) return;
  data.nicknames = [...(data.nicknames || []), name];
  writeMdoc(file, data, body);
}

/* ------------------------------------------------------------- organize */

/* ORGANIZE — the second step. Collect gathers; this audits one project at a
   time, working on WORKS rather than files. Its members are the pictures
   already on the site plus every picture accepted in Collect. Copies of one
   work are stacked; one is kept; it gets its alt text and caption; the stacks
   are put in order; Save rewrites the project's picture list to exactly that.

   SAME WORK — two measures, because neither alone is enough (measured on BUS
   STOP's renders, 2026-10-04):
     • the difference hash already used for look-alikes catches re-exports,
       resizes and recompressions (0-6 bits), which Vision scores oddly far
       apart (a 600 px recompressed copy: 0.59);
     • Apple Vision's feature print catches crops and edits the hash cannot
       (70 % centre crop 0.26, rotated 0.21, PNG copy 0.04).
   Different views of one project score 0.40-0.57 — overlapping a heavy corner
   crop (0.50). So: at or under 0.30 is stacked automatically; 0.30-0.60 is
   offered as "Same work as #4?" for one click, never merged unasked.

   WHICH COPY IS KEPT — a copy already on the site or from the old website
   wins: it was vetted when it was published (Robert, 2026-10-04). Otherwise
   the largest with a real name (not IMG_1234). Choosing one by hand sticks.
   Only one copy per work is kept; no record of the others is (also his call). */

const PRINTS = path.join(STORE, 'prints');
fs.mkdirSync(PRINTS, { recursive: true });
const SAME_WORK = 0.30, MAYBE_SAME = 0.60;
const CAMERA_NAME = /^(img|dsc|dscf|dscn|_mg|_dsc|p\d|pxl|image|photo|screenshot|screen shot|untitled|scan)[\s_-]*\d*$/i;
const stem = (n) => n.replace(/\.[a-z0-9]+$/i, '').replace(/\+/g, ' ');
const realName = (n) => !CAMERA_NAME.test(stem(n).trim());

async function printsOf(files) {
  const out = new Array(files.length).fill(null), todo = [];
  for (const [i, f] of files.entries()) {
    try {
      const st = await fs.promises.stat(f);
      const c = path.join(PRINTS, id(f, st.size, st.mtimeMs) + '.json');
      if (fs.existsSync(c)) out[i] = JSON.parse(await fs.promises.readFile(c, 'utf8')); else todo.push([i, f, c]);
    } catch { /* gone or unreadable: no print, so it only stacks by hand */ }
  }
  const bin = todo.length ? await ocrTool() : null;
  for (let k = 0; bin && k < todo.length; k += 40) {
    const batch = todo.slice(k, k + 40);
    let res = [];
    try { res = JSON.parse(await sh(bin, ['--prints', ...batch.map(b => b[1])])); }
    catch (e) { console.warn(`no image prints for ${batch.length} pictures: ${e.message.split('\n')[0]}`); }
    batch.forEach(([i, , c], j) => { if (res[j]) { out[i] = res[j]; writeAtomic(c, JSON.stringify(res[j])); } });
  }
  return out;
}
const fpDist = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; t += d * d; } return Math.sqrt(t); };

// Everything that is a candidate picture for a project, in one shape.
async function members(slug) {
  const { data } = readMdoc(path.join(PROJECTS, slug + '.mdoc'));
  const out = [];
  for (const im of data.images || []) {
    const file = path.join(REPO, String(im.src || '').replace(/^\/+/, ''));
    if (!fs.existsSync(file)) continue;
    out.push({ key: 'site:' + im.src, kind: 'site', src: im.src, file, thumb: file, name: im.alt || path.basename(file), alt: im.alt || '', caption: im.caption || '' });
  }
  const WEB = path.join(STORE, 'web');
  fs.mkdirSync(WEB, { recursive: true });
  for (const f of Object.values(state.findings)) {
    if (f.project !== slug || f.kind !== 'image' || f.status !== 'accepted') continue;
    const remote = isRemote(f.path);
    let file = f.path;
    if (remote) { file = path.join(WEB, id(f.path) + '.jpg'); try { await download(sized(f.path, 300), file); } catch { continue; } }
    else if (!fs.existsSync(f.path)) continue;
    const from = f.from && state.findings[f.from];
    out.push({
      key: f.id, kind: remote ? 'web' : 'file', path: f.path, file, thumb: f.path,
      name: remote ? decodeURIComponent(new URL(f.path).pathname.split('/').pop()) : path.basename(f.path),
      w: f.w, h: f.h, taken: f.taken, alt: f.alt || '', caption: f.caption || '',
      page: from && from.kind === 'page' ? { url: from.path, title: from.title || '' } : null,
    });
  }
  return out;
}

function pickKeeper(ms) {
  return (ms.find(m => m.kind === 'site') || ms.find(m => m.kind === 'web')
    || [...ms].sort((a, b) => (realName(b.name) - realName(a.name)) || ((b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0)))[0]).key;
}

// Details others have written about a work: its page's text, documents that
// name its file, the date it was taken, what the site already says.
function suggestions(slug, ms) {
  const out = [];
  const add = (from, text) => { text = String(text || '').trim(); if (text && !out.some(x => x.text === text)) out.push({ from, text }); };
  for (const m of ms) { if (m.kind === 'site') add('On the site now', m.caption); if (m.taken) add('Taken', m.taken.slice(0, 4)); }
  const stems = [...new Set(ms.map(m => stem(m.name)).filter(n => n.length >= 4 && realName(n)))];
  const pages = new Map(ms.filter(m => m.page).map(m => [m.page.url, m.page.title]));
  for (const f of Object.values(state.findings)) {
    if (f.project !== slug || f.kind !== 'text' || f.status === 'rejected') continue;
    const t = String(f.edited ?? f.text).replace(/\s+/g, ' ').trim();
    if (pages.has(f.path)) { add('From the page “' + (pages.get(f.path) || 'old site') + '”', t.slice(0, 280)); continue; }
    const hit = stems.find(n => t.toLowerCase().includes(n.toLowerCase()));
    if (hit) { const at = t.toLowerCase().indexOf(hit.toLowerCase()); add('Mentions ' + hit + ' — ' + (isRemote(f.path) ? 'web page' : path.basename(f.path)), t.slice(Math.max(0, at - 80), at + 200)); }
  }
  return out.slice(0, 6);
}

async function organize(slug) {
  const ms = await members(slug);
  const byKey = new Map(ms.map(m => [m.key, m]));
  const o = ((state.organize ||= {})[slug] ||= { stacks: [], apart: [] });
  // members that have left the project leave their stacks
  for (const t of o.stacks) t.members = t.members.filter(k => byKey.has(k));
  o.stacks = o.stacks.filter(t => t.members.length);

  const prints = await printsOf(ms.map(m => m.file));
  const hashes = await Promise.all(ms.map(m => dhash(m.file)));
  const P = new Map(ms.map((m, i) => [m.key, prints[i]])), Hh = new Map(ms.map((m, i) => [m.key, hashes[i]]));
  const near = (a, b) => { const pa = P.get(a), pb = P.get(b); return pa && pb ? fpDist(pa, pb) : Infinity; };
  const same = (a, b) => {
    const ha = Hh.get(a), hb = Hh.get(b);
    if (useful(ha) && useful(hb)) { const x = BigInt('0x' + ha), y = BigInt('0x' + hb); if (pop(x ^ y) <= tolerance(x, y)) return true; }
    return near(a, b) <= SAME_WORK;
  };

  // Only NEW members are grouped automatically; a stack Robert has split or
  // merged by hand is left as he made it.
  const placed = new Set(o.stacks.flatMap(t => t.members));
  for (const m of ms) {
    if (placed.has(m.key)) continue;
    const t = o.stacks.find(t => t.members.some(k => same(k, m.key)));
    if (t) t.members.push(m.key);
    else o.stacks.push({ id: id(slug, m.key), members: [m.key], alt: '', caption: '' });
    placed.add(m.key);
  }
  for (const t of o.stacks) {
    if (!t.chosen || !t.members.includes(t.keeper)) t.keeper = pickKeeper(t.members.map(k => byKey.get(k)));
    const keeper = byKey.get(t.keeper);
    if (!t.alt && keeper.alt && realName(keeper.alt)) t.alt = keeper.alt;   // never a filename as alt text
    if (!t.caption && keeper.caption) t.caption = keeper.caption;
  }

  // "Same work as #4?" — the closest other stacks in the maybe band
  const apart = new Set((o.apart || []).map(([a, b]) => [a, b].sort().join('|')));
  const maybe = (t) => o.stacks.filter(u => u !== t && !apart.has([t.id, u.id].sort().join('|')))
    .map(u => ({ id: u.id, d: Math.min(...t.members.flatMap(a => u.members.map(b => near(a, b)))) }))
    .filter(x => x.d > SAME_WORK && x.d <= MAYBE_SAME).sort((a, b) => a.d - b.d).slice(0, 2).map(x => x.id);

  persist();
  const view = (m) => ({ key: m.key, kind: m.kind, thumb: m.thumb, name: m.name, w: m.w, h: m.h, taken: m.taken, page: m.page });
  return {
    stacks: o.stacks.map((t, i) => ({
      id: t.id, n: i + 1, keeper: t.keeper, alt: t.alt, caption: t.caption, removed: !!t.removed, rotate: t.rotate || 0,
      members: t.members.map(k => view(byKey.get(k))),
      maybe: maybe(t).map(x => ({ id: x, n: o.stacks.findIndex(u => u.id === x) + 1 })),
      suggest: suggestions(slug, t.members.map(k => byKey.get(k))),
    })),
  };
}

/* EXTRACT TEXT — Organize's right-click on a work: the words in its kept copy,
   read by the same Vision helper as a PDF page with no text layer, arrive in
   the Text column as a passage of their own — accepted, and LEFT TO ORGANIZE,
   so Write does not put raw recognition into the description before
   Robert has placed it. Reading the same picture again finds the same passage
   (a card is keyed by its text), brought back if it was rejected. A website
   picture is read at full size, from the download Write makes anyway. */
async function extractText(slug, stack) {
  const t = state.organize?.[slug]?.stacks.find(x => x.id === stack);
  if (!t) throw new Error('That work is no longer here — reload.');
  const k = t.members.includes(t.keeper) ? t.keeper : t.members[0];
  const from = k.startsWith('site:') ? path.join(REPO, k.slice(5).replace(/^\/+/, '')) : state.findings[k]?.path;
  let file = from;
  if (from && isRemote(from)) {
    const DL = path.join(STORE, 'downloads');
    fs.mkdirSync(DL, { recursive: true });
    file = await download(sized(from, 2500), path.join(DL, id(from) + '.download'));
  }
  if (!file || !fs.existsSync(file)) throw new Error('That picture is not on this Mac any more.');
  const bin = await ocrTool();
  if (!bin) throw new Error('Text recognition is unavailable — the server log says why.');
  const [text] = JSON.parse(await sh(bin, ['--image', file]));
  if (!text.trim()) throw new Error('No text found in that picture.');
  const f = { project: slug, kind: 'text', path: from, th: id(text), text, status: 'accepted', target: 'organize' };
  add(f);
  const g = state.findings[f.id];
  if (g.status !== 'accepted') { g.status = 'accepted'; delete g.cleared; rev++; }
  persist();
  return g;
}

/* A PDF PAGE AS A PICTURE. A crawl reads a PDF's words, page by page, and
   never its pictures, so a portfolio page about BUS STOP arrives only as a
   text card (Robert, 2026-10-07: "I want the page"). From such a card the
   page itself is drawn as a JPEG — the whole page as Preview shows it — and
   filed as an accepted picture, so Organize stacks and keeps it like any
   other. Drawn by the Vision helper, which already draws pages to read them.
   ponytail: the whole page, margins and type included, not the photograph
   placed on it; pulling that out (the page's image objects, via CGPDF) if
   the layout around the picture gets in the way. */
async function pagePicture(fid) {
  const t = state.findings[fid];
  if (!t || t.kind !== 'text' || t.unit === undefined || !/\.(pdf|ai)$/i.test(t.path)) throw new Error('Only a page of a PDF can be added as a picture.');
  const st = await fs.promises.stat(t.path).catch(() => null);
  if (!st) throw new Error('That PDF is not on this Mac any more.');
  const dir = path.join(STORE, 'pages', id(t.path, st.size, st.mtimeMs));
  const out = path.join(dir, path.parse(t.path).name + ' p' + (t.unit + 1) + '.jpg');
  if (!fs.existsSync(out)) {
    const bin = await ocrTool();
    if (!bin) throw new Error('Drawing pages is unavailable — the server log says why.');
    fs.mkdirSync(dir, { recursive: true });
    await sh(bin, ['--page', t.path, String(t.unit), out, String(MAX_SIDE)]);
  }
  const f = { project: t.project, kind: 'image', path: out };
  add(f);
  const g = state.findings[f.id];
  if (g.status !== 'written') { g.status = 'accepted'; delete g.cleared; rev++; }
  await sizeImages();
  persist();
  return g;
}

function organizeOp(slug, b) {
  const o = state.organize?.[slug];
  if (!o) throw new Error('Open the project in Organize first.');
  const at = o.stacks.findIndex(t => t.id === b.stack), t = o.stacks[at];
  if (!t) throw new Error('That work is no longer here — reload.');
  if (b.op === 'keeper') { t.keeper = b.key; t.chosen = true; t.rotate = 0; }   // a turn belongs to the copy it was made for
  // ROTATE — kept as a quarter-turn count and shown at once; applied to the
  // file itself only on Save (sips turns it), so trying it out changes nothing
  if (b.op === 'rotate') t.rotate = (((t.rotate || 0) + (b.dir > 0 ? 90 : 270)) % 360);
  if (b.op === 'split') {   // "not this work": out into a stack of its own, right after
    t.members = t.members.filter(k => k !== b.key);
    o.stacks.splice(at + 1, 0, { id: id(slug, b.key, Date.now()), members: [b.key], alt: '', caption: '' });
    (o.apart ||= []).push([t.id, o.stacks[at + 1].id]);
    if (t.keeper === b.key) delete t.chosen;
  }
  // SEPARATE — undoing a stack wholesale: every copy but the kept one becomes
  // a work of its own, right after this one, all of them marked apart from
  // each other so "Same work as #N?" does not offer to put them back. For a
  // grouping (or a merge) that was simply wrong; one copy at a time is split.
  if (b.op === 'unstack') {
    const keep = t.members.includes(t.keeper) ? t.keeper : t.members[0];
    const made = t.members.filter(k => k !== keep).map(k => ({ id: id(slug, k, Date.now()), members: [k], alt: '', caption: '' }));
    t.members = [keep];
    o.stacks.splice(at + 1, 0, ...made);
    const ids = [t.id, ...made.map(u => u.id)];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) (o.apart ||= []).push([ids[i], ids[j]]);
  }
  if (b.op === 'merge') {
    const u = o.stacks.find(x => x.id === b.other);
    if (u && u !== t) { t.members.push(...u.members); if (!t.alt) t.alt = u.alt; if (!t.caption) t.caption = u.caption; o.stacks = o.stacks.filter(x => x !== u); }
  }
  if (b.op === 'apart') (o.apart ||= []).push([t.id, b.other]);
  // clamped, so a large step is "to the top" or "to the bottom" (the right-click menu's)
  if (b.op === 'move') { const to = Math.max(0, Math.min(o.stacks.length - 1, at + b.dir)); o.stacks.splice(at, 1); o.stacks.splice(to, 0, t); }
  // MOVE TO PROJECT — a work filed under the wrong project goes, all its
  // copies together, as ONE work in the other: its grouping, kept copy, turn,
  // alt and caption travel with it. Accepted copies move as Collect's Move
  // does. A copy already on THIS project's site is copied out of the repo
  // first, because this project's next Save deletes its file — the work stays
  // here marked removed, so that Save takes it off.
  if (b.op === 'moveto') {
    if (!b.to || b.to === slug || !fs.existsSync(path.join(PROJECTS, b.to + '.mdoc'))) throw new Error('Pick a project to move it to.');
    const map = new Map();
    for (const k of t.members) {
      if (k.startsWith('site:')) {
        const from = path.join(REPO, k.slice(5).replace(/^\/+/, ''));
        if (!fs.existsSync(from)) continue;
        const to = path.join(MOVED, id(slug, k) + ext(from));
        fs.copyFileSync(from, to);
        const g = { project: b.to, kind: 'image', path: to, alt: t.alt || '', caption: t.caption || '' };
        add(g);
        state.findings[g.id].status = 'accepted';
        map.set(k, g.id);
      } else if (state.findings[k]) { const n = moveFinding(state.findings[k], b.to); if (n) map.set(k, n); }
    }
    if (map.size) {
      const ot = ((state.organize ||= {})[b.to] ||= { stacks: [], apart: [] });
      const taken = new Set(ot.stacks.flatMap(u => u.members));
      const keys = [...map.values()].filter(k => !taken.has(k));
      if (keys.length) ot.stacks.push({ id: id(b.to, keys[0], Date.now()), members: keys, alt: t.alt || '', caption: t.caption || '',
        keeper: map.get(t.keeper), chosen: keys.includes(map.get(t.keeper)), rotate: t.rotate || 0 });
    }
    t.members = t.members.filter(k => k.startsWith('site:'));
    if (t.members.length) t.removed = true; else o.stacks.splice(at, 1);
    rev++;
  }
  if (b.op === 'field' && (b.field === 'alt' || b.field === 'caption')) t[b.field] = String(b.value ?? '');
  // a work's own button flips it; the header's says which way, so a mixed
  // selection of removed and kept works all lands the same way
  if (b.op === 'remove') t.removed = 'value' in b ? !!b.value : !t.removed;
  persist();
}

/* SAVE — the project's picture list becomes exactly the kept copies, in order.
   A kept copy already on the site keeps its file; a new one is imported as at
   Write. A picture now on the site whose work was removed, or that lost to
   another copy, is taken off — and its file deleted, because build.js ships
   everything under images/. That is the one destructive step, so it needs a
   second click when anything would go. All or nothing: a failed import removes
   what this save had copied and changes nothing else. */
// Turns a picture in the repo by quarter turns, clockwise. sips cannot write
// WebP, so a WebP comes out as a JPEG beside it and the old file goes. Width
// and height swap in the file header, which is where build.js reads them.
async function turn(src, deg) {
  const abs = path.join(REPO, String(src).replace(/^\/+/, ''));
  if (ext(abs) !== '.webp') { await sh('sips', ['-r', String(deg), abs]); return src; }
  const out = abs.replace(/\.webp$/i, '.jpg');
  await sh('sips', ['-r', String(deg), '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', abs, '--out', out]);
  fs.rmSync(abs);
  return src.replace(/\.webp$/i, '.jpg');
}

async function saveOrganize(slug, confirmed) {
  const o = state.organize?.[slug];
  if (!o) throw new Error('Open the project in Organize first.');
  await catchUp();
  const ms = await members(slug), byKey = new Map(ms.map(m => [m.key, m]));
  const keep = o.stacks.filter(t => !t.removed && byKey.has(t.keeper));
  const missing = keep.findIndex(t => !String(t.alt || '').trim() || !realName(t.alt.trim()));
  if (missing >= 0) throw new Error(`Work ${o.stacks.indexOf(keep[missing]) + 1} needs alt text — what is in the picture, in words, not a filename.`);
  // turn() goes through sips, which writes one frame of a GIF: refused here,
  // before anything is copied, rather than flattening the animation
  const isGif = (m) => { const p = String(m.path || m.src); return /\.gif$/i.test(isRemote(p) ? p.split(/[?#]/)[0] : p); };
  const turnedGif = keep.findIndex(t => t.rotate && isGif(byKey.get(t.keeper)));
  if (turnedGif >= 0) throw new Error(`Work ${o.stacks.indexOf(keep[turnedGif]) + 1} is a GIF, and turning one would keep a single frame. Turn it back, or turn the GIF itself before adding it.`);
  const file = path.join(PROJECTS, slug + '.mdoc');
  const { data, body } = readMdoc(file);
  const keptSite = new Set(keep.map(t => byKey.get(t.keeper)).filter(m => m.kind === 'site').map(m => m.src));
  const dropped = (data.images || []).map(i => i.src).filter(src => !keptSite.has(src));
  if (dropped.length && !confirmed) return { confirm: dropped.length };

  const images = [], copied = [];
  try {
    for (const t of keep) {
      const m = byKey.get(t.keeper);
      let src = m.src;
      if (m.kind !== 'site') {
        let n = 0;
        while (fs.existsSync(path.join(REPO, imgRel(slug, n)))) n++;
        copied.push(path.join(REPO, imgRel(slug, n)));
        src = await importImage(m.path, slug, n, m.w, m.h);
      }
      if (t.rotate) src = await turn(src, t.rotate);
      const rec = { src, alt: t.alt.trim() };
      if (String(t.caption || '').trim()) rec.caption = t.caption.trim();
      images.push(rec);
    }
  } catch (e) { for (const d of copied) fs.rmSync(d, { recursive: true, force: true }); throw e; }

  data.images = images;
  writeMdoc(file, data, body);
  const imagesDir = path.join(REPO, 'images', slug) + path.sep;
  for (const src of dropped) {
    const d = path.dirname(path.join(REPO, String(src).replace(/^\/+/, '')));
    if ((d + path.sep).startsWith(imagesDir)) fs.rmSync(d, { recursive: true, force: true });
  }
  // every accepted copy has now been dealt with; Collect stops listing them
  for (const t of o.stacks) for (const k of t.members) if (state.findings[k]) state.findings[k].status = t.removed ? 'rejected' : 'written';
  // rotate back to 0: the turn is in the file now, and keeping it would turn it again on the next Save
  o.stacks = keep.map((t, i) => ({ ...t, members: ['site:' + images[i].src], keeper: 'site:' + images[i].src, chosen: false, rotate: 0 }));
  o.apart = [];
  rev++;
  persist();
  return { saved: images.length, dropped: dropped.length };
}

/* ------------------------------------------------------------- writing */

async function importImage(src, slug, n, w, h) {
  // From a website: fetch the full-size picture first, then treat it as a file.
  if (isRemote(src)) {
    const DL = path.join(STORE, 'downloads');
    fs.mkdirSync(DL, { recursive: true });
    // Named by what the bytes ARE, not what the address says: a website can
    // serve a GIF under any name, and a GIF called .jpg would be copied as-is
    // and then rejected by build.js. Anything not JPEG/PNG/WebP/GIF is
    // converted below; a GIF stays a GIF, animation and all.
    const raw = await download(sized(src, 2500), path.join(DL, id(src) + '.download'));
    const head = fs.readFileSync(raw).subarray(0, 12);
    const kind = head.toString('latin1', 0, 4) === 'GIF8' ? '.gif' : head[0] === 0x89 ? '.png'
      : head.toString('latin1', 8, 12) === 'WEBP' ? '.webp' : head[0] === 0xff && head[1] === 0xd8 ? '.jpg' : '.img';
    src = raw.replace(/\.download$/, kind);
    fs.copyFileSync(raw, src);
    w = h = null;   // measured below, from the file actually downloaded
  }
  // Size unknown (sips gave no answer at crawl time): ask again now rather than
  // assume small, which copied 40 MB camera originals into the repo unshrunk.
  if (!w || !h) {
    const real = fs.realpathSync(src);
    const i = (await sipsInfo([real]))[real] || {};
    w = +i.pixelWidth; h = +i.pixelHeight;
    if (!w || !h) throw new Error(`cannot read the size of ${path.basename(src)} — re-export it as JPEG or PNG`);
  }
  const e = ext(src);
  if (e === '.gif' && fs.statSync(src).size > MAX_GIF) throw new Error(`${path.basename(src)} is ${Math.round(fs.statSync(src).size / 1048576)} MB — too big to put on the site as a GIF (the limit is ${MAX_GIF / 1048576} MB). Export it smaller, or remove that work.`);
  const outExt = KEEP_EXT.has(e) ? (e === '.jpeg' ? '.jpg' : e) : '.jpg';
  const dir = path.join(REPO, imgRel(slug, n));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'src' + outExt);
  const big = Math.max(w || 0, h || 0) > MAX_SIDE;
  // -Z only when the file is larger: sips would otherwise enlarge a small one
  const args = [];
  if (big) args.push('-Z', String(MAX_SIDE));
  if (outExt === '.jpg' && (big || !KEEP_EXT.has(e))) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '85');
  // copied, never through sips: sips cannot write WebP, and writes a GIF's
  // first frame only — so a GIF over MAX_SIDE goes in at its own size.
  // async: an iCloud original downloads as it is read
  if (!args.length || e === '.webp' || e === '.gif') await fs.promises.copyFile(src, out);
  else await sh('sips', [...args, src, '--out', out]);
  return `/${imgRel(slug, n)}/src${outExt}`;
}

// Text from a PDF must stay text. Without escaping, a page that starts with
// "# 3" or "- Materials" becomes a heading or a list — and headings are a
// thing the editor deliberately does not have.
const mdEscape = (t) => t
  .replace(/([\\`*_{}\[\]<>|])/g, '\\$1')
  .replace(/^(\s*)([#>+-])/gm, '$1\\$2')
  .replace(/^(\s*\d+)\./gm, '$1\\.');

async function write(slug) {
  await catchUp();
  const file = path.join(PROJECTS, slug + '.mdoc');
  const { data, body } = readMdoc(file);
  // only cards that carry content: folders, pages and working titles are
  // pointers, and treating an accepted page as text wrote "undefined" in
  // Text only. Pictures are written from Organize, where copies of one work
  // are stacked and one is kept; writing them here as well would put every
  // copy on the site.
  // A passage used as a work's caption (Organize) is not ALSO the description:
  // it stays accepted, and the works' save is what puts it on the site. One
  // LEFT TO ORGANIZE (`organize`: read out of a picture, or placed from the
  // Text column into Project details) is that panel's to write. All three are
  // one button on Organize, Write to project, which runs this last.
  const acc = Object.values(state.findings).filter(f => f.project === slug && f.status === 'accepted' && f.kind === 'text' && !['caption', 'organize'].includes(f.target));
  data.details = data.details || [];
  const paras = [];
  for (const f of acc) {
    const t = String(f.edited ?? f.text).trim();
    if (!t) continue;
    if (f.target === 'detail') data.details.push(...t.split('\n').map(s => s.trim()).filter(Boolean));
    else if (f.target === 'share') data.share_description = t.replace(/\s+/g, ' ');
    else paras.push(mdEscape(t));
  }
  writeMdoc(file, data, [body.trim(), ...paras].filter(Boolean).join('\n\n'));
  for (const f of acc) f.status = 'written';
  persist();
  return { written: acc.length };
}

/* ------------------------------------------------------------- events */

/* THE PAGE IS TOLD, NOT ASKING. It used to fetch /api/state every 1.2 s during
   a crawl and every 4 s otherwise — a request, a parse and a redraw check,
   for nothing most of the time (to-do 4; efficiency is Robert's stated
   priority). Now it holds one open connection (/api/events, server-sent
   events: built into every browser, nothing installed) and the server writes
   to it only when what the page shows has changed. An idle Harvest sends
   nothing at all.
   ponytail: "changed" is found by comparing a snapshot twice a second (in
   memory, about a millisecond), not by hooking every place state changes —
   twenty-odd call sites that would each have to remember. Hooks if this
   ever shows up in a profile. */
const listeners = new Set();
function stateView() {
  const pending = {};
  for (const f of Object.values(state.findings)) if (f.status === 'pending') pending[f.project] = (pending[f.project] || 0) + 1;
  return { root: state.root, home: HOME, job, rev, unpublished: [...unpublished],
    site: state.site && { start: state.site.start, pages: state.site.pages.map(({ url, title }) => ({ url, title })) },
    projects: projects().map(({ siteImages, order, ...pr }) => ({ ...pr, pending: pending[pr.slug] || 0 })) };
}
let lastSent = '', lastFinder = '';
// THE FINDER MENU'S PROJECT LIST. Finder's "Harvest ›" menu is drawn by an
// extension inside Harvest.app (tools/HarvestFinder.swift) that macOS keeps
// in a sandbox: it cannot ask this server, whose port changes every launch,
// and it can read only this one file. Rewritten whenever the list changes,
// and left in place on quit, so the menu works with Harvest closed.
const FINDER_FILE = path.join(STORE, 'finder.json');
setInterval(() => {
  const f = JSON.stringify(projects().map(({ slug, title, section, draft }) => ({ slug, title, section, draft })));
  if (f !== lastFinder) { lastFinder = f; writeAtomic(FINDER_FILE, f); }
  if (!listeners.size) return;
  const s = JSON.stringify(stateView());
  if (s === lastSent) return;
  lastSent = s;
  for (const res of listeners) res.write('data: ' + s + '\n\n');
}, 500).unref();

/* ------------------------------------------------------------- server */

let ORIGIN = '';
// where the right-click menu's "View on live site" goes. Becomes https://rmaciel.work/ at the DNS cutover (PUNCH-LIST).
const LIVE = 'https://rmaciel-work.netlify.app/';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, data) => { res.writeHead(code, { 'content-type': type }); res.end(data); };
  const json = (d) => send(200, 'application/json', JSON.stringify(d));
  // This server can read any file on the disk. Only this page may talk to it:
  // the Host check stops a website re-pointing a domain at 127.0.0.1, the
  // Origin check stops a website posting to it.
  if (req.headers.host !== ORIGIN.slice(7) || (req.headers.origin && req.headers.origin !== ORIGIN)) return send(403, 'text/plain', 'forbidden');
  try {
    const p = url.pathname;
    if (PAGE_FILES[p]) { res.setHeader('cache-control', 'no-store'); return send(200, PAGE_FILES[p][1], fs.readFileSync(path.join(PAGE_DIR, PAGE_FILES[p][0]))); }
    // the site's typeface, read from the repo so the two can never drift
    const font = p.match(/^\/fonts\/([\w-]+\.woff2)$/);
    if (font) return send(200, 'font/woff2', fs.readFileSync(path.join(REPO, 'fonts', font[1])));

    if (p === '/api/state') return json(stateView());
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('data: ' + JSON.stringify(stateView()) + '\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    if (p === '/api/ls') {
      const dir = path.resolve(url.searchParams.get('p') || HOME);
      const all = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !SKIP.test(e.name));
      const dirs = all.filter(e => e.isDirectory()).map(e => e.name);
      // the files Harvest can use, so one can be added by hand (see /api/addfile)
      // .indd only with "Read InDesign files" ticked: reading one opens InDesign (~3 min cold)
      const indd = url.searchParams.get('indesign') === '1';
      const files = all.filter(e => e.isFile() && (IMAGE_EXT.has(ext(e.name)) || isDoc(ext(e.name), indd))).map(e => e.name);
      const az = (a, b) => a.localeCompare(b);
      return json({ path: dir, dirs: dirs.sort(az), files: files.sort(az) });
    }
    if (p === '/api/organize' && req.method === 'GET') return json(await organize(url.searchParams.get('project')));
    if (p === '/api/findings') {
      const slug = url.searchParams.get('project');
      const hidden = url.searchParams.get('hidden') === '1';
      return json(Object.values(state.findings).filter(f => f.project === slug && (hidden || !f.cleared) && present(f.path)));
    }
    if (p === '/api/project' && req.method === 'GET') return json(projectData(url.searchParams.get('project')));
    // a mark as it is, transparency and all: the site's own icons and wordmarks, and uploads waiting for Save
    if (p === '/raw') {
      const q = url.searchParams.get('p') || '';
      const abs = q.startsWith('/images/') ? path.join(REPO, q) : path.resolve(q);   // a site path, as the project file stores it
      const ok = (abs.startsWith(path.join(REPO, 'images') + path.sep) || abs.startsWith(UPLOADS + path.sep)) && fs.existsSync(abs);
      const type = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext(abs)];
      if (!ok || !type) return send(404, 'text/plain', 'not found');
      // sandboxed: an SVG is a document that can carry script, and from this
      // address that script could call the API — opened directly, it must not run
      res.setHeader('content-security-policy', 'sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'');
      return send(200, type, fs.readFileSync(abs));
    }
    // A PDF a text card came from, for the right-click menu's "Open at page N":
    // served here so the browser's viewer can be sent to the page (#page=N),
    // which Preview cannot be. Only files a card names — this is not a way to
    // read any PDF on the disk. Streamed: a layout PDF runs to hundreds of MB.
    if (p === '/pdf') {
      const abs = path.resolve(url.searchParams.get('p') || '');
      if (!/\.(pdf|ai)$/i.test(abs) || !fs.existsSync(abs) || !Object.values(state.findings).some(f => f.path === abs)) return send(404, 'text/plain', 'not found');
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return fs.createReadStream(abs).pipe(res);
    }
    if (p === '/thumb') {
      const abs = url.searchParams.get('p');
      if (!IMAGE_EXT.has(ext(abs)) || !fs.existsSync(abs)) return send(404, 'text/plain', 'not found');
      // sips keeps one frame of a GIF, so a GIF the site would take is shown as itself; one over MAX_GIF stays a still (Write refuses it anyway)
      if (ext(abs) === '.gif' && fs.statSync(abs).size <= MAX_GIF) return send(200, 'image/gif', fs.readFileSync(abs));
      // Every thumbnail goes through sips, not just HEIC: a page of forty
      // full-size camera files is a gigabyte of decoding for the browser.
      const t = path.join(THUMBS, id(abs, fs.statSync(abs).mtimeMs) + '.jpg');
      if (!fs.existsSync(t)) await sh('sips', ['-Z', '480', '-s', 'format', 'jpeg', abs, '--out', t]);
      return send(200, 'image/jpeg', fs.readFileSync(t));
    }

    if (req.method !== 'POST') return send(404, 'text/plain', 'not found');
    const b = await body(req);
    if ('indesign' in b) state.indesign = !!b.indesign;   // read by every job, queued or not
    if (p === '/api/crawl') {
      if (!fs.statSync(b.root, { throwIfNoEntry: false })?.isDirectory()) throw new Error('That folder no longer exists.');
      const slugs = [].concat(b.projects || []);
      if (!slugs.length) throw new Error('Pick a project to crawl for.');
      state.root = b.root; persist();
      run('Listing files', () => crawl(b.root, slugs));
      return json({ ok: true });
    }
    if (p === '/api/finding') {
      const f = state.findings[b.id];
      if (!f) { console.warn(`a decision for card ${b.id}, which is no longer there`); throw new Error('That card is no longer there — the list has been refreshed.'); }
      decide(f, b);
      persist();
      return json(f);
    }
    // Several cards at once: a decision, or a move to another project.
    if (p === '/api/bulk') {
      for (const fid of b.ids || []) {
        const f = state.findings[fid];
        if (!f) continue;
        if (b.project) moveFinding(f, b.project); else decide(f, { status: b.status });
      }
      persist();
      return json({ ok: true });
    }
    // Rejected cards are hidden, not forgotten: they keep status 'rejected', so
    // add() still finds their id and a re-crawl cannot suggest them again.
    // FORGET — a card is deleted, not decided: nothing remembers it, so a later
    // crawl may suggest it again. Only undecided or rejected cards can be
    // forgotten; accepted and written ones are choices with consequences.
    if (p === '/api/forget') {
      let n = 0;
      for (const fid of [].concat(b.ids || [])) {
        const f = state.findings[fid];
        if (f && (f.status === 'pending' || f.status === 'rejected')) { delete state.findings[fid]; n++; }
      }
      if (n) { rev++; persist(); }
      return json({ forgotten: n });
    }
    if (p === '/api/clear') {
      for (const f of Object.values(state.findings)) if (f.project === b.project && f.status === 'rejected') f.cleared = true;
      persist();
      return json({ ok: true });
    }
    if (p === '/api/publish') return json(await publish());
    if (p === '/api/stop') { stopAll(); return json({ ok: true }); }
    if (p === '/api/organize') { organizeOp(b.project, b); return json({ ok: true }); }
    if (p === '/api/extract') return json(await extractText(b.project, b.stack));
    if (p === '/api/pagepicture') return json(await pagePicture(b.id));
    if (p === '/api/organize/save') return json(await saveOrganize(b.project, !!b.confirm));
    if (p === '/api/project') return json(await saveProject(b.project, b.data || {}, b.body));
    if (p === '/api/project/upload') return json({ upload: upload(b.name, b.data) });
    if (p === '/api/preview') { try { return json({ html: preview(b.body) }); } catch (e) { return json({ html: '', error: 'No preview: ' + e.message.split('\n')[0] }); } }
    if (p === '/api/newproject') { await catchUp(); const slug = newProject(b.title, b.section); persist(); return json({ slug }); }
    if (p === '/api/crawlsite') {
      let url = String(b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      new URL(url);   // throws on nonsense, before anything is queued
      const slugs = [].concat(b.projects || []);
      if (!slugs.length) throw new Error('Pick a project to crawl for.');
      run('Reading the sitemap', () => crawlSite(url, slugs));
      return json({ ok: true });
    }
    // ADD BY HAND — one file the crawler missed, filed under a project. A
    // picture arrives accepted (choosing it is the decision) and goes on to
    // Organize. A document is read as a job and its passages arrive PENDING:
    // a document holds more than the bit wanted, and accepting all of it
    // would write every paragraph. `from: 'manual'` keeps a crawl's clean-up
    // of that document's cards and this one's apart.
    if (p === '/api/addfile') {
      const file = path.resolve(String(b.path || ''));
      if (!b.project || !fs.existsSync(path.join(PROJECTS, b.project + '.mdoc'))) throw new Error('Pick a project first.');
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error('That file is gone.');
      if (IMAGE_EXT.has(ext(file))) {
        const f = { project: b.project, kind: 'image', path: file };
        add(f);
        const g = state.findings[f.id];
        if (g.status !== 'written') { g.status = 'accepted'; delete g.cleared; rev++; }
        await sizeImages();
        persist();
        return json({ kind: 'image', status: g.status });
      }
      if (!isDoc(ext(file), !!b.indesign)) throw new Error(ext(file) === '.indd' ? 'Tick "Read InDesign files" first — it opens InDesign, which is slow.' : 'Harvest cannot read that kind of file.');
      run(`Reading ${path.basename(file)}`, async () => {
        addTexts(file, await extract(file), (t) => t.trim() ? [b.project] : [], 'manual', [b.project]);
      });
      return json({ kind: 'text' });
    }
    if (p === '/api/link') {
      // Linking files EVERYTHING inside under one project. Fine for a project's
      // own folder; a disaster for a studio folder (that is how Daily Shapes
      // got 2,357 cards). Past 300 files it asks for a second click instead.
      if (!b.force && !isRemote(b.path)) {
        const n = await countFiles(b.path, 300);
        if (n > 300) return json({ confirm: true });
      }
      const f = acceptFolder(b.project, b.path, { linked: true });
      persist();
      return json(f);
    }
    if (p === '/api/write') return json(await write(b.project));
    // OPEN — the right-click menu's Show in Finder, Open and View on live site,
    // through macOS's `open`. Never anything `open` would RUN: a file opens
    // only if it is a picture or a document Harvest reads (an .app or a
    // .command would launch), a folder only if it is not an app, and an
    // address only on the web. Revealing in Finder runs nothing, so any path.
    if (p === '/api/open') {
      let target = String(b.path || '');
      if (b.project) {
        const pr = projects().find(x => x.slug === b.project);
        if (!pr) throw new Error('That project is gone.');
        target = LIVE + '#' + pr.section + '/' + pr.slug;
      }
      if (/^https?:\/\//i.test(target)) { execFile('open', [target]); return json({ ok: true }); }
      const file = path.resolve(target), st = fs.statSync(file, { throwIfNoEntry: false });
      if (!st) throw new Error('That is no longer where Harvest found it.');
      if (b.reveal) execFile('open', ['-R', file]);
      else if (b.page && /\.(pdf|ai)$/i.test(file)) execFile('open', [ORIGIN + '/pdf?p=' + encodeURIComponent(file) + '#page=' + Math.max(1, Math.round(b.page))]);
      else if (st.isDirectory() ? !/\.app$/i.test(file) : (IMAGE_EXT.has(ext(file)) || isDoc(ext(file), true))) execFile('open', [file]);
      else throw new Error('Harvest opens only pictures, documents and folders.');
      return json({ ok: true });
    }
    if (p === '/api/nickname') { addNickname(b.project, String(b.name || '').trim()); return json({ ok: true }); }
    send(404, 'text/plain', 'not found');
  } catch (e) {
    send(400, 'application/json', JSON.stringify({ error: e.message }));
  }
});

function body(req) {
  return new Promise((ok, no) => {
    let s = '';
    // 40 MB: an icon or wordmark arrives base64-encoded
    req.on('data', c => { s += c; if (s.length > 40e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
  });
}

// 127.0.0.1 only: this serves files off the disk and must not be reachable
// from anything else on the network.
// Catch up with GitHub before anything is read: Keystatic saves from the phone
// land there, not here. Quietly skipped offline or with local changes in the
// way. Here, not in a launcher, so the app and Harvest.command both get it.
try { execFileSync('git', ['-C', REPO, 'pull', '-q', '--ff-only'], { timeout: 20000, stdio: 'ignore' }); } catch {}
try { for (const s of changedProjects(execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'content', 'images'], { encoding: 'utf8' }))) unpublished.add(s); } catch {}

server.listen(0, '127.0.0.1', () => {
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
  console.log(`Harvest is open at ${ORIGIN}/\nClose this window (or press Ctrl-C) when you are done.`);
  if (!process.env.HARVEST_NO_OPEN) execFile('open', [ORIGIN + '/']);
  prune();
  try { sweep(); } catch (e) { console.warn('could not tidy Harvest\'s temporary copies: ' + e.message); }
  drain();   // folders accepted last time but never expanded
});

/* ------------------------------------------------------------- page */

/* The page lives in tools/harvest/ — page.html, page.css, page.js — read
   from disk on every request: an edit to the page needs only a reload (⌘R),
   not a restart. They were one String.raw template at the end of this file
   until 2026-10-04; split so the page's script can be syntax-checked on its
   own and edited without escaping in mind. Same bytes, no build step. */
const PAGE_DIR = path.join(__dirname, 'harvest');
const PAGE_FILES = { '/': ['page.html', 'text/html; charset=utf-8'], '/page.css': ['page.css', 'text/css; charset=utf-8'], '/page.js': ['page.js', 'text/javascript; charset=utf-8'] };
