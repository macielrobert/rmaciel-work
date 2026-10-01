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
const CACHE_FILE = path.join(STORE, 'text-cache.json');
const THUMBS = path.join(STORE, 'thumbs');
fs.mkdirSync(THUMBS, { recursive: true });

const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = load(STATE_FILE, { root: null, findings: {} });
const cache = load(CACHE_FILE, {});
const persist = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));
const persistCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

// Formats build.js can measure go in as-is; HEIC/TIFF become JPEG on the way
// in. GIF is left out: build.js cannot read its size and every strip image
// needs one.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const KEEP_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PDF_EXT = new Set(['.pdf', '.ai']);
const TEXTUTIL_EXT = new Set(['.docx', '.doc', '.rtf', '.odt']);
const PLAIN_EXT = new Set(['.txt', '.md']);
const isDoc = (e, indesign) => PDF_EXT.has(e) || TEXTUTIL_EXT.has(e) || PLAIN_EXT.has(e) || (indesign && e === '.indd');
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
const sh = (cmd, args, opts = {}) => new Promise((ok, no) =>
  execFile(cmd, args, { maxBuffer: 256 << 20, timeout: 600000, ...opts }, (e, out) => e ? no(e) : ok(out)));

function readMdoc(file) {
  const s = fs.readFileSync(file, 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${path.basename(file)} has no frontmatter`);
  return { data: JSON.parse(m[1]), body: m[2] };
}

function projects() {
  return fs.readdirSync(PROJECTS).filter(f => f.endsWith('.mdoc')).map(f => {
    const { data, body } = readMdoc(path.join(PROJECTS, f));
    return {
      slug: f.slice(0, -5), title: data.title || f, section: data.section, order: data.order ?? 10,
      draft: !!data.draft, images: (data.images || []).length, details: (data.details || []).length,
      words: body.trim() ? body.trim().split(/\s+/).length : 0,
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
function matcher(title) {
  const whole = compact(title);
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
  return {
    name: (n) => { const c = compact(n); return (whole.length >= 3 && c.includes(whole)) || (words.length > 1 && words.every(w => c.includes(w))); },
    text: new RegExp(title.trim().split(/\s+/).map(escRe).join('[\\s\\-_]+'), 'i'),
  };
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
    set t to contents of every story of d
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

// Returns an array of text units: pages, stories or chunks. Cached by path,
// size and date, so an unchanged file is read once, ever.
async function extract(file) {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (cache[key]) return cache[key];
  const e = ext(file);
  let units = [];
  try {
    if (PDF_EXT.has(e)) units = JSON.parse(await sh('osascript', ['-l', 'JavaScript', PDF_JS, file]));
    else if (TEXTUTIL_EXT.has(e)) units = chunk(await sh('textutil', ['-convert', 'txt', '-stdout', file]));
    else if (PLAIN_EXT.has(e)) units = chunk(fs.readFileSync(file, 'utf8'));
    else if (e === '.indd') units = (await sh('osascript', [INDD_AS, file])).split('\x1e');
  } catch (err) {
    // A locked, damaged or password-protected file must not stop the crawl —
    // but it must say so, or a missing result looks like a missing match.
    console.warn(`could not read ${file}: ${err.message.split('\n')[0]}`);
  }
  units = units.map(u => String(u).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000));
  cache[key] = units;
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
  f.id = id(f.project, f.kind, f.path, f.unit ?? '');
  if (state.findings[f.id]) return false;
  state.findings[f.id] = { status: 'pending', ...f };
  return true;
}

let job = { running: false, phase: 'idle', done: 0, total: 0, added: 0, error: null };

function walk(root, visit, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.test(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) { if (visit(p, true) !== false && depth < MAX_DEPTH) walk(p, visit, depth + 1); }
    else if (e.isFile()) visit(p, false);
  }
}

async function crawl(root, indesign) {
  job = { running: true, phase: 'Listing files', done: 0, total: 0, added: 0, error: null };
  const projs = projects().map(p => ({ ...p, m: matcher(p.title) }));
  const docs = [];
  walk(root, (p, dir) => {
    job.done++;
    const name = path.basename(p);
    for (const pr of projs) {
      if (!pr.m.name(dir ? name : path.parse(name).name)) continue;
      if (dir) job.added += add({ project: pr.slug, kind: 'folder', path: p });
      else if (IMAGE_EXT.has(ext(p))) job.added += add({ project: pr.slug, kind: 'image', path: p });
    }
    if (!dir && isDoc(ext(p), indesign)) docs.push(p);
  });
  persist();
  job.phase = 'Reading documents'; job.done = 0; job.total = docs.length;
  for (const d of docs) {
    const units = await extract(d);
    units.forEach((text, i) => {
      for (const pr of projs) if (pr.m.text.test(text)) job.added += add({ project: pr.slug, kind: 'text', path: d, unit: i, text });
    });
    job.done++;
    if (job.done % 10 === 0) { persist(); persistCache(); }
    await tick();
  }
  await sizeImages();
  persist(); persistCache();
  job.running = false; job.phase = 'Done';
}

// An accepted folder is about the project whether or not the title is written
// anywhere inside it, so everything in it becomes a finding.
async function expandFolder(f, indesign) {
  job = { running: true, phase: `Reading ${path.basename(f.path)}`, done: 0, total: 0, added: 0, error: null };
  const imgs = [], docs = [];
  walk(f.path, (p, dir) => {
    if (dir) return;
    if (IMAGE_EXT.has(ext(p)) && imgs.length < MAX_FOLDER_IMAGES) imgs.push(p);
    else if (isDoc(ext(p), indesign)) docs.push(p);
  });
  for (const p of imgs) job.added += add({ project: f.project, kind: 'image', path: p, from: f.id });
  job.total = docs.length;
  for (const d of docs) {
    (await extract(d)).forEach((text, i) => {
      if (text.length >= 40) job.added += add({ project: f.project, kind: 'text', path: d, unit: i, text, from: f.id });
    });
    job.done++;
    await tick();
  }
  await sizeImages();
  persist(); persistCache();
  job.running = false; job.phase = 'Done';
}

async function sizeImages() {
  const todo = Object.values(state.findings).filter(f => f.kind === 'image' && f.w === undefined);
  const info = await sipsInfo(todo.map(f => fs.realpathSync(f.path)));
  for (const f of todo) {
    const i = info[fs.realpathSync(f.path)] || {};
    f.w = +i.pixelWidth || null; f.h = +i.pixelHeight || null;
    f.camera = [i.make, i.model].filter(Boolean).join(' ') || null;
    f.taken = i.creation ? i.creation.replace(/^(\d+):(\d+):(\d+)/, '$1-$2-$3').slice(0, 10) : null;
  }
}

function run(fn) {
  if (job.running) throw new Error('Already working — wait for the current crawl to finish.');
  fn().catch(e => { job.running = false; job.error = e.message; console.warn(e); });
}

/* ------------------------------------------------------------- writing */

const runSips = (args) => sh('sips', args);

async function importImage(src, slug, n, w, h) {
  const e = ext(src);
  const outExt = KEEP_EXT.has(e) ? (e === '.jpeg' ? '.jpg' : e) : '.jpg';
  const dir = path.join(REPO, 'images', slug, 'images', String(n));
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'src' + outExt);
  const big = Math.max(w || 0, h || 0) > MAX_SIDE;
  // -Z only when the file is larger: sips would otherwise enlarge a small one
  const args = [];
  if (big) args.push('-Z', String(MAX_SIDE));
  if (outExt === '.jpg' && (big || !KEEP_EXT.has(e))) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '85');
  if (!args.length || e === '.webp') fs.copyFileSync(src, out);   // sips cannot write WebP
  else await runSips([...args, src, '--out', out]);
  return `/images/${slug}/images/${n}/src${outExt}`;
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
  const paras = [];
  for (const f of acc) {
    if (f.kind === 'image') {
      let n = data.images.length;
      while (fs.existsSync(path.join(REPO, 'images', slug, 'images', String(n)))) n++;
      const rec = { src: await importImage(f.path, slug, n, f.w, f.h), alt: f.alt.trim() };
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
  const newBody = [body.trim(), ...paras].filter(Boolean).join('\n\n');
  fs.writeFileSync(file, `---\n${JSON.stringify(data, null, 2)}\n---\n${newBody ? newBody + '\n' : ''}`);
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
      const counts = {};
      for (const f of Object.values(state.findings)) {
        const c = counts[f.project] ||= { pending: 0, accepted: 0 };
        if (f.status === 'pending') c.pending++; else if (f.status === 'accepted') c.accepted++;
      }
      return json({ root: state.root, home: HOME, job, projects: projects().map(pr => ({ ...pr, ...(counts[pr.slug] || { pending: 0, accepted: 0 }) })) });
    }
    if (p === '/api/ls') {
      const dir = path.resolve(url.searchParams.get('p') || HOME);
      const dirs = [];
      let files = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.test(e.name)) continue;
        if (e.isDirectory()) dirs.push(e.name); else files++;
      }
      return json({ path: dir, dirs: dirs.sort((a, b) => a.localeCompare(b)), files });
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
      if (!fs.existsSync(t)) await runSips(['-Z', '480', '-s', 'format', 'jpeg', abs, '--out', t]);
      return send(200, 'image/jpeg', fs.readFileSync(t));
    }

    if (req.method !== 'POST') return send(404, 'text/plain', 'not found');
    const b = await body(req);
    if (p === '/api/crawl') {
      if (!fs.statSync(b.root, { throwIfNoEntry: false })?.isDirectory()) throw new Error('That folder no longer exists.');
      state.root = b.root; persist();
      run(() => crawl(b.root, !!b.indesign));
      return json({ ok: true });
    }
    if (p === '/api/finding') {
      const f = state.findings[b.id];
      if (!f) throw new Error('Unknown finding.');
      for (const k of ['status', 'edited', 'target', 'alt', 'caption']) if (k in b) f[k] = b[k];
      persist();
      if (f.kind === 'folder' && b.status === 'accepted') run(() => expandFolder(f, !!b.indesign));
      return json(f);
    }
    if (p === '/api/link') {
      // Pointing at a folder by hand is the same as accepting a match for it.
      add({ project: b.project, kind: 'folder', path: b.path, linked: true });
      const f = state.findings[id(b.project, 'folder', b.path, '')];
      f.status = 'accepted'; persist();
      run(() => expandFolder(f, !!b.indesign));
      return json(f);
    }
    if (p === '/api/write') return json(await write(b.project));
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
const base = (p) => p.split('/').pop();
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
    h += '<div data-s="' + esc(p.slug) + '" class="' + (p.slug === project ? 'sel' : '') + '"><span>' + esc(p.title) + (p.draft ? ' · draft' : '') + '</span><b>' + (p.pending || '') + '</b></div>';
  }
  $('projects').innerHTML = h;
}
$('projects').addEventListener('click', (e) => {
  const d = e.target.closest('[data-s]'); if (!d) return;
  project = d.dataset.s; $('msg').textContent = ''; drawProjects(); buttons(); loadFindings();
});

/* ---- status */
function buttons() {
  $('crawl').disabled = !folder || (S && S.job.running);
  const pr = S && S.projects.find(p => p.slug === project);
  $('link').disabled = !folder || !project || S.job.running;
  $('link').textContent = pr ? 'Link to ' + pr.title : 'Link to project';
}
async function poll() {
  S = await api('/api/state');
  const j = S.job;
  $('rootline').textContent = S.root ? 'Last crawl: ' + S.root : 'Pick a folder, then crawl it';
  $('status').textContent = j.error ? '⚠ ' + j.error
    : j.running ? j.phase + (j.total ? ' ' + j.done + ' / ' + j.total : ' · ' + j.done) + ' · ' + j.added + ' found'
    : j.phase === 'Done' ? 'Done · ' + j.added + ' new' : '';
  drawProjects(); buttons();
  // any movement in the job means findings may have changed; a short job can
  // start and finish between two polls, so compare, do not watch for "running"
  const key = [j.phase, j.done, j.added, j.running].join('|');
  if (key !== lastJob && project) loadFindings();
  lastJob = key;
  clearTimeout(poll.t); poll.t = setTimeout(poll, j.running ? 1200 : 4000);
}

/* ---- findings */
async function loadFindings() {
  findings = await api('/api/findings?project=' + encodeURIComponent(project));
  drawFindings();
}
const label = (f) => esc(f.path.replace(S.home, '~')) + (f.kind === 'text' && f.unit !== undefined ? ' · ' + (/\.(pdf|ai)$/i.test(f.path) ? 'page ' : 'part ') + (f.unit + 1) : '');
function card(f) {
  const acts = f.status === 'pending'
    ? '<button class="btn" data-a="accepted">Accept</button><button class="btn" data-a="rejected">Reject</button>'
    : f.status === 'written' ? '<span class="dim cap">Written</span>' : '<button class="btn" data-a="pending">Undo</button>';
  let h = '<div class="card" data-id="' + f.id + '">';
  if (f.kind === 'folder') h += '<div class="cap dim">Folder' + (f.linked ? ' · linked' : '') + '</div><div>' + esc(f.path.replace(S.home, '~')) + '</div>';
  if (f.kind === 'image') {
    h += '<img loading="lazy" src="/thumb?p=' + encodeURIComponent(f.path) + '"><div class="src">' + label(f) + '</div><div class="dim">' + [f.w && f.w + '×' + f.h, f.camera, f.taken].filter(Boolean).map(esc).join(' · ') + '</div>';
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
    // folders first in PENDING: accepting one is what fills the rest
    const list = findings.filter(f => f.status === col || (col === 'accepted' && f.status === 'written'))
      .sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1));
    $(col).innerHTML = list.map(card).join('');
    $('n-' + col).textContent = list.length || '';
  }
  $('write').disabled = !findings.some(f => f.status === 'accepted' && f.kind !== 'folder');
}
$('review').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('.card').dataset.id;
  const f = findings.find(x => x.id === id);
  Object.assign(f, await api('/api/finding', { id, status: b.dataset.a, indesign: $('indesign').checked }));
  drawFindings();
  if (f.kind === 'folder') poll();
});
// inline edits save on every change, so nothing typed is lost to a reload
$('review').addEventListener('change', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const id = e.target.closest('.card').dataset.id;
  findings.find(x => x.id === id)[k] = e.target.value;
  api('/api/finding', { id, [k]: e.target.value });
});

$('crawl').addEventListener('click', () => api('/api/crawl', { root: folder, indesign: $('indesign').checked }).then(poll).catch(e => alert(e.message)));
$('link').addEventListener('click', () => api('/api/link', { project, path: folder, indesign: $('indesign').checked }).then(poll).catch(e => alert(e.message)));
$('write').addEventListener('click', async () => {
  // a field still being typed in has not fired "change" yet
  document.activeElement && document.activeElement.blur();
  await new Promise(r => setTimeout(r, 150));
  try {
    const d = await api('/api/write', { project });
    $('msg').textContent = d.written + ' written into the project. Not live yet — tell Claude "publish".';
    loadFindings();
  } catch (e) { $('msg').textContent = '⚠ ' + e.message; }
});

(async () => {
  await poll();
  const li = document.createElement('li');
  li.innerHTML = '<span data-p="' + esc(S.home) + '" class="sel"><i>⌄</i>~ ' + esc(base(S.home)) + '</span>';
  const ul = document.createElement('ul'); ul.appendChild(li); $('tree').appendChild(ul);
  folder = S.home; buttons();
  await branch(li, S.home);
})();
</script>
</html>`;
