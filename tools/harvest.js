#!/usr/bin/env node
/* HARVEST — point it at a project folder, pick images, type the info, and it
   writes a draft project straight into this repo in the shape Keystatic and
   build.js expect.

     node tools/harvest.js /path/to/project-folder
     (or double-click tools/Harvest.command, which asks for the folder)

   WHY THIS SHAPE
     Node built-ins plus macOS's own `sips` — no npm package, nothing to
     install. `sips` reads size and camera data out of the file header and makes
     thumbnails, including from HEIC and TIFF, which a browser cannot show. It
     is the same tool Preview uses, so if Preview opens it, this can.

   WHAT IT WRITES — and why it is always a DRAFT
     content/projects/<slug>.mdoc  and  images/<slug>/images/<n>/src.<ext>,
     exactly the paths Keystatic itself uses. The entry is saved with
     draft: true, so it builds green even with no grid icon yet (build.js skips
     drafts before validating them) and nothing goes live until it is opened in
     /keystatic, finished, and "Hold back" unticked. It never overwrites an
     existing project.

   WHAT IT DOES NOT DO
     No git. Publishing stays one step, done the usual way. */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const ARG = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.statSync(ARG, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('Usage: node tools/harvest.js /path/to/project-folder');
  process.exit(1);
}
// The REAL path, symlinks resolved: sips reports files that way (/var is
// /private/var on a Mac), and its answers are looked up by path.
const FOLDER = fs.realpathSync(ARG);

// Formats build.js can measure go in as-is; HEIC/TIFF are converted to JPEG on
// the way in. GIF is left out: build.js cannot read its size and the site
// requires one for every strip image.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff']);
const KEEP_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Longest side written into the repo. Netlify's image CDN resizes for each
// screen, so this only keeps 40 MB camera files out of git; 2400 covers a
// retina window with room to spare.
const MAX_SIDE = 2400;
const THUMBS = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-'));

/* ---------------------------------------------------------------- scanning */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function sipsInfo(files) {
  // One sips call per 200 files: per-file calls take minutes on a big shoot,
  // and one call for everything can overrun the argument limit.
  const info = {};
  for (let i = 0; i < files.length; i += 200) {
    let out = '';
    try {
      out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'make', '-g', 'model', '-g', 'creation', ...files.slice(i, i + 200)],
        { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { out = e.stdout || ''; }   // one unreadable file must not hide the rest
    let cur = null;
    for (const line of out.split('\n')) {
      const m = line.match(/^\s+(\w+): (.*)$/);
      if (!m) { if (line) info[cur = line] = {}; continue; }
      if (cur && m[2] !== '<nil>') info[cur][m[1]] = m[2];
    }
  }
  return info;
}

function scan() {
  const files = walk(FOLDER);
  const types = {};
  let bytes = 0, oldest = Infinity, newest = 0;
  for (const f of files) {
    const st = fs.statSync(f);
    const ext = path.extname(f).toLowerCase() || '(none)';
    types[ext] = (types[ext] || 0) + 1;
    bytes += st.size;
    oldest = Math.min(oldest, st.mtimeMs);
    newest = Math.max(newest, st.mtimeMs);
  }
  const imgs = files.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  const info = sipsInfo(imgs);
  return {
    folder: FOLDER,
    name: path.basename(FOLDER),
    fileCount: files.length,
    bytes,
    oldest: files.length ? new Date(oldest).toISOString().slice(0, 10) : null,
    newest: files.length ? new Date(newest).toISOString().slice(0, 10) : null,
    types: Object.entries(types).sort((a, b) => b[1] - a[1]),
    images: imgs.map(f => {
      const i = info[f] || {};
      return {
        rel: path.relative(FOLDER, f),
        size: fs.statSync(f).size,
        w: +i.pixelWidth || null, h: +i.pixelHeight || null,
        camera: [i.make, i.model].filter(Boolean).join(' ') || null,
        taken: i.creation ? i.creation.replace(/^(\d+):(\d+):(\d+)/, '$1-$2-$3') : null,
      };
    }),
  };
}

/* ---------------------------------------------------------------- helpers */

// A request names a file by its path inside the folder; anything that climbs
// out of it is refused, because this server can read the whole disk.
function inside(rel) {
  const abs = path.resolve(FOLDER, rel || '');
  if (!abs.startsWith(FOLDER + path.sep) || !fs.existsSync(abs)) return null;
  return abs;
}

const run = (args) => new Promise((ok, no) => execFile('sips', args, (e) => e ? no(e) : ok()));

// Matches Keystatic's slug field closely enough for a new entry: lowercase,
// letters and digits, runs of anything else become one hyphen.
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function body(req) {
  return new Promise((ok, no) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } });
  });
}

/* ---------------------------------------------------------------- saving */

async function save(p) {
  const title = String(p.title || '').trim();
  if (!title) throw new Error('A title is required.');
  const slug = slugify(p.slug || title);
  if (!slug) throw new Error('The title needs at least one letter or number for its URL.');
  const mdoc = path.join(REPO, 'content/projects', slug + '.mdoc');
  if (fs.existsSync(mdoc)) throw new Error(`A project called "${slug}" already exists. Pick another title or slug.`);
  if (!['build', 'design', 'art'].includes(p.section)) throw new Error('Pick a section.');
  if (!Array.isArray(p.images) || !p.images.length) throw new Error('Pick at least one image.');
  for (const [i, im] of p.images.entries()) {
    if (!String(im.alt || '').trim()) throw new Error(`Image ${i + 1} needs alt text — the build refuses an image without it.`);
    if (!inside(im.rel)) throw new Error(`Image ${i + 1} is no longer in the folder.`);
  }

  const images = [];
  for (const [i, im] of p.images.entries()) {
    const src = inside(im.rel);
    const ext = path.extname(src).toLowerCase();
    const outExt = KEEP_EXT.has(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : '.jpg';
    const dir = path.join(REPO, 'images', slug, 'images', String(i));
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'src' + outExt);
    const big = Math.max(im.w || 0, im.h || 0) > MAX_SIDE;
    if (ext === '.webp' && !big) fs.copyFileSync(src, out);
    else {
      // -Z only when the file is larger: sips would otherwise enlarge a small one
      const args = [];
      if (big) args.push('-Z', String(MAX_SIDE));
      if (outExt === '.jpg') args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '85');
      if (outExt === '.png') args.push('-s', 'format', 'png');
      if (!args.length) fs.copyFileSync(src, out);
      else await run([...args, src, '--out', out]);
    }
    const rec = { src: `/images/${slug}/images/${i}/src${outExt}`, alt: im.alt.trim() };
    if (String(im.caption || '').trim()) rec.caption = im.caption.trim();
    images.push(rec);
  }

  // Key order follows the existing entries, so a later Keystatic save makes
  // no noise in the diff.
  const data = {
    title,
    section: p.section,
    order: Number.isInteger(+p.order) ? +p.order : 10,
    draft: true,
    details: (p.details || '').split('\n').map(s => s.trim()).filter(Boolean),
    layout: ['standard', 'grid', 'text'].includes(p.layout) ? p.layout : 'standard',
    expand: true,
    icon_type: 'glyph',
    images,
  };
  if (String(p.share || '').trim()) data.share_description = p.share.trim();
  const text = String(p.summary || '').trim();
  fs.writeFileSync(mdoc, `---\n${JSON.stringify(data, null, 2)}\n---\n${text ? text + '\n' : ''}`);
  return { slug, file: path.relative(REPO, mdoc), images: images.length };
}

/* ---------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, data) => { res.writeHead(code, { 'content-type': type }); res.end(data); };
  try {
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    // the site's typeface, read from the repo so the two can never drift
    const font = url.pathname.match(/^\/fonts\/([\w-]+\.woff2)$/);
    if (font) return send(200, 'font/woff2', fs.readFileSync(path.join(REPO, 'fonts', font[1])));
    if (url.pathname === '/api/scan') return send(200, 'application/json', JSON.stringify(scan()));
    if (url.pathname === '/thumb') {
      const abs = inside(url.searchParams.get('p'));
      if (!abs) return send(404, 'text/plain', 'not found');
      // Every thumbnail goes through sips, not just HEIC: a page of forty
      // full-size camera files is a gigabyte of decoding for the browser.
      const t = path.join(THUMBS, Buffer.from(abs).toString('base64url') + '.jpg');
      if (!fs.existsSync(t)) await run(['-Z', '480', '-s', 'format', 'jpeg', abs, '--out', t]);
      return send(200, 'image/jpeg', fs.readFileSync(t));
    }
    if (url.pathname === '/api/save' && req.method === 'POST') {
      return send(200, 'application/json', JSON.stringify(await save(await body(req))));
    }
    send(404, 'text/plain', 'not found');
  } catch (e) {
    send(400, 'application/json', JSON.stringify({ error: e.message }));
  }
});

// 127.0.0.1 only: this serves files off the disk and must not be reachable
// from anything else on the network.
server.listen(0, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Harvest is open at ${u}\nFolder: ${FOLDER}\nClose this window (or press Ctrl-C) when you are done.`);
  execFile('open', [u]);
});

/* ---------------------------------------------------------------- page */

const PAGE = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Harvest</title>
<style>
  /* The site's own face, colours and type scale, so this reads as a room of
     the same house. Tokens copied from index.html: --bg / --ink invert with
     the device theme, --accent-rgb does not. */
  @font-face { font-family:'PP Neue Montreal'; src:url('/fonts/PPNeueMontreal-Light.woff2') format('woff2'); font-weight:300; }
  @font-face { font-family:'PP Neue Montreal'; src:url('/fonts/PPNeueMontreal-Book.woff2') format('woff2'); font-weight:400; }
  @font-face { font-family:'PP Neue Montreal'; src:url('/fonts/PPNeueMontreal-Bold.woff2') format('woff2'); font-weight:700; }
  :root { --bg:#000; --ink:#fff; --accent-rgb:143,143,153;
          --accent:rgba(var(--accent-rgb),.9); --accent-dim:rgba(var(--accent-rgb),.5); --m:24px; }
  @media (prefers-color-scheme: light) { :root { --bg:#fff; --ink:#000; } }
  * { box-sizing:border-box }
  html, body { margin:0; background:var(--bg); color:var(--ink); }
  body { font:300 11px/1.8 'PP Neue Montreal', -apple-system, system-ui, sans-serif; letter-spacing:.05em; }
  main { display:grid; grid-template-columns:1fr minmax(320px, 33em); height:100vh; }
  #left { overflow:auto; padding:var(--m); }
  #right { overflow:auto; padding:var(--m); border-left:1px solid var(--accent-dim); }
  h1 { font-size:13px; font-weight:400; line-height:1; margin:0 0 10px; letter-spacing:.05em; }
  .dim, label { color:var(--accent); }
  .cap { text-transform:uppercase; letter-spacing:.15em; }
  #types span { display:inline-block; margin:0 14px 0 0; }
  #grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px,1fr)); gap:var(--m); margin-top:var(--m); }
  figure { margin:0; cursor:pointer; position:relative; }
  figure img { width:100%; aspect-ratio:1; object-fit:contain; display:block; opacity:.45; transition:opacity .2s; }
  figure:hover img, figure.on img { opacity:1; }
  figure b { position:absolute; top:0; left:0; background:var(--ink); color:var(--bg); font-weight:400; min-width:20px; padding:0 6px; text-align:center; display:none; }
  figure.on b { display:block; }
  figcaption { color:var(--accent); margin-top:6px; overflow-wrap:anywhere; line-height:1.5; }
  figure.on figcaption { color:var(--ink); }
  label { display:block; margin:16px 0 0; }
  input, textarea, select { display:block; width:100%; background:transparent; color:var(--ink);
    border:0; border-bottom:1px solid var(--accent-dim); border-radius:0; outline:none;
    font:inherit; letter-spacing:inherit; padding:4px 0 5px; margin-top:1px; }
  input:focus, textarea:focus, select:focus { border-bottom-color:var(--ink); }
  textarea { min-height:60px; resize:vertical; }
  select { appearance:none; cursor:pointer; }
  option { background:var(--bg); }
  ::placeholder { color:var(--accent-dim); }
  .pick { display:grid; grid-template-columns:56px 1fr; gap:12px; margin-top:16px; }
  .pick img { width:56px; height:56px; object-fit:cover; }
  .pick input { margin-top:0; }
  #save { display:inline-block; margin-top:24px; color:var(--accent); cursor:pointer; background:none; border:0; padding:0; font:inherit; }
  #save:hover, #save:focus-visible { color:var(--ink); outline:none; }
  #msg { margin-top:12px; white-space:pre-wrap; }
</style>
<main>
  <section id="left">
    <h1 id="name">Reading folder…</h1>
    <div class="dim" id="stats"></div>
    <div class="dim" id="types"></div>
    <div class="dim" style="margin-top:10px">Click images in the order they should appear. Click again to drop one.</div>
    <div id="grid"></div>
  </section>
  <section id="right">
    <h1 class="cap">Project</h1>
    <label class="cap">Title</label><input id="title">
    <label class="cap">Section</label>
    <select id="section"><option value="build">BUILD</option><option value="design">DESIGN</option><option value="art">ART</option></select>
    <label class="cap">Details</label><textarea id="details" placeholder="One per line — Client: …  Venue: …  Materials: …  Year: …"></textarea>
    <label class="cap">Description</label><textarea id="summary" style="min-height:120px"></textarea>
    <label class="cap">Layout</label>
    <select id="layout"><option value="standard">Standard</option><option value="grid">Grid — only for many similar objects</option><option value="text">Text</option></select>
    <label class="cap">Share description</label><input id="share" placeholder="One plain line for link previews">
    <label class="cap">Position in grid</label><input id="order" value="10" inputmode="numeric">
    <div id="picks"></div>
    <button id="save" class="cap">Save as draft</button>
    <div id="msg" class="dim"></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const mb = (n) => (n / 1048576).toFixed(n > 1e7 ? 0 : 1) + ' MB';
let all = [], picked = [];   // picked holds { img, alt, caption } in display order

fetch('/api/scan').then(r => r.json()).then(d => {
  all = d.images;
  $('name').textContent = d.name;
  $('title').value = d.name;
  $('stats').textContent = d.fileCount + ' files · ' + mb(d.bytes) + (d.oldest ? ' · modified ' + d.oldest + ' to ' + d.newest : '') + ' · ' + all.length + ' usable images';
  $('types').innerHTML = d.types.map(([e, n]) => '<span>' + esc(e) + ' ' + n + '</span>').join('');
  $('grid').innerHTML = all.map((im, i) =>
    '<figure data-i="' + i + '"><b></b><img loading="lazy" src="/thumb?p=' + encodeURIComponent(im.rel) + '">' +
    '<figcaption>' + esc(im.rel) + '<br>' + [im.w && im.w + '×' + im.h, mb(im.size), im.camera, im.taken].filter(Boolean).map(esc).join(' · ') + '</figcaption></figure>'
  ).join('');
});

$('grid').addEventListener('click', (e) => {
  const f = e.target.closest('figure'); if (!f) return;
  const im = all[f.dataset.i];
  const at = picked.findIndex(p => p.img === im);
  if (at >= 0) picked.splice(at, 1); else picked.push({ img: im, alt: '', caption: '' });
  draw();
});

function draw() {
  document.querySelectorAll('figure').forEach(f => {
    const n = picked.findIndex(p => p.img === all[f.dataset.i]);
    f.classList.toggle('on', n >= 0);
    f.querySelector('b').textContent = n + 1;
  });
  $('picks').innerHTML = picked.length ? '<label class="cap">Images — alt text required</label>' + picked.map((p, i) =>
    '<div class="pick"><img src="/thumb?p=' + encodeURIComponent(p.img.rel) + '"><div>' +
    '<input data-i="' + i + '" data-k="alt" placeholder="' + (i + 1) + '. Alt text — what is in the picture" value="' + esc(p.alt) + '">' +
    '<input data-i="' + i + '" data-k="caption" placeholder="Caption (optional)" value="' + esc(p.caption) + '"></div></div>'
  ).join('') : '';
}
$('picks').addEventListener('input', (e) => { const t = e.target; if (t.dataset.k) picked[t.dataset.i][t.dataset.k] = t.value; });

$('save').addEventListener('click', async () => {
  $('msg').textContent = 'Saving…';
  const payload = {
    title: $('title').value, section: $('section').value, details: $('details').value,
    summary: $('summary').value, layout: $('layout').value, share: $('share').value, order: $('order').value,
    images: picked.map(p => ({ rel: p.img.rel, w: p.img.w, h: p.img.h, alt: p.alt, caption: p.caption })),
  };
  const r = await fetch('/api/save', { method: 'POST', body: JSON.stringify(payload) });
  const d = await r.json();
  $('msg').textContent = d.error ? '⚠ ' + d.error
    : 'Saved as a draft: ' + d.file + ' with ' + d.images + ' images.\nIt is not live. Tell Claude "publish the harvest", then finish it in /keystatic: add a grid icon and untick "Hold back".';
});
</script>
</html>`;
