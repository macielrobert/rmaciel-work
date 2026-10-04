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
function writeMdoc(file, data, body) {
  body = body.trim();
  fs.writeFileSync(file, `---\n${JSON.stringify(data, null, 2)}\n---\n${body ? body + '\n' : ''}`);
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
  '.txt': async (f) => chunk(await fs.promises.readFile(f, 'utf8')), '.md': async (f) => chunk(await fs.promises.readFile(f, 'utf8')),
  '.indd': async (f) => (await sh('osascript', [INDD_AS, f])).split('\x1e'),
  '.3dm': rhinoNotes,
};
const isDoc = (e, indesign) => Object.hasOwn(READERS, e) && (e !== '.indd' || indesign);

// A PDF's own text layer first. Pages with none are pictures of text — Rhino
// exports tiled PNGs, and InDesign layouts built from them keep that — and only
// those pages go to text recognition, so an ordinary PDF stays fast.
async function pdfText(f) {
  const pages = JSON.parse(await sh('osascript', ['-l', 'JavaScript', PDF_JS, f]));
  const blank = pages.flatMap((t, i) => (t.trim() ? [] : [String(i)]));
  if (!blank.length) return pages;
  const bin = await ocrTool();
  if (!bin) return pages;
  const seen = JSON.parse(await sh(bin, [f, ...blank]));
  return pages.map((t, i) => (t.trim() ? t : seen[i] || ''));
}

/* TEXT RECOGNITION (OCR)
     Apple's own Vision framework, the one Live Text uses; nothing installed.
     It has no command-line tool, so a 30-line Swift helper is compiled once
     into the Harvest folder (about a minute, the first time a PDF needs it)
     and reused. Recompiled only when this source changes. Each page is drawn
     at ~3000 px on its long side: smaller loses 8 pt type on a 12 x 18 sheet. */
const OCR_SRC = `import Foundation
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
// size and date, so an unchanged file is read once, ever.
async function extract(file) {
  const st = await fs.promises.stat(file);
  const cached = path.join(TEXT, id(file, st.size, st.mtimeMs) + '.json');
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
    if (f.kind === 'text' && f.path === file && f.status === 'pending' && (f.from ?? null) === (from ?? null) && !live.has(f.project + f.th)) { delete state.findings[k]; rev++; }
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
    addTexts(d, units, (text) => projs.filter(pr => pr.m.text.test(text)).map(pr => pr.slug));
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
    addTexts(d, units, (text) => text.length >= 40 ? [f.project] : [], f.id);
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
    addTexts(pg.url, c.units, (text) => projs.filter(pr => pr.m.text.test(text)).map(pr => pr.slug));
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

// An accepted page is about the project, so all of it becomes cards.
async function expandPage(f) {
  const c = await readPage((state.site?.pages || []).find(p => p.url === f.path) || { url: f.path, images: [] });
  for (const u of c.images) job.added += add({ project: f.project, kind: 'image', path: u, from: f.id });
  addTexts(f.path, c.units, (text) => (text.length >= 40 ? [f.project] : []), f.id);
  f.expanded = true;
}

// One card's decision, from the card or from the bulk bar.
function decide(f, b) {
  for (const k of ['status', 'edited', 'target', 'alt', 'caption']) if (k in b) f[k] = b[k];
  // undoing the folder that is being expanded right now stops that expansion
  // (first, so it cannot add cards after the clean-up below)
  if (b.status && b.status !== 'accepted' && job.running && job.target === f.id) stopping = true;
  if ((f.kind === 'folder' || f.kind === 'page') && b.status === 'accepted') { delete f.stopped; drain(); }
  // Undoing or rejecting a folder (or page) takes back the cards it brought in
  // that are still undecided. Decided ones stay: they were a choice. Before
  // this, undoing a linked studio folder left its 1,950 cards behind.
  // (finished or not: one undone mid-expansion has brought cards in too)
  if ((f.kind === 'folder' || f.kind === 'page') && b.status && b.status !== 'accepted') {
    for (const [k, g] of Object.entries(state.findings)) if (g.from === f.id && g.status === 'pending') { delete state.findings[k]; rev++; }
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
  const { id: _old, status: _s, cleared: _c, expanded: _e, from: _f, ...rest } = f;
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
  if (b.op === 'merge') {
    const u = o.stacks.find(x => x.id === b.other);
    if (u && u !== t) { t.members.push(...u.members); if (!t.alt) t.alt = u.alt; if (!t.caption) t.caption = u.caption; o.stacks = o.stacks.filter(x => x !== u); }
  }
  if (b.op === 'apart') (o.apart ||= []).push([t.id, b.other]);
  if (b.op === 'move') { const to = at + b.dir; if (to >= 0 && to < o.stacks.length) [o.stacks[at], o.stacks[to]] = [o.stacks[to], t]; }
  // MOVE TO PROJECT — a work filed under the wrong project goes, all its
  // copies together, as ONE work in the other: its grouping, kept copy, turn,
  // alt and caption travel with it. Accepted copies move as Collect's Move
  // does. A copy already on THIS project's site is copied out of the repo
  // first, because this project's next Save deletes its file — the work stays
  // here marked removed, so that Save takes it off.
  if (b.op === 'moveto') {
    if (!b.to || b.to === slug || !fs.existsSync(path.join(PROJECTS, b.to + '.mdoc'))) throw new Error('Pick a project to move it to.');
    const MOVED = path.join(STORE, 'moved');
    fs.mkdirSync(MOVED, { recursive: true });
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
  if (b.op === 'remove') t.removed = !t.removed;
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
  const ms = await members(slug), byKey = new Map(ms.map(m => [m.key, m]));
  const keep = o.stacks.filter(t => !t.removed && byKey.has(t.keeper));
  const missing = keep.findIndex(t => !String(t.alt || '').trim() || !realName(t.alt.trim()));
  if (missing >= 0) throw new Error(`Work ${o.stacks.indexOf(keep[missing]) + 1} needs alt text — what is in the picture, in words, not a filename.`);
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
    // and then rejected by build.js. Anything not JPEG/PNG/WebP is converted
    // below — an animated GIF keeps its first frame.
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
  const outExt = KEEP_EXT.has(e) ? (e === '.jpeg' ? '.jpg' : e) : '.jpg';
  const dir = path.join(REPO, imgRel(slug, n));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'src' + outExt);
  const big = Math.max(w || 0, h || 0) > MAX_SIDE;
  // -Z only when the file is larger: sips would otherwise enlarge a small one
  const args = [];
  if (big) args.push('-Z', String(MAX_SIDE));
  if (outExt === '.jpg' && (big || !KEEP_EXT.has(e))) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '85');
  if (!args.length || e === '.webp') await fs.promises.copyFile(src, out);   // sips cannot write WebP; async: an iCloud original downloads as it is read
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
  // only cards that carry content: folders, pages and working titles are
  // pointers, and treating an accepted page as text wrote "undefined" in
  // Text only. Pictures are written from Organize, where copies of one work
  // are stacked and one is kept; writing them here as well would put every
  // copy on the site.
  const acc = Object.values(state.findings).filter(f => f.project === slug && f.status === 'accepted' && f.kind === 'text');
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
      return json({ root: state.root, home: HOME, job, rev, unpublished: [...unpublished],
        site: state.site && { start: state.site.start, pages: state.site.pages.map(({ url, title }) => ({ url, title })) },
        projects: projects().map(({ siteImages, order, ...pr }) => ({ ...pr, pending: pending[pr.slug] || 0 })) });
    }
    if (p === '/api/ls') {
      const dir = path.resolve(url.searchParams.get('p') || HOME);
      const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP.test(e.name)).map(e => e.name);
      return json({ path: dir, dirs: dirs.sort((a, b) => a.localeCompare(b)) });
    }
    if (p === '/api/organize' && req.method === 'GET') return json(await organize(url.searchParams.get('project')));
    if (p === '/api/findings') {
      const slug = url.searchParams.get('project');
      const hidden = url.searchParams.get('hidden') === '1';
      return json(Object.values(state.findings).filter(f => f.project === slug && (hidden || !f.cleared) && present(f.path)));
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
      const slugs = [].concat(b.projects || []);
      if (!slugs.length) throw new Error('Pick a project to crawl for.');
      state.root = b.root; persist();
      run('Listing files', () => crawl(b.root, slugs));
      return json({ ok: true });
    }
    if (p === '/api/finding') {
      const f = state.findings[b.id];
      if (!f) throw new Error('Unknown finding.');
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
    if (p === '/api/organize/save') return json(await saveOrganize(b.project, !!b.confirm));
    if (p === '/api/newproject') { const slug = newProject(b.title, b.section); persist(); return json({ slug }); }
    if (p === '/api/crawlsite') {
      let url = String(b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      new URL(url);   // throws on nonsense, before anything is queued
      const slugs = [].concat(b.projects || []);
      if (!slugs.length) throw new Error('Pick a project to crawl for.');
      run('Reading the sitemap', () => crawlSite(url, slugs));
      return json({ ok: true });
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
  /* the columns scroll; the window never does */
  html, body { margin:0; height:100%; overflow:hidden; background:var(--bg); color:var(--ink); }
  body { font:300 11px/1.7 'PP Neue Montreal', -apple-system, system-ui, sans-serif; letter-spacing:.05em; display:grid; grid-template-rows:auto 1fr; }
  .cap { text-transform:uppercase; letter-spacing:.15em; }
  .dim { color:var(--accent); }
  .btn { color:var(--accent); cursor:pointer; background:none; border:0; padding:0; font:inherit; text-transform:uppercase; letter-spacing:.15em; text-align:left; }
  .btn:hover, .btn:focus-visible { color:var(--ink); outline:none; }
  .btn[disabled] { opacity:.35; pointer-events:none; }
  header { display:flex; gap:24px; align-items:baseline; padding:14px var(--m); border-bottom:1px solid var(--accent-dim); }
  header label { white-space:nowrap; }
  header h1 { font-size:13px; font-weight:400; margin:0; letter-spacing:.15em; }
  #status { margin-left:auto; white-space:nowrap; }
  /* a long crawl path gives way, not Publish: it shortens with an ellipsis */
  #rootline { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #publish[disabled] { opacity:.35; }
  /* instant feedback: a hairline runs along the top while anything is saving */
  body.busy::before { content:''; position:fixed; top:0; left:0; height:2px; width:30%; background:var(--ink); animation:busy 1s linear infinite; z-index:9; }
  @keyframes busy { from { transform:translateX(-100%); } to { transform:translateX(400%); } }
  .btn:active { color:var(--ink); }
  .more { margin:14px 0; }
  #pfilter { display:grid; gap:4px; margin:0 0 8px; }
  #pfilter input, #pfilter select { margin:0; }
  #newcards { margin-left:10px; color:var(--ink); }
  main { display:grid; grid-template-columns:260px 220px 1fr; min-height:0; }
  main > section { overflow:auto; padding:var(--m); border-right:1px solid var(--accent-dim); min-height:0; }
  #review { border-right:0; padding:0; display:grid; grid-template-columns:repeat(3, 1fr); grid-template-rows:auto 1fr; }
  /* two pages: Collect (folders, projects, review) and Organize (projects, works) */
  #tabs { display:flex; gap:16px; }
  #tabs .btn.on { color:var(--ink); }
  #org { display:none; padding:0; border-right:0; }
  main.organize { grid-template-columns:220px 1fr; }
  main.organize > section:first-child, main.organize #review { display:none; }
  main.organize #org { display:block; }
  .orghead { position:sticky; top:0; z-index:2; background:var(--bg); padding:var(--m); border-bottom:1px solid var(--accent-dim); display:flex; gap:20px; align-items:baseline; flex-wrap:wrap; }
  #stacks { padding:0 var(--m) var(--m); }
  .stack { display:grid; grid-template-columns:minmax(220px, 360px) 1fr; gap:20px; padding:20px 0; border-bottom:1px solid var(--accent-dim); }
  .stack.removed { opacity:.35; }
  /* GRID — every work at once, as its kept copy, so copies the grouping
     missed can be seen side by side and ticked together. Three fixed sizes,
     not a slider: the count per row adapts, the cell does not. */
  #stacks.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(var(--cell, 160px), 1fr)); gap:12px; padding-top:var(--m); }
  .tile { cursor:pointer; position:relative; }
  .tile .keep { aspect-ratio:1; display:flex; align-items:center; justify-content:center; overflow:hidden; outline:1px solid transparent; }
  .tile .keep img { max-width:100%; max-height:100%; object-fit:contain; transform:rotate(var(--turn, 0deg)); }
  .tile.on .keep { outline-color:var(--ink); }
  .tile.removed { opacity:.35; }
  .tile small { display:block; font-size:10px; color:var(--accent); margin-top:4px; }
  .tile .spick { position:absolute; top:4px; right:4px; width:auto; margin:0; accent-color:var(--ink); }
  #orgviews .btn.on { color:var(--ink); }
  #orgmove { width:auto; margin:0; }
  .stack .keep { aspect-ratio:1; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  /* square frame so a quarter turn never spills out of it */
  .stack .keep img { max-width:100%; max-height:100%; object-fit:contain; display:block; transform:rotate(var(--turn, 0deg)); transition:transform .2s; }
  .turns { display:flex; gap:12px; align-items:baseline; margin-top:6px; }
  .stack .meta { color:var(--accent); margin-top:6px; overflow-wrap:anywhere; }
  .stack .top { display:flex; gap:14px; align-items:baseline; margin-bottom:8px; }
  .stack .top b { font-weight:400; font-size:13px; color:var(--ink); }
  .stack .top input { width:auto; margin:0; accent-color:var(--ink); }
  .copies { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
  .copy { width:96px; cursor:pointer; position:relative; }
  .copy img { width:96px; height:72px; object-fit:contain; display:block; outline:1px solid transparent; }
  .copy.on img { outline-color:var(--ink); }
  .copy .x { position:absolute; top:0; right:0; background:var(--bg); padding:0 4px; }
  .copy small { display:block; font-size:10px; color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chips { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
  .chip { text-align:left; text-transform:none; letter-spacing:.05em; }
  .chip i { font-style:normal; color:var(--accent-dim); display:block; }
  #bulk { grid-column:1 / -1; display:flex; gap:18px; align-items:baseline; padding:10px var(--m); border-bottom:1px solid var(--accent-dim); }
  #bulk select { width:auto; margin:0; }
  .card { position:relative; }
  .card .pick, .col h2 input { position:absolute; top:12px; right:0; width:auto; margin:0; accent-color:var(--ink); cursor:pointer; }
  .col h2 { position:relative; }
  .col h2 input { top:0; }
  .col h2 .btn { margin-left:10px; font-size:inherit; }
  #newp { display:grid; grid-template-columns:1fr auto; gap:6px; margin:0 0 14px; }
  #newp select { width:auto; }
  #newp #newgo { grid-column:1 / -1; }
  h2 { font-size:11px; font-weight:400; margin:0 0 12px; color:var(--accent); }

  /* tree */
  #tree ul { list-style:none; margin:0; padding-left:12px; }
  #tree > ul { padding-left:0; }
  #tree li > span { display:block; cursor:pointer; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #tree li > span:hover { color:var(--ink); }
  #tree li > span.sel { color:var(--ink); }
  #tree li > span i { display:inline-block; width:12px; font-style:normal; }
  .tree-actions { margin:0 0 14px; display:grid; gap:6px; }
  #pages:not(:empty) { margin:0 0 14px; padding-bottom:10px; border-bottom:1px solid var(--accent-dim); }
  #pages span { display:block; cursor:pointer; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #pages span:hover, #pages span.sel { color:var(--ink); }

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
  .col { overflow:auto; padding:0 var(--m) var(--m); border-right:1px solid var(--accent-dim); min-height:0; }
  /* the column's title, filter and actions stay pinned while its cards scroll;
     the column has no top padding so the pinned head sits flush, and carries
     the gap itself */
  .colhead { position:sticky; top:0; z-index:2; background:var(--bg); padding-top:var(--m); border-bottom:1px solid var(--accent-dim); margin-bottom:4px; }
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
  /* a drawn chevron, so a menu reads as a menu: appearance:none removed the arrow */
  select { appearance:none; cursor:pointer; color:var(--accent); padding-right:16px;
    background:linear-gradient(45deg, transparent 50%, var(--accent) 50%) right 6px center / 5px 5px no-repeat,
               linear-gradient(-45deg, transparent 50%, var(--accent) 50%) right 1px center / 5px 5px no-repeat; }
  #ptype { display:flex; gap:14px; }
  #ptype .btn.on { color:var(--ink); }
  option { background:var(--bg); }
  ::placeholder { color:var(--accent-dim); }
  #write { margin:0 0 12px; }
  #msg { color:var(--ink); }
</style>
<header>
  <h1>HARVEST</h1>
  <nav id="tabs"><button class="btn on" data-view="collect">Collect</button><button class="btn" data-view="organize">Organize</button></nav>
  <span class="dim" id="rootline"></span>
  <label class="dim"><input type="checkbox" id="indesign" style="width:auto;display:inline;margin:0 6px 0 0">Read InDesign files (opens InDesign, slow)</label>
  <span class="dim" id="status"></span>
  <button class="btn" id="stop" hidden>Stop</button>
  <button class="btn" id="publish" disabled>Publish</button>
</header>
<main>
  <section>
    <h2 class="cap">Folders</h2>
    <!-- above the tree, not below it: a home folder lists dozens of folders,
         and underneath them the buttons were scrolled out of sight -->
    <div class="tree-actions">
      <button class="btn" id="crawl" disabled>Crawl this folder</button>
      <button class="btn" id="link" disabled>Link to project</button>
      <input id="site" placeholder="Or a website, e.g. rmaciel.work">
      <button class="btn" id="crawlsite">Crawl website</button>
    </div>
    <div id="pages"></div>
    <div id="tree"></div>
  </section>
  <section>
    <h2 class="cap">Projects</h2>
    <div id="newp">
      <input id="newtitle" placeholder="New project title">
      <select id="newsection"><option value="build">BUILD</option><option value="design">DESIGN</option><option value="art">ART</option></select>
      <button class="btn" id="newgo" disabled>Create project</button>
    </div>
    <input id="nick" placeholder="Add a working title" hidden>
    <div id="projects"></div>
  </section>
  <section id="review">
    <div id="bulk">
      <span class="dim" id="n-sel">Tick cards to select</span>
      <button class="btn" data-bulk="accepted" disabled>Accept</button>
      <button class="btn" data-bulk="rejected" disabled>Reject</button>
      <button class="btn" id="bforget" disabled title="Delete the ticked pending or rejected cards without deciding them; a later crawl may suggest them again">Forget</button>
      <select id="moveto" disabled><option value="">Move to project…</option></select>
    </div>
    <div class="col"><div class="colhead"><h2 class="cap">Pending <span id="n-pending"></span><button class="btn" id="newcards" hidden>Show new</button><button class="btn" id="pclear" title="Take the pending cards now showing out of the queue without rejecting them. A later crawl can suggest them again.">Clear</button><input type="checkbox" data-all="pending" title="Select all"></h2>
      <div id="pfilter"><div id="ptype"><button class="btn on" data-t="">All</button><button class="btn" data-t="files">Files</button><button class="btn" data-t="web">Website</button></div><input id="pq" placeholder="Filter by path, title or text"><select id="psrc"></select><select id="psort"><option value="group">Folders and pages first</option><option value="source">By source, A–Z</option><option value="kind">By type</option></select></div></div>
      <div id="pending"></div></div>
    <div class="col"><div class="colhead"><h2 class="cap">Accepted <span id="n-accepted"></span><input type="checkbox" data-all="accepted" title="Select all"></h2><button class="btn" id="write" disabled>Write text to project</button><div id="msg"></div></div><div id="accepted"></div></div>
    <div class="col rejected"><div class="colhead"><h2 class="cap">Rejected <span id="n-rejected"></span><button class="btn" id="clear" title="Hide these. They stay remembered as rejected, so they are never suggested again.">Hide</button><button class="btn" id="rforget" title="Forget these rejections, so the same things can be suggested again by a later crawl.">Forget all</button></h2></div><div id="rejected"></div></div>
  </section>
  <section id="org">
    <div class="orghead">
      <span id="orgtitle" class="cap">Pick a project</span>
      <span class="dim" id="orgcount"></span>
      <span id="orgviews"><button class="btn" data-ov="list">List</button> <button class="btn" data-ov="grid">Grid</button> <span id="orgsizes"><button class="btn" data-cell="100">S</button> <button class="btn" data-cell="170">M</button> <button class="btn" data-cell="280">L</button></span></span>
      <button class="btn" id="orgmerge" disabled title="The ticked works are versions of one work: stack them, keep one">Same work — merge</button>
      <select id="orgmove" disabled></select>
      <button class="btn" id="orgsave" disabled>Save to project</button>
      <span class="dim" id="orgmsg"></span>
    </div>
    <div id="stacks"></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const api = (p, b) => fetch(p, b && { method:'POST', body:JSON.stringify(b) }).then(async r => { const d = await r.json(); if (d.error) throw new Error(d.error); return d; });
const tilde = (p) => esc(p.replace(S.home, '~'));
// a picture on a website loads straight from it, at a thumbnail size where the host can make one
const thumb = (p) => '<img loading="lazy" src="' + (/^https?:/.test(p) ? esc(/squarespace-cdn\.com/.test(p) ? p + '?format=500w' : p) : '/thumb?p=' + encodeURIComponent(p)) + '">';
let S = null, folder = null, project = null, findings = [], loadedRev = -1;
let inflight = 0;   // requests sent and not yet answered
const busy = (d) => { inflight += d; document.body.classList.toggle('busy', inflight > 0); };
const picked = new Set();   // ticked card ids, kept across redraws

/* ---- tree: lazy, one level per click */
async function branch(li, p) {
  const d = await api('/api/ls?p=' + encodeURIComponent(p));
  const ul = document.createElement('ul');
  ul.innerHTML = d.dirs.map(n => '<li><span data-p="' + esc(d.path + '/' + n) + '"><i>›</i>' + esc(n) + '</span></li>').join('');
  li.appendChild(ul);
}
// pages from the last website crawl: picking one is like picking a folder, for Link
function drawPages() {
  const ps = (S.site && S.site.pages) || [];
  $('pages').innerHTML = ps.length ? '<div class="dim cap">' + esc(new URL(S.site.start).host) + '</div>' + ps.map(p => '<span data-p="' + esc(p.url) + '" title="' + esc(p.url) + '">' + esc(p.title) + '</span>').join('') : '';
}
$('pages').addEventListener('click', (e) => {
  const s = e.target.closest('span'); if (!s) return;
  document.querySelectorAll('#tree .sel, #pages .sel').forEach(x => x.classList.remove('sel'));
  s.classList.add('sel'); folder = s.dataset.p; buttons();
});
$('tree').addEventListener('click', async (e) => {
  const s = e.target.closest('span'); if (!s) return;
  document.querySelectorAll('#tree .sel, #pages .sel').forEach(x => x.classList.remove('sel'));
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
  shown.pending = shown.accepted = shown.rejected = 100;
  $('psrc').value = '';   // sources differ per project; the search text carries over
  $('nick').hidden = false; $('nick').placeholder = 'Add a working title to ' + S.projects.find(p => p.slug === project).title; drawProjects(); buttons();
  if (view === 'organize') loadOrg(); else loadFindings();
});

/* ---- status */
function buttons() {
  // jobs queue on the server, so nothing here waits for a running one
  const pr = S && S.projects.find(p => p.slug === project);
  // every crawl is for the selected project; without one there is nothing to look for
  $('crawl').disabled = !folder || !pr || /^https?:/.test(folder);   // a web page is crawled from its site, not on its own
  $('crawl').textContent = pr ? 'Crawl this folder for ' + pr.title : 'Pick a project to crawl for';
  $('crawlsite').disabled = !pr;
  $('crawlsite').textContent = pr ? 'Crawl website for ' + pr.title : 'Pick a project to crawl for';
  $('link').disabled = !folder || !project;
  if (!$('link').dataset.armed) $('link').textContent = pr ? 'Link to ' + pr.title : 'Link to project';   // armed: keep the warning up
}
async function poll() {
  // Always reschedules, even when a request fails: one bad answer used to stop
  // polling for good, freezing the page on its last status.
  clearTimeout(poll.t);
  try { S = await api('/api/state'); }
  catch (e) { $('status').textContent = '⚠ ' + e.message; poll.t = setTimeout(poll, 4000); return; }
  const j = S.job;
  $('rootline').textContent = S.root ? 'Last crawl: ' + S.root : 'Pick a folder, then crawl it';
  // a message just shown to the user (moved, published, an error) stays put
  // for five seconds instead of being replaced by the next status check
  if (Date.now() - (say.at || 0) > 5000) $('status').textContent = j.error ? '⚠ ' + j.error
    : j.running ? j.phase + (j.for ? ' for ' + j.for : '') + (j.total ? ' ' + j.done + ' / ' + j.total : ' · ' + j.done) + ' · ' + j.added + ' found'
    : j.phase === 'Done' ? 'Done · ' + j.added + ' new'
    : j.phase === 'Stopped' ? 'Stopped · ' + j.added + ' found before stopping' : '';
  $('stop').hidden = !j.running;
  // redrawn only when it changed: this runs every 1-4 seconds
  const pj = JSON.stringify(S.projects);
  if (pj !== drawProjects.last) { drawProjects.last = pj; drawProjects(); }
  const sj = JSON.stringify(S.site);
  if (sj !== drawPages.last) { drawPages.last = sj; drawPages(); }
  buttons();
  const n = S.unpublished.length;
  $('publish').disabled = !n;
  $('publish').textContent = n ? 'Publish ' + n : 'Publish';
  $('publish').title = n ? 'Waiting to go live: ' + S.unpublished.join(', ') : 'Nothing waiting to go live';
  // Cards are fetched again only when the server's revision has moved, and
  // never while a field is being typed in or one of this page's own changes
  // is still on its way. During a crawl the new cards wait behind a button
  // rather than redrawing the column under the pointer every second.
  const changed = project && S.rev !== loadedRev;
  const quiet = !editing() && !inflight;
  if (view === 'collect' && changed && quiet && (!j.running || !findings.length)) loadFindings();
  $('newcards').hidden = !(changed && j.running && findings.length);
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
  loadedRev = S ? S.rev : -1;
  findings = await api('/api/findings?project=' + encodeURIComponent(project));
  for (const [id, fields] of dirty) Object.assign(findings.find(f => f.id === id) || {}, fields);
  drawFindings();
}
const label = (f) => tilde(f.path) + (f.kind === 'text' && f.unit !== undefined ? ' · ' + (/\.(pdf|ai)$/i.test(f.path) ? 'page ' : 'part ') + (f.unit + 1) : '');
function card(f) {
  const acts = f.status === 'pending'
    ? '<button class="btn" data-a="accepted">Accept</button><button class="btn" data-a="rejected">Reject</button>'
    : f.status === 'written' ? '<span class="dim cap">Written</span>'
    : '<button class="btn" data-a="pending">Undo</button>' + (f.status === 'rejected' ? '<button class="btn" data-forget="1" title="Forget this rejection: a later crawl may suggest it again">Forget</button>' : '');
  let h = '<div class="card" data-id="' + f.id + '">' + (f.status === 'written' ? '' : '<input type="checkbox" class="pick"' + (picked.has(f.id) ? ' checked' : '') + '>');
  if (f.kind === 'nickname') h += '<div class="cap dim">Working title?</div><input class="big" data-k="edited" value="' + esc(f.edited ?? f.text) + '">' +
    '<div class="pairs">' + (f.pairs || []).map(([found, site]) => thumb(site) + thumb(found)).join('') + '</div>' +
    '<div class="dim">On the site · found in ' + tilde(f.path) + (f.count > 4 ? ' (' + f.count + ' matches)' : '') + '</div>';
  if (f.kind === 'page') h += '<div class="cap dim">Web page' + (f.linked ? ' · linked' : '') + '</div><div>' + esc(f.title || '') + '</div><div class="src">' + esc(f.path) + '</div>' +
    (f.pairs ? '<div class="pairs">' + f.pairs.map(([found, site]) => thumb(site) + thumb(found)).join('') + '</div><div class="dim">Pictures on this page match the site' + (f.count > 4 ? ' (' + f.count + ')' : '') + '</div>' : '');
  if (f.kind === 'folder') {
    h += '<div class="cap dim">Folder' + (f.linked ? ' · linked' : '') + '</div><div>' + tilde(f.path) + '</div>';
    // An accepted folder's contents arrive as Pending cards. Said here, with a
    // way to see just those: the card used to say only "linked", and nothing
    // led from it to the hundreds of cards it had made.
    if (f.status === 'accepted') {
      const mine = findings.filter(g => g.from === f.id), wait = mine.filter(g => g.status === 'pending').length;
      h += '<div class="dim">' + (f.stopped ? 'Stopped part-way — Undo, then Accept, to finish reading it. ' : !f.expanded ? 'Reading it… its pictures and documents appear in Pending as they are found. ' : '') +
        mine.length + ' card' + (mine.length === 1 ? '' : 's') + ' from inside it, ' + wait + ' waiting in Pending</div>' +
        (wait ? '<button class="btn" data-inside="' + esc(f.path) + '">Show what is inside</button>' : '');
    }
  }
  if (f.kind === 'image') {
    h += thumb(f.path) + '<div class="src">' + label(f) + '</div><div class="dim">' + [f.w && f.w + '×' + f.h, f.camera, f.taken].filter(Boolean).map(esc).join(' · ') + '</div>';
    if (f.status === 'accepted') h += '<div class="dim">Next: Organize — copies are stacked there and one is kept</div>';
  }
  if (f.kind === 'text') {
    h += '<div class="src">' + label(f) + '</div><textarea data-k="edited">' + esc(f.edited ?? f.text) + '</textarea>';
    if (f.status === 'accepted') h += '<select data-k="target">' + [['description','Add to description'],['detail','Add as detail lines'],['share','Use as share description']].map(([v,t]) => '<option value="' + v + '"' + ((f.target || 'description') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
  }
  return h + '<div class="acts">' + acts + '</div></div>';
}
// A column draws 100 cards, then a button for the next 100. Drawing all 562 of
// one project's cards — 300 pictures, 288 text boxes — on every click was most
// of why a click took seconds to show.
const shown = { pending: 100, accepted: 100, rejected: 100 };
/* PENDING FILTER — narrow the queue by where cards came from.
   A card's SOURCE is the website it came from, or the folder its file sits
   in. The Source menu lists the sources present in this project's pending
   cards, most cards first; the search box matches path, page title and text.
   Only Pending is filtered: it is the column that runs to hundreds. Select-all
   and the bulk bar act on what the filter leaves showing. */
const sourceOf = (f) => (/^https?:/.test(f.path) ? new URL(f.path).host : (f.kind === 'folder' ? f.path : f.path.replace(/\/[^/]*$/, '')).replace(S.home, '~'));
const KIND_ORDER = { folder: 0, page: 1, nickname: 2, text: 3, image: 4 };
function pendingView(list) {
  const t0 = document.querySelector('#ptype .on').dataset.t;
  const counts = {};
  for (const f of list) if (!t0 || (t0 === 'web') === /^https?:/.test(f.path)) counts[sourceOf(f)] = (counts[sourceOf(f)] || 0) + 1;
  const keep = $('psrc').value;
  const opts = '<option value="">All ' + (t0 === 'web' ? 'websites' : t0 === 'files' ? 'folders' : 'sources') + ' (' + Object.values(counts).reduce((a, b) => a + b, 0) + ')</option>' + Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => '<option value="' + esc(k) + '"' + (k === keep ? ' selected' : '') + '>' + esc(k) + ' (' + n + ')</option>').join('');
  if ($('psrc').innerHTML !== opts) $('psrc').innerHTML = opts;   // rebuilding while open would close the menu
  const src = $('psrc').value, q = $('pq').value.trim().toLowerCase();
  const t = document.querySelector('#ptype .on').dataset.t;
  let out = list.filter(f => (!t || (t === 'web') === /^https?:/.test(f.path)) && (!src || sourceOf(f) === src) && (!q || [f.path, f.title, f.text, f.edited].some(x => x && String(x).toLowerCase().includes(q))));
  const sort = $('psort').value;
  if (sort === 'source') out = out.sort((a, b) => sourceOf(a).localeCompare(sourceOf(b)) || a.path.localeCompare(b.path));
  if (sort === 'kind') out = out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path));
  return out;
}
function drawFindings() {
  for (const col of ['pending', 'accepted', 'rejected']) {
    // folders and working titles first: accepting one is what fills the rest
    const rank = (f) => (f.kind === 'folder' || f.kind === 'nickname' || f.kind === 'page' ? 0 : 1);
    const every = findings.filter(f => f.status === col || (col === 'accepted' && f.status === 'written')).sort((a, b) => rank(a) - rank(b));
    const list = col === 'pending' ? pendingView(every) : every;
    const rest = list.length - shown[col];
    $(col).innerHTML = list.slice(0, shown[col]).map(card).join('') + (rest > 0 ? '<button class="btn more" data-more="' + col + '">Show ' + Math.min(rest, 100) + ' more of ' + rest + '</button>' : '');
    const all = document.querySelector('[data-all="' + col + '"]');
    if (all) all.checked = list.length > 0 && list.every(f => picked.has(f.id));
    $('n-' + col).textContent = list.length === every.length ? (list.length || '') : list.length + ' of ' + every.length;
  }
  $('write').disabled = !findings.some(f => f.status === 'accepted' && f.kind === 'text');
  for (const id of [...picked]) if (!findings.some(f => f.id === id)) picked.delete(id);
  bulkBar();
}
/* INSTANT: the card moves the moment it is clicked; the server is told after.
   If the server refuses, the card goes back where it was and the reason shows
   in the status line. The hairline at the top runs until the server answers. */
$('review').addEventListener('click', async (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { shown[more.dataset.more] += 100; drawFindings(); return; }
  const inside = e.target.closest('[data-inside]');
  if (inside) {   // Pending, filtered to everything under that folder: the search box matches the path
    $('pq').value = (inside.dataset.inside + '/').replace(/\/+/g, '/'); $('psrc').value = '';
    document.querySelectorAll('#ptype .btn').forEach(x => x.classList.toggle('on', !x.dataset.t));
    shown.pending = 100; drawFindings(); $('pending').closest('.col').scrollTop = 0; return;
  }
  const fg = e.target.closest('[data-forget]');
  if (fg) return forget([fg.closest('.card').dataset.id]);
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('.card').dataset.id;
  const f = findings.find(x => x.id === id);
  const was = f.status;
  f.status = b.dataset.a; picked.delete(id); drawFindings();
  busy(1);
  try { await save(); Object.assign(f, await api('/api/finding', { id, status: b.dataset.a, indesign: $('indesign').checked })); }
  catch (err) { f.status = was; oops(err); }
  finally { busy(-1); }
  drawFindings();
  if (f.kind === 'folder' || f.kind === 'nickname' || f.kind === 'page') poll();
});
$('newcards').addEventListener('click', () => loadFindings());
$('stop').addEventListener('click', async () => {
  $('stop').hidden = true; say('Stopping…'); busy(1);
  try { await api('/api/stop', {}); } catch (e) { oops(e); } finally { busy(-1); }
  poll();
});
// filtering is local and instant; paging restarts so the first matches show
const refilter = () => { shown.pending = 100; drawFindings(); };
$('pq').addEventListener('input', refilter);
$('ptype').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#ptype .btn').forEach(x => x.classList.toggle('on', x === b));
  $('psrc').value = ''; refilter();
});
$('psrc').addEventListener('change', refilter);
$('psort').addEventListener('change', refilter);
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
// errors show in the status line, not alert(): the desktop app's window has no browser to show an alert box
function say(msg) { $('status').textContent = msg; say.at = Date.now(); }
const oops = (e) => say('⚠ ' + e.message);
$('crawlsite').addEventListener('click', () => api('/api/crawlsite', { url: $('site').value || 'rmaciel.work', projects: [project] }).then(poll).catch(oops));
$('crawl').addEventListener('click', () => api('/api/crawl', { root: folder, projects: [project], indesign: $('indesign').checked }).then(poll).catch(oops));
$('link').addEventListener('click', async () => {
  const force = $('link').dataset.armed === folder;
  try {
    const d = await api('/api/link', { project, path: folder, force, indesign: $('indesign').checked });
    if (d.confirm) {
      // armed: the next click on the same folder within 8 s really links it
      $('link').dataset.armed = folder;
      $('link').textContent = 'Over 300 files — click again to file ALL under ' + S.projects.find(p => p.slug === project).title;
      say('That folder holds over 300 files. Linking files every one under this project. To sort them by project instead, use Crawl this folder.');
      clearTimeout(link.t); link.t = setTimeout(() => { delete $('link').dataset.armed; buttons(); }, 8000);
      return;
    }
    delete $('link').dataset.armed; buttons(); poll();
  } catch (e) { oops(e); }
});
const link = {};

/* ---- selection: tick cards, then act on all of them */
function bulkBar() {
  const n = picked.size;
  $('n-sel').textContent = n ? n + ' selected' : 'Tick cards to select';
  document.querySelectorAll('[data-bulk]').forEach(b => { b.disabled = !n; });
  $('bforget').disabled = !n;
  $('moveto').disabled = !n;
  const opts = '<option value="">Move to project…</option>' + (S ? S.projects : []).filter(p => p.slug !== project).map(p => '<option value="' + esc(p.slug) + '">' + esc(p.title) + '</option>').join('');
  if ($('moveto').innerHTML !== opts) $('moveto').innerHTML = opts;
}
$('review').addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList.contains('pick')) { const id = t.closest('.card').dataset.id; t.checked ? picked.add(id) : picked.delete(id); bulkBar(); }
  if (t.dataset.all) { for (const c of $(t.dataset.all).querySelectorAll('.card')) { t.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); c.querySelector('.pick') && (c.querySelector('.pick').checked = t.checked); } bulkBar(); }
});
async function bulk(body) {
  const ids = [...picked], n = ids.length;
  const to = body.project && S.projects.find(p => p.slug === body.project);
  // shown at once: moved cards leave this project, decided ones change column
  for (const f of findings) if (picked.has(f.id)) { if (to) f.status = 'moving'; else f.status = body.status; }
  if (to) findings = findings.filter(f => f.status !== 'moving');
  picked.clear(); drawFindings();
  say((to ? 'Moving ' + n + ' to ' + to.title : (body.status === 'accepted' ? 'Accepting ' : 'Rejecting ') + n) + '…');
  busy(1);
  try {
    await save(); await api('/api/bulk', { ids, ...body });
    say((to ? 'Moved ' + n + ' to ' + to.title : (body.status === 'accepted' ? 'Accepted ' : 'Rejected ') + n) + '.');
  } catch (e) { oops(e); await loadFindings(); }   // put the cards back as the server has them
  finally { busy(-1); }
  poll();
}
document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => bulk({ status: b.dataset.bulk })));
$('moveto').addEventListener('change', (e) => { const to = e.target.value; e.target.value = ''; if (to) bulk({ project: to }); });
/* FORGET (and Pending's Clear, which is forgetting what the filter shows):
   instant on screen, then told to the server; a refusal puts the cards back.
   More than one card needs a second click, with the count on the button. */
async function forget(ids, msg) {
  const gone = new Set(ids), kept = findings;
  findings = findings.filter(f => !gone.has(f.id)); ids.forEach(i => picked.delete(i)); drawFindings();
  busy(1);
  try { const d = await api('/api/forget', { ids }); say((msg || 'Forgot') + ' ' + d.forgotten + ' card' + (d.forgotten === 1 ? '' : 's') + '. A later crawl may suggest them again.'); }
  catch (e) { findings = kept; drawFindings(); oops(e); }
  finally { busy(-1); }
}
function twoClick(btn, label, n, go) {
  if (!n) return;
  if (n > 1 && btn.dataset.armed !== project) {
    btn.dataset.armed = project; btn.textContent = label + ' ' + n + '? Click again';
    clearTimeout(btn._t); btn._t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 6000);
    return;
  }
  delete btn.dataset.armed; btn.textContent = btn.dataset.label; go();
}
$('pclear').dataset.label = 'Clear'; $('rforget').dataset.label = 'Forget all'; $('bforget').dataset.label = 'Forget';
$('pclear').addEventListener('click', () => {
  // what the Pending filter is showing, not the whole column
  const showing = pendingView(findings.filter(f => f.status === 'pending')).map(f => f.id);
  twoClick($('pclear'), 'Clear', showing.length, () => forget(showing, 'Cleared'));
});
$('rforget').addEventListener('click', () => {
  // includes hidden ones: Forget is about memory, not what is on screen
  const ids = findings.filter(f => f.status === 'rejected').map(f => f.id);
  api('/api/findings?project=' + encodeURIComponent(project) + '&hidden=1').then(all => {
    const every = [...new Set([...ids, ...all.filter(f => f.status === 'rejected').map(f => f.id)])];
    twoClick($('rforget'), 'Forget', every.length, () => forget(every));
  }).catch(oops);
});
$('bforget').addEventListener('click', () => {
  const ids = [...picked].filter(id => { const f = findings.find(x => x.id === id); return f && (f.status === 'pending' || f.status === 'rejected'); });
  twoClick($('bforget'), 'Forget', ids.length, () => forget(ids));
});
$('clear').addEventListener('click', async () => {
  const kept = findings;
  findings = findings.filter(f => f.status !== 'rejected'); drawFindings();
  busy(1);
  try { await api('/api/clear', { project }); } catch (e) { findings = kept; drawFindings(); oops(e); } finally { busy(-1); }
});

/* ---- ORGANIZE: one project's works — copies stacked, one kept, in order */
let view = 'collect', org = null;
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  view = b.dataset.view;
  document.querySelectorAll('#tabs .btn').forEach(x => x.classList.toggle('on', x === b));
  document.querySelector('main').classList.toggle('organize', view === 'organize');
  if (view === 'organize') loadOrg(); else if (project) loadFindings();
});
const KIND_LABEL = { site: 'On the site', web: 'Old website', file: 'File' };
const opick = new Set();   // ticked works, kept across redraws and between List and Grid
const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
let orgView = remember('orgView') || 'list', orgCell = remember('orgCell') || '170';
function orgPicks() {
  const n = opick.size;
  $('orgmerge').disabled = n < 2;
  $('orgmove').disabled = !n;
  const opts = '<option value="">' + (n ? 'Move ' + n + ' to project…' : 'Move to project…') + '</option>' + S.projects.filter(p => p.slug !== project).map(p => '<option value="' + esc(p.slug) + '">' + esc(p.title) + '</option>').join('');
  if ($('orgmove').innerHTML !== opts) $('orgmove').innerHTML = opts;
}
function orgLook() {
  document.querySelectorAll('#orgviews [data-ov]').forEach(b => b.classList.toggle('on', b.dataset.ov === orgView));
  document.querySelectorAll('#orgsizes [data-cell]').forEach(b => b.classList.toggle('on', b.dataset.cell === orgCell));
  $('orgsizes').hidden = orgView !== 'grid';
  $('stacks').classList.toggle('grid', orgView === 'grid');
  $('stacks').style.setProperty('--cell', orgCell + 'px');
}
$('orgviews').addEventListener('click', (e) => {
  const b = e.target.closest('.btn'); if (!b) return;
  if (b.dataset.ov) remember('orgView', orgView = b.dataset.ov);
  if (b.dataset.cell) remember('orgCell', orgCell = b.dataset.cell);
  if (org) drawOrg(); else orgLook();
});
async function loadOrg() {
  if (!project) { $('orgtitle').textContent = 'Pick a project'; $('stacks').innerHTML = ''; return; }
  $('orgtitle').textContent = S.projects.find(p => p.slug === project).title;
  $('orgmsg').textContent = 'Grouping copies…'; busy(1);
  try { org = await api('/api/organize?project=' + encodeURIComponent(project)); drawOrg(); $('orgmsg').textContent = ''; }
  catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
}
function drawOrg() {
  const live = org.stacks.filter(t => !t.removed);
  const copies = org.stacks.reduce((n, t) => n + t.members.length, 0);
  $('orgcount').textContent = live.length + ' work' + (live.length === 1 ? '' : 's') + ' · ' + copies + ' picture' + (copies === 1 ? '' : 's');
  $('orgsave').disabled = !org.stacks.length;
  for (const k of [...opick]) if (!org.stacks.some(t => t.id === k)) opick.delete(k);
  orgLook(); orgPicks();
  if (orgView === 'grid' && org.stacks.length) {
    $('stacks').innerHTML = org.stacks.map(t => {
      const k = t.members.find(m => m.key === t.keeper) || t.members[0];
      return '<div class="tile' + (t.removed ? ' removed' : '') + (opick.has(t.id) ? ' on' : '') + '" data-id="' + t.id + '" title="' + esc(k.name) + ' — click to tick, double-click to open">' +
        '<div class="keep" style="--turn:' + t.rotate + 'deg">' + thumb(k.thumb) + '</div>' +
        '<input type="checkbox" class="spick"' + (opick.has(t.id) ? ' checked' : '') + '>' +
        '<small>' + t.n + (t.members.length > 1 ? ' · ' + t.members.length + ' copies' : '') + (t.removed ? ' · removed' : '') + '</small></div>';
    }).join('');
    return;
  }
  $('stacks').innerHTML = org.stacks.length ? org.stacks.map(t => {
    const k = t.members.find(m => m.key === t.keeper) || t.members[0];
    const info = (m) => [KIND_LABEL[m.kind], m.w && m.w + '×' + m.h, m.taken].filter(Boolean).join(' · ');
    return '<div class="stack' + (t.removed ? ' removed' : '') + '" data-id="' + t.id + '">' +
      '<div><div class="keep" style="--turn:' + t.rotate + 'deg">' + thumb(k.thumb) + '</div>' +
      '<div class="turns"><button class="btn" data-op="rotate" data-dir="-1" title="Turn left">↺</button><button class="btn" data-op="rotate" data-dir="1" title="Turn right">↻</button>' + (t.rotate ? '<span class="dim">turned ' + t.rotate + '° — applied on Save</span>' : '') + '</div>' +
      '<div class="meta">' + esc(info(k)) + '<br>' + esc(k.name) + (k.page ? '<br>from “' + esc(k.page.title) + '”' : '') + '</div>' +
      (t.members.length > 1 ? '<div class="copies">' + t.members.map(m => '<div class="copy' + (m.key === t.keeper ? ' on' : '') + '" data-key="' + esc(m.key) + '" title="' + esc(m.name + ' — ' + info(m) + (m.key === t.keeper ? ' (kept)' : ' — click to keep this one')) + '">' + thumb(m.thumb) + '<small>' + esc(KIND_LABEL[m.kind]) + '</small>' + '<span class="btn x" data-split="' + esc(m.key) + '" title="Not this work: give it its own place">×</span></div>').join('') + '</div><div class="dim">' + t.members.length + ' copies — the outlined one is kept</div>' : '') +
      '</div><div>' +
      '<div class="top"><input type="checkbox" class="spick"' + (opick.has(t.id) ? ' checked' : '') + '><b>' + t.n + '</b>' +
      '<button class="btn" data-op="move" data-dir="-1" title="Earlier">↑</button><button class="btn" data-op="move" data-dir="1" title="Later">↓</button>' +
      '<button class="btn" data-op="remove">' + (t.removed ? 'Restore' : 'Remove from project') + '</button></div>' +
      '<input data-f="alt" placeholder="Alt text — what is in the picture (required)" value="' + esc(t.alt) + '">' +
      '<textarea data-f="caption" placeholder="Caption — title, year, medium, size…">' + esc(t.caption) + '</textarea>' +
      (t.maybe.length ? '<div class="chips">' + t.maybe.map(x => '<span><button class="btn chip" data-merge="' + x.id + '">Same work as #' + x.n + '? Merge</button> <button class="btn chip" data-apart="' + x.id + '">Not the same</button></span>').join('') + '</div>' : '') +
      (t.suggest.length ? '<div class="chips">' + t.suggest.map(x => '<button class="btn chip" data-sug="' + esc(x.text) + '"><i>' + esc(x.from) + '</i>' + esc(x.text.length > 220 ? x.text.slice(0, 220) + '…' : x.text) + '</button>').join('') + '</div>' : '') +
      '</div></div>';
  }).join('') : '<p class="dim">No pictures yet. Accept some in Collect, or add them to the project in Keystatic.</p>';
}
async function orgOp(body, redraw = true) {
  busy(1);
  try { await api('/api/organize', { project, ...body }); if (redraw) { org = await api('/api/organize?project=' + encodeURIComponent(project)); drawOrg(); } }
  catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
}
$('stacks').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (tile && !e.target.classList.contains('spick')) {   // the whole tile is the tick box
    const id = tile.dataset.id, on = !opick.has(id);
    on ? opick.add(id) : opick.delete(id);
    tile.classList.toggle('on', on); tile.querySelector('.spick').checked = on; orgPicks();
    return;
  }
  const st = e.target.closest('.stack'); if (!st) return;
  const stack = st.dataset.id, t = e.target;
  if (t.dataset.split) return orgOp({ op: 'split', stack, key: t.dataset.split });
  if (t.closest('.copy')) return orgOp({ op: 'keeper', stack, key: t.closest('.copy').dataset.key });
  if (t.dataset.op === 'move') return orgOp({ op: 'move', stack, dir: +t.dataset.dir });
  if (t.dataset.op === 'remove') return orgOp({ op: 'remove', stack });
  if (t.dataset.op === 'rotate') return orgOp({ op: 'rotate', stack, dir: +t.dataset.dir });
  if (t.dataset.merge) return orgOp({ op: 'merge', stack, other: t.dataset.merge });
  if (t.dataset.apart) return orgOp({ op: 'apart', stack, other: t.dataset.apart });
  const chip = t.closest('[data-sug]');
  if (chip) {   // a suggestion is added to the caption, never replaces it
    const box = st.querySelector('[data-f=caption]');
    box.value = box.value.trim() ? box.value.trim() + '\n' + chip.dataset.sug : chip.dataset.sug;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
$('stacks').addEventListener('change', (e) => {
  if (!e.target.classList.contains('spick')) return;
  const el = e.target.closest('[data-id]'), id = el.dataset.id;
  e.target.checked ? opick.add(id) : opick.delete(id);
  el.classList.toggle('on', e.target.checked && el.classList.contains('tile')); orgPicks();
});
// double-click a tile: the same work in List, where its copies, alt and caption are
$('stacks').addEventListener('dblclick', (e) => {
  const tile = e.target.closest('.tile'); if (!tile) return;
  remember('orgView', orgView = 'list'); drawOrg();
  document.querySelector('.stack[data-id="' + tile.dataset.id + '"]')?.scrollIntoView({ block: 'start' });
});
// typing saves after a pause, without redrawing under the cursor
$('stacks').addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const stack = e.target.closest('.stack').dataset.id, value = e.target.value;
  const t = org.stacks.find(x => x.id === stack); t[f] = value;
  clearTimeout(e.target._t); e.target._t = setTimeout(() => orgOp({ op: 'field', stack, field: f, value }, false), 400);
});
$('orgmerge').addEventListener('click', async () => {
  const ids = org.stacks.filter(t => opick.has(t.id)).map(t => t.id);   // in order: the first one ticked by position takes the others in
  opick.clear();
  for (const other of ids.slice(1)) await orgOp({ op: 'merge', stack: ids[0], other }, false);
  loadOrg();
});
$('orgmove').addEventListener('change', async (e) => {
  const to = e.target.value; e.target.value = ''; if (!to) return;
  const ids = org.stacks.filter(t => opick.has(t.id)).map(t => t.id), title = S.projects.find(p => p.slug === to).title;
  opick.clear();
  for (const stack of ids) await orgOp({ op: 'moveto', stack, to }, false);
  await loadOrg();
  $('orgmsg').textContent = 'Moved ' + ids.length + ' work' + (ids.length === 1 ? '' : 's') + ' to ' + title + '. Any already on this site are marked removed — Save takes them off.';
});
$('orgsave').addEventListener('click', async () => {
  // fields still waiting on their pause are sent first
  for (const el of document.querySelectorAll('#stacks [data-f]')) if (el._t) { clearTimeout(el._t); el._t = null; await orgOp({ op: 'field', stack: el.closest('.stack').dataset.id, field: el.dataset.f, value: el.value }, false); }
  const confirm = $('orgsave').dataset.armed === project;
  busy(1);
  try {
    const d = await api('/api/organize/save', { project, confirm });
    if (d.confirm) {
      $('orgsave').dataset.armed = project;
      $('orgsave').textContent = 'Takes ' + d.confirm + ' picture' + (d.confirm === 1 ? '' : 's') + ' off the site — click again';
      clearTimeout(orgsave.t); orgsave.t = setTimeout(() => { delete $('orgsave').dataset.armed; $('orgsave').textContent = 'Save to project'; }, 8000);
      return;
    }
    delete $('orgsave').dataset.armed; $('orgsave').textContent = 'Save to project';
    await loadOrg(); poll();   // first: reloading clears the message line
    $('orgmsg').textContent = 'Saved ' + d.saved + ' work' + (d.saved === 1 ? '' : 's') + (d.dropped ? ', took ' + d.dropped + ' off' : '') + '. Not live yet — Publish (top right) when ready.';
  } catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
});
const orgsave = {};

/* ---- publish, new project */
$('publish').addEventListener('click', async () => {
  $('publish').disabled = true; say('Publishing…'); busy(1);
  try { await save(); say((await api('/api/publish', {})).message); } catch (e) { oops(e); } finally { busy(-1); }
  poll();
});
// A button, not only Return: with nothing to press, the form looked inert.
// Return still works. The button names the title, and lights once there is one.
async function createProject() {
  const title = $('newtitle').value.trim();
  if (!title) return;
  $('newgo').disabled = true; say('Creating ' + title + '…'); busy(1);
  try {
    const d = await api('/api/newproject', { title, section: $('newsection').value });
    $('newtitle').value = ''; newLabel();
    await poll();
    document.querySelector('[data-s="' + d.slug + '"]')?.click();
    // scroll the Projects column only: scrollIntoView also moved the whole window
    const el = document.querySelector('[data-s="' + d.slug + '"]'), col = el && el.closest('section');
    if (col) col.scrollTop = el.offsetTop - col.offsetTop - col.clientHeight / 2;
    say('Created ' + title + ' as a draft — it is selected below. Add a grid icon in /keystatic before it can go live.');
  } catch (err) { oops(err); newLabel(); }
  finally { busy(-1); }
}
function newLabel() {
  const t = $('newtitle').value.trim();
  $('newgo').disabled = !t;
  $('newgo').textContent = t ? 'Create “' + t + '” in ' + $('newsection').selectedOptions[0].text : 'Create project';
}
$('newtitle').addEventListener('input', newLabel);
$('newsection').addEventListener('change', newLabel);
$('newtitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(); });
$('newgo').addEventListener('click', createProject);
$('write').addEventListener('click', async () => {
  try {
    await save();
    const d = await api('/api/write', { project });
    $('msg').textContent = d.written + ' written into the project. Not live yet — Publish (top right) when ready.';
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
