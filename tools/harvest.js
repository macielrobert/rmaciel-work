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
const { execFile } = require('child_process');

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

// Formats build.js can measure go in as-is; HEIC/TIFF become JPEG on the way
// in. GIF is left out: build.js cannot read its size and every strip image
// needs one.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const KEEP_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Longest side written into the repo. Netlify's image CDN resizes per screen;
// this only keeps 40 MB camera files out of git.
const MAX_SIDE = 2400;
// Never descended into: system and app internals, and libraries that are
// thousands of files of someone else's structure.
const SKIP = /^(\.|node_modules$|Library$|Applications$)|\.(app|photoslibrary|lrdata|lrcat-data|fcpbundle|bundle|framework)$/i;
const MAX_DEPTH = 12;
const MAX_FOLDER_IMAGES = 300;   // per accepted folder; past this it is a dump, not a project

/* ------------------------------------------------------------- helpers */

const ext = (p) => path.extname(p).toLowerCase();
const id = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const tick = () => new Promise(r => setImmediate(r));   // let the server answer between chunks of work
// The exit code decides. stdout rides on the error, because sips exits non-zero
// for a batch with one bad file in it and the rest of its answer is still good.
const sh = (cmd, args) => new Promise((ok, no) =>
  execFile(cmd, args, { maxBuffer: 256 << 20, timeout: 600000 }, (e, out) => e ? no(Object.assign(e, { stdout: out })) : ok(out)));

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
function writeMdoc(file, data, body) {
  body = body.trim();
  fs.writeFileSync(file, `---\n${JSON.stringify(data, null, 2)}\n---\n${body ? body + '\n' : ''}`);
  projectsCache = null;
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
      draft: !!data.draft, nicknames: data.nicknames || [],
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
  '.txt': async (f) => chunk(fs.readFileSync(f, 'utf8')), '.md': async (f) => chunk(fs.readFileSync(f, 'utf8')),
  '.indd': async (f) => (await sh('osascript', [INDD_AS, f])).split('\x1e'),
};
const isDoc = (e, indesign) => Object.hasOwn(READERS, e) && (e !== '.indd' || indesign);

async function pdfText(f) { return JSON.parse(await sh('osascript', ['-l', 'JavaScript', PDF_JS, f])); }

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
// size and date, so an unchanged file is read once, ever.
async function extract(file) {
  const st = fs.statSync(file);
  const cached = path.join(TEXT, id(file, st.size, st.mtimeMs) + '.json');
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
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
  return true;
}

// Text is identified by its CONTENT, not its page number: after pages are
// inserted into a PDF, "page 5" is different text, and keying on the number
// carried the old text and the old decision forward onto it. Pending cards for
// text the document no longer contains are dropped; decided ones stay, as a
// record of what was chosen. The clean-up only touches cards made by the same
// kind of pass (`from`: none for a crawl's title mentions, the folder's id for
// a folder's every-page cards) so the two cannot delete each other's.
function addTexts(file, units, pick, from) {
  const live = new Set();
  units.forEach((text, i) => {
    const th = id(text);
    for (const project of pick(text)) {
      live.add(project + th);
      job.added += add({ project, kind: 'text', path: file, unit: i, th, text, from });
    }
  });
  for (const [k, f] of Object.entries(state.findings)) {
    if (f.kind === 'text' && f.path === file && f.status === 'pending' && (f.from ?? null) === (from ?? null) && !live.has(f.project + f.th)) delete state.findings[k];
  }
}

let job = { running: false, phase: 'idle', done: 0, total: 0, added: 0, error: null };

// Asynchronous on purpose: listing a home folder takes a while, and a
// synchronous walk froze the server — no status, no thumbnails — until done.
async function walk(root, visit, depth = 0) {
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.test(e.name)) continue;
    const p = path.join(root, e.name);
    // the site's own images would match themselves and teach nothing
    if (p === REPO) continue;
    if (e.isDirectory()) { visit(p, true); if (depth < MAX_DEPTH) await walk(p, visit, depth + 1); }
    else if (e.isFile()) visit(p, false);
  }
}

async function crawl(root) {
  const indesign = state.indesign;
  const projs = projects().map(p => ({ ...p, m: matcher([p.title, ...p.nicknames]) }));
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
    addTexts(d, await extract(d), (text) => projs.filter(pr => pr.m.text.test(text)).map(pr => pr.slug));
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
    addTexts(d, await extract(d), (text) => text.length >= 40 ? [f.project] : [], f.id);
    job.done++;
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
function run(phase, fn) {
  queue = queue.then(async () => {
    job = { running: true, phase, done: 0, total: 0, added: 0, error: null };
    try { await fn(); await sizeImages(); job.phase = 'Done'; }
    catch (e) { job.error = e.message; console.warn(e); }
    finally { prune(); flush(); job.running = false; }
  });
}

// A pending card whose file has been moved or deleted is dropped, so the count
// beside a project matches the cards shown. Decided ones stay as a record.
// A re-crawl finds the file again wherever it went.
function prune() {
  for (const [k, f] of Object.entries(state.findings)) if (f.status === 'pending' && !fs.existsSync(f.path)) delete state.findings[k];
}

// The SAVED state is the queue of folders to expand: any accepted folder not
// yet expanded is queued whenever this runs — after an accept, and at startup.
// So closing the window mid-crawl strands nothing, and accepting the same
// folder twice (Accept, Undo, Accept) cannot expand it twice.
const queued = new Set();
function drain() {
  for (const f of Object.values(state.findings)) {
    if (f.kind !== 'folder' || f.status !== 'accepted' || f.expanded || queued.has(f.id)) continue;
    queued.add(f.id);
    run(`Reading ${path.basename(f.path)}`, async () => {
      // re-checked when its turn comes: it may have been undone while it waited
      try { if (f.status === 'accepted') await expandFolder(f); } finally { queued.delete(f.id); }
    });
  }
}

// Pointing at a folder — by hand, or by accepting a working title — is the
// same as accepting a match for it.
function acceptFolder(project, p, extra) {
  const f = { project, kind: 'folder', path: p, ...extra };
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
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const FILING = /^(renders?|images?|imgs?|photos?|pictures?|pics|exports?|finals?|output|out|web|jpe?gs?|pngs?|tiffs?|heics?|selects?|edits?|edited|process|wip|archive|old|new|misc|assets|links|docs?|documentation|stills|(hi|lo|low)[ -]?res|print|social|instagram|desktop|documents|downloads|dropbox|google drive|icloud drive.*|creative cloud files.*|projects?|work|clients?|portfolio|unsorted|screenshots?|jobs?|others?|temp|tmp|stuff|untitled.*|new folder.*|v ?\d+|r ?\d+|\d+)$/i;
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

async function lookalikes(projs, imgs, root) {
  job.phase = 'Comparing pictures'; job.done = 0; job.total = imgs.length;
  const site = [];
  await pool(projs.flatMap(pr => pr.siteImages.map(f => ({ pr, f }))), 8, async ({ pr, f }) => {
    if (!fs.existsSync(f)) return;
    const h = await dhash(f);
    if (useful(h)) site.push({ pr, f, h: BigInt('0x' + h) });
  });
  const hits = {};
  await pool(imgs, 8, async (img) => {
    const h = await dhash(img);
    job.done++;
    if (!useful(h) || !site.length) return;
    const hb = BigInt('0x' + h);
    for (const s of site) {
      if (pop(hb ^ s.h) > LOOKALIKE) continue;
      if (s.pr.m.name(img)) continue;   // the path already names the project: nothing to learn
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

function addNickname(slug, name) {
  const file = path.join(PROJECTS, slug + '.mdoc');
  const { data, body } = readMdoc(file);
  if ((data.nicknames || []).some(n => compact(n) === compact(name))) return;
  data.nicknames = [...(data.nicknames || []), name];
  writeMdoc(file, data, body);
}

/* ------------------------------------------------------------- writing */

async function importImage(src, slug, n, w, h) {
  // Size unknown (sips gave no answer at crawl time): ask again now rather than
  // assume small, which copied 40 MB camera originals into the repo unshrunk.
  if (!w || !h) {
    const real = fs.realpathSync(src);
    const i = (await sipsInfo([real]))[real] || {};
    w = +i.pixelWidth; h = +i.pixelHeight;
    if (!w || !h) throw new Error(`cannot read the size of ${path.basename(src)} — re-export it as JPEG or PNG`);
  }
  const e = ext(src);
  const outExt = KEEP_EXT.has(e) ? (e === '.jpeg' ? '.jpg' : e) : '.jpg';
  const dir = path.join(REPO, imgRel(slug, n));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'src' + outExt);
  const big = Math.max(w || 0, h || 0) > MAX_SIDE;
  // -Z only when the file is larger: sips would otherwise enlarge a small one
  const args = [];
  if (big) args.push('-Z', String(MAX_SIDE));
  if (outExt === '.jpg' && (big || !KEEP_EXT.has(e))) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '85');
  if (!args.length || e === '.webp') fs.copyFileSync(src, out);   // sips cannot write WebP
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
  const file = path.join(PROJECTS, slug + '.mdoc');
  const { data, body } = readMdoc(file);
  const acc = Object.values(state.findings).filter(f => f.project === slug && f.status === 'accepted' && f.kind !== 'folder');
  for (const f of acc) if (f.kind === 'image' && !String(f.alt || '').trim()) throw new Error(`${path.basename(f.path)} needs alt text before it can be written — the build refuses an image without it.`);

  data.images = data.images || [];
  data.details = data.details || [];
  const paras = [], copied = [];
  for (const f of acc) {
    if (f.kind === 'image') {
      let n = data.images.length;
      while (fs.existsSync(path.join(REPO, imgRel(slug, n)))) n++;
      // All or nothing: if a later image fails, the ones already copied are
      // removed. Left behind they were unreferenced files that build.js ships
      // anyway (it copies all of images/), and a retry copied them again.
      copied.push(path.join(REPO, imgRel(slug, n)));
      let src;
      try { src = await importImage(f.path, slug, n, f.w, f.h); }
      catch (e) { for (const d of copied) fs.rmSync(d, { recursive: true, force: true }); throw e; }
      const rec = { src, alt: f.alt.trim() };
      if (String(f.caption || '').trim()) rec.caption = f.caption.trim();
      data.images.push(rec);
    } else {
      const t = String(f.edited ?? f.text).trim();
      if (!t) continue;
      if (f.target === 'detail') data.details.push(...t.split('\n').map(s => s.trim()).filter(Boolean));
      else if (f.target === 'share') data.share_description = t.replace(/\s+/g, ' ');
      else paras.push(mdEscape(t));
    }
  }
  writeMdoc(file, data, [body.trim(), ...paras].filter(Boolean).join('\n\n'));
  for (const f of acc) f.status = 'written';
  persist();
  return { written: acc.length };
}

/* ------------------------------------------------------------- server */

let ORIGIN = '';
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
    if (p === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    // the site's typeface, read from the repo so the two can never drift
    const font = p.match(/^\/fonts\/([\w-]+\.woff2)$/);
    if (font) return send(200, 'font/woff2', fs.readFileSync(path.join(REPO, 'fonts', font[1])));

    if (p === '/api/state') {
      const pending = {};
      for (const f of Object.values(state.findings)) if (f.status === 'pending') pending[f.project] = (pending[f.project] || 0) + 1;
      return json({ root: state.root, home: HOME, job, projects: projects().map(({ siteImages, order, ...pr }) => ({ ...pr, pending: pending[pr.slug] || 0 })) });
    }
    if (p === '/api/ls') {
      const dir = path.resolve(url.searchParams.get('p') || HOME);
      const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP.test(e.name)).map(e => e.name);
      return json({ path: dir, dirs: dirs.sort((a, b) => a.localeCompare(b)) });
    }
    if (p === '/api/findings') {
      const slug = url.searchParams.get('project');
      return json(Object.values(state.findings).filter(f => f.project === slug && fs.existsSync(f.path)));
    }
    if (p === '/thumb') {
      const abs = url.searchParams.get('p');
      if (!IMAGE_EXT.has(ext(abs)) || !fs.existsSync(abs)) return send(404, 'text/plain', 'not found');
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
      state.root = b.root; persist();
      run('Listing files', () => crawl(b.root));
      return json({ ok: true });
    }
    if (p === '/api/finding') {
      const f = state.findings[b.id];
      if (!f) throw new Error('Unknown finding.');
      for (const k of ['status', 'edited', 'target', 'alt', 'caption']) if (k in b) f[k] = b[k];
      if (f.kind === 'folder' && b.status === 'accepted') drain();
      // An accepted working title is written to the project at once (it is
      // what the NEXT crawl matches on), and its folder is taken as the work's.
      if (f.kind === 'nickname' && b.status === 'accepted') {
        const name = String(f.edited ?? f.text).trim();
        if (name) addNickname(f.project, name);
        if (fs.statSync(f.path, { throwIfNoEntry: false })?.isDirectory()) acceptFolder(f.project, f.path);
        f.status = 'written';
      }
      persist();
      return json(f);
    }
    if (p === '/api/link') {
      const f = acceptFolder(b.project, b.path, { linked: true });
      persist();
      return json(f);
    }
    if (p === '/api/write') return json(await write(b.project));
    if (p === '/api/nickname') { addNickname(b.project, String(b.name || '').trim()); return json({ ok: true }); }
    send(404, 'text/plain', 'not found');
  } catch (e) {
    send(400, 'application/json', JSON.stringify({ error: e.message }));
  }
});

function body(req) {
  return new Promise((ok, no) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 4e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
  });
}

// 127.0.0.1 only: this serves files off the disk and must not be reachable
// from anything else on the network.
server.listen(0, '127.0.0.1', () => {
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
  console.log(`Harvest is open at ${ORIGIN}/\nClose this window (or press Ctrl-C) when you are done.`);
  if (!process.env.HARVEST_NO_OPEN) execFile('open', [ORIGIN + '/']);
  prune();
  drain();   // folders accepted last time but never expanded
});

/* ------------------------------------------------------------- page */

const PAGE = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Harvest</title>
<style>
  /* The site's own face, colours and type scale, so this reads as a room of
     the same house. Tokens copied from index.html: --bg / --ink invert with
     the device theme, --accent-rgb does not. */
  @font-face { font-family:'PP Neue Montreal'; src:url('/fonts/PPNeueMontreal-Light.woff2') format('woff2'); font-weight:300; }
  @font-face { font-family:'PP Neue Montreal'; src:url('/fonts/PPNeueMontreal-Book.woff2') format('woff2'); font-weight:400; }
  :root { --bg:#000; --ink:#fff; --accent-rgb:143,143,153;
          --accent:rgba(var(--accent-rgb),.9); --accent-dim:rgba(var(--accent-rgb),.5); --m:20px; }
  @media (prefers-color-scheme: light) { :root { --bg:#fff; --ink:#000; } }
  * { box-sizing:border-box }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--ink); }
  body { font:300 11px/1.7 'PP Neue Montreal', -apple-system, system-ui, sans-serif; letter-spacing:.05em; display:grid; grid-template-rows:auto 1fr; }
  .cap { text-transform:uppercase; letter-spacing:.15em; }
  .dim { color:var(--accent); }
  .btn { color:var(--accent); cursor:pointer; background:none; border:0; padding:0; font:inherit; text-transform:uppercase; letter-spacing:.15em; text-align:left; }
  .btn:hover, .btn:focus-visible { color:var(--ink); outline:none; }
  .btn[disabled] { opacity:.35; pointer-events:none; }
  header { display:flex; gap:24px; align-items:baseline; padding:14px var(--m); border-bottom:1px solid var(--accent-dim); flex-wrap:wrap; }
  header h1 { font-size:13px; font-weight:400; margin:0; letter-spacing:.15em; }
  #status { margin-left:auto; }
  main { display:grid; grid-template-columns:260px 220px 1fr; min-height:0; }
  main > section { overflow:auto; padding:var(--m); border-right:1px solid var(--accent-dim); min-height:0; }
  main > section:last-child { border-right:0; padding:0; display:grid; grid-template-columns:repeat(3, 1fr); }
  h2 { font-size:11px; font-weight:400; margin:0 0 12px; color:var(--accent); }

  /* tree */
  #tree ul { list-style:none; margin:0; padding-left:12px; }
  #tree > ul { padding-left:0; }
  #tree li > span { display:block; cursor:pointer; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #tree li > span:hover { color:var(--ink); }
  #tree li > span.sel { color:var(--ink); }
  #tree li > span i { display:inline-block; width:12px; font-style:normal; }
  .tree-actions { margin:14px 0 0; display:grid; gap:6px; }

  /* projects */
  #projects div { cursor:pointer; color:var(--accent); padding:3px 0; display:flex; gap:8px; }
  #projects div:hover, #projects div.sel { color:var(--ink); }
  #projects div b { margin-left:auto; font-weight:400; }
  #projects div small { display:block; font-size:inherit; color:var(--accent-dim); }
  #nick { margin:0 0 14px; }
  .pairs { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin:8px 0 4px; }
  .pairs img { height:90px; margin:0; }
  .card input.big { font-size:13px; }
  #projects .sec { color:var(--accent-dim); margin-top:12px; cursor:default; }

  /* review columns */
  .col { overflow:auto; padding:var(--m); border-right:1px solid var(--accent-dim); min-height:0; }
  .col:last-child { border-right:0; }
  .col.rejected .card { opacity:.45; }
  .card { border-top:1px solid var(--accent-dim); padding:12px 0 16px; }
  .card img { width:100%; max-height:220px; object-fit:contain; display:block; margin-bottom:8px; }
  .src { color:var(--accent); overflow-wrap:anywhere; }
  .acts { display:flex; gap:16px; margin-top:8px; }
  textarea, input, select { display:block; width:100%; background:transparent; color:var(--ink);
    border:0; border-bottom:1px solid var(--accent-dim); border-radius:0; outline:none;
    font:inherit; letter-spacing:inherit; padding:4px 0 5px; margin-top:6px; }
  textarea { min-height:120px; resize:vertical; }
  textarea:focus, input:focus, select:focus { border-bottom-color:var(--ink); }
  select { appearance:none; cursor:pointer; color:var(--accent); }
  option { background:var(--bg); }
  ::placeholder { color:var(--accent-dim); }
  #write { margin:0 0 12px; }
  #msg { color:var(--ink); }
</style>
<header>
  <h1>HARVEST</h1>
  <span class="dim" id="rootline"></span>
  <label class="dim"><input type="checkbox" id="indesign" style="width:auto;display:inline;margin:0 6px 0 0">Read InDesign files (opens InDesign, slow)</label>
  <span class="dim" id="status"></span>
</header>
<main>
  <section>
    <h2 class="cap">Folders</h2>
    <div id="tree"></div>
    <div class="tree-actions">
      <button class="btn" id="crawl" disabled>Crawl this folder</button>
      <button class="btn" id="link" disabled>Link to project</button>
    </div>
  </section>
  <section>
    <h2 class="cap">Projects</h2>
    <input id="nick" placeholder="Add a working title" hidden>
    <div id="projects"></div>
  </section>
  <section id="review">
    <div class="col"><h2 class="cap">Pending <span id="n-pending"></span></h2><div id="pending"></div></div>
    <div class="col"><h2 class="cap">Accepted <span id="n-accepted"></span></h2><button class="btn" id="write" disabled>Write to project</button><div id="msg"></div><div id="accepted"></div></div>
    <div class="col rejected"><h2 class="cap">Rejected <span id="n-rejected"></span></h2><div id="rejected"></div></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const api = (p, b) => fetch(p, b && { method:'POST', body:JSON.stringify(b) }).then(async r => { const d = await r.json(); if (d.error) throw new Error(d.error); return d; });
const tilde = (p) => esc(p.replace(S.home, '~'));
const thumb = (p) => '<img loading="lazy" src="/thumb?p=' + encodeURIComponent(p) + '">';
let S = null, folder = null, project = null, findings = [], lastJob = '';

/* ---- tree: lazy, one level per click */
async function branch(li, p) {
  const d = await api('/api/ls?p=' + encodeURIComponent(p));
  const ul = document.createElement('ul');
  ul.innerHTML = d.dirs.map(n => '<li><span data-p="' + esc(d.path + '/' + n) + '"><i>›</i>' + esc(n) + '</span></li>').join('');
  li.appendChild(ul);
}
$('tree').addEventListener('click', async (e) => {
  const s = e.target.closest('span'); if (!s) return;
  document.querySelectorAll('#tree .sel').forEach(x => x.classList.remove('sel'));
  s.classList.add('sel'); folder = s.dataset.p; buttons();
  const li = s.parentElement, open = li.querySelector('ul');
  if (open) { open.remove(); s.querySelector('i').textContent = '›'; }
  else { s.querySelector('i').textContent = '⌄'; await branch(li, folder); }
});

/* ---- projects */
function drawProjects() {
  let last = null, h = '';
  for (const p of S.projects) {
    if (p.section !== last) { h += '<div class="sec cap">' + esc(p.section) + '</div>'; last = p.section; }
    h += '<div data-s="' + esc(p.slug) + '" class="' + (p.slug === project ? 'sel' : '') + '"><span>' + esc(p.title) + (p.draft ? ' · draft' : '') + (p.nicknames.length ? '<small>aka ' + p.nicknames.map(esc).join(', ') + '</small>' : '') + '</span><b>' + (p.pending || '') + '</b></div>';
  }
  $('projects').innerHTML = h;
}
$('projects').addEventListener('click', (e) => {
  const d = e.target.closest('[data-s]'); if (!d) return;
  save();   // anything typed on the previous project goes before its cards do
  project = d.dataset.s; $('msg').textContent = '';
  $('nick').hidden = false; $('nick').placeholder = 'Add a working title to ' + S.projects.find(p => p.slug === project).title; drawProjects(); buttons(); loadFindings();
});

/* ---- status */
function buttons() {
  // jobs queue on the server, so nothing here waits for a running one
  $('crawl').disabled = !folder;
  const pr = S && S.projects.find(p => p.slug === project);
  $('link').disabled = !folder || !project;
  $('link').textContent = pr ? 'Link to ' + pr.title : 'Link to project';
}
async function poll() {
  // Always reschedules, even when a request fails: one bad answer used to stop
  // polling for good, freezing the page on its last status.
  clearTimeout(poll.t);
  try { S = await api('/api/state'); }
  catch (e) { $('status').textContent = '⚠ ' + e.message; poll.t = setTimeout(poll, 4000); return; }
  const j = S.job;
  $('rootline').textContent = S.root ? 'Last crawl: ' + S.root : 'Pick a folder, then crawl it';
  $('status').textContent = j.error ? '⚠ ' + j.error
    : j.running ? j.phase + (j.total ? ' ' + j.done + ' / ' + j.total : ' · ' + j.done) + ' · ' + j.added + ' found'
    : j.phase === 'Done' ? 'Done · ' + j.added + ' new' : '';
  // redrawn only when it changed: this runs every 1-4 seconds
  const pj = JSON.stringify(S.projects);
  if (pj !== drawProjects.last) { drawProjects.last = pj; drawProjects(); }
  buttons();
  // any movement in the job means findings may have changed; a short job can
  // start and finish between two polls, so compare, do not watch for "running"
  // ...but never while a field is being typed in: a redraw replaces every
  // card and would throw away the unsaved text. It catches up on a later poll.
  // (not j.done: it moves with every file read, and would refetch every card
  // every poll while nothing new had been found)
  const key = [j.phase, j.added, j.running].join('|');
  if (key !== lastJob && project && !editing()) { loadFindings(); lastJob = key; }
  poll.t = setTimeout(poll, j.running ? 1200 : 4000);
}

/* ---- findings */
/* ONE SAVE PATH FOR EVERYTHING TYPED
   Each keystroke updates the local copy at once and queues a save; the saves
   run one after another on a single chain. Anything that depends on typed text
   (Accept, Write) waits for the chain first, so it can never overtake a save.
   A redraw draws from the local copy, so it cannot lose typing either; it is
   still skipped while a field has focus, only so the caret stays put. */
const dirty = new Map();   // finding id -> { field: value } not yet sent
let saving = Promise.resolve();
function save() {
  clearTimeout(save.t);
  // each save catches its own failure: one rejected link used to leave the
  // chain rejected for good, so every Accept and Write after it failed too
  for (const [id, fields] of dirty) saving = saving.then(() => api('/api/finding', { id, ...fields })).catch(e => { $('status').textContent = '⚠ ' + e.message; });
  dirty.clear();
  return saving;
}
const editing = () => { const a = document.activeElement; return !!(a && a.dataset && a.dataset.k); };
async function loadFindings() {
  findings = await api('/api/findings?project=' + encodeURIComponent(project));
  for (const [id, fields] of dirty) Object.assign(findings.find(f => f.id === id) || {}, fields);
  drawFindings();
}
const label = (f) => tilde(f.path) + (f.kind === 'text' && f.unit !== undefined ? ' · ' + (/\.(pdf|ai)$/i.test(f.path) ? 'page ' : 'part ') + (f.unit + 1) : '');
function card(f) {
  const acts = f.status === 'pending'
    ? '<button class="btn" data-a="accepted">Accept</button><button class="btn" data-a="rejected">Reject</button>'
    : f.status === 'written' ? '<span class="dim cap">Written</span>' : '<button class="btn" data-a="pending">Undo</button>';
  let h = '<div class="card" data-id="' + f.id + '">';
  if (f.kind === 'nickname') h += '<div class="cap dim">Working title?</div><input class="big" data-k="edited" value="' + esc(f.edited ?? f.text) + '">' +
    '<div class="pairs">' + (f.pairs || []).map(([found, site]) => thumb(site) + thumb(found)).join('') + '</div>' +
    '<div class="dim">On the site · found in ' + tilde(f.path) + (f.count > 4 ? ' (' + f.count + ' matches)' : '') + '</div>';
  if (f.kind === 'folder') h += '<div class="cap dim">Folder' + (f.linked ? ' · linked' : '') + '</div><div>' + tilde(f.path) + '</div>';
  if (f.kind === 'image') {
    h += thumb(f.path) + '<div class="src">' + label(f) + '</div><div class="dim">' + [f.w && f.w + '×' + f.h, f.camera, f.taken].filter(Boolean).map(esc).join(' · ') + '</div>';
    if (f.status === 'accepted') h += '<input data-k="alt" placeholder="Alt text — what is in the picture (required)" value="' + esc(f.alt) + '"><input data-k="caption" placeholder="Caption (optional)" value="' + esc(f.caption) + '">';
  }
  if (f.kind === 'text') {
    h += '<div class="src">' + label(f) + '</div><textarea data-k="edited">' + esc(f.edited ?? f.text) + '</textarea>';
    if (f.status === 'accepted') h += '<select data-k="target">' + [['description','Add to description'],['detail','Add as detail lines'],['share','Use as share description']].map(([v,t]) => '<option value="' + v + '"' + ((f.target || 'description') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
  }
  return h + '<div class="acts">' + acts + '</div></div>';
}
function drawFindings() {
  for (const col of ['pending', 'accepted', 'rejected']) {
    // folders and working titles first: accepting one is what fills the rest
    const rank = (f) => (f.kind === 'folder' || f.kind === 'nickname' ? 0 : 1);
    const list = findings.filter(f => f.status === col || (col === 'accepted' && f.status === 'written')).sort((a, b) => rank(a) - rank(b));
    $(col).innerHTML = list.map(card).join('');
    $('n-' + col).textContent = list.length || '';
  }
  $('write').disabled = !findings.some(f => f.status === 'accepted' && f.kind !== 'folder');
}
$('review').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('.card').dataset.id;
  const f = findings.find(x => x.id === id);
  try { await save(); Object.assign(f, await api('/api/finding', { id, status: b.dataset.a, indesign: $('indesign').checked })); }
  catch (err) { $('status').textContent = '⚠ ' + err.message; return; }
  drawFindings();
  if (f.kind === 'folder' || f.kind === 'nickname') poll();
});
$('review').addEventListener('input', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const id = e.target.closest('.card').dataset.id;
  findings.find(x => x.id === id)[k] = e.target.value;
  dirty.set(id, { ...dirty.get(id), [k]: e.target.value });
  clearTimeout(save.t); save.t = setTimeout(save, 400);
});

$('nick').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  await api('/api/nickname', { project, name: e.target.value });
  e.target.value = '';
  poll();
});
$('crawl').addEventListener('click', () => api('/api/crawl', { root: folder, indesign: $('indesign').checked }).then(poll).catch(e => alert(e.message)));
$('link').addEventListener('click', () => api('/api/link', { project, path: folder, indesign: $('indesign').checked }).then(poll).catch(e => alert(e.message)));
$('write').addEventListener('click', async () => {
  try {
    await save();
    const d = await api('/api/write', { project });
    $('msg').textContent = d.written + ' written into the project. Not live yet — tell Claude "publish".';
    loadFindings();
  } catch (e) { $('msg').textContent = '⚠ ' + e.message; }
});

(async () => {
  await poll();
  while (!S) await new Promise(r => setTimeout(r, 1000));   // first answer failed: wait for a retry
  const li = document.createElement('li');
  li.innerHTML = '<span data-p="' + esc(S.home) + '" class="sel"><i>⌄</i>~ ' + esc(S.home.split('/').pop()) + '</span>';
  const ul = document.createElement('ul'); ul.appendChild(li); $('tree').appendChild(ul);
  folder = S.home; buttons();
  await branch(li, S.home);
})();
</script>
</html>`;
