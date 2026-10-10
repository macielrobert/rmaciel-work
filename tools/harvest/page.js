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
  const d = await api('/api/ls?p=' + encodeURIComponent(p) + '&indesign=' + ($('indesign').checked ? 1 : 0));
  const ul = document.createElement('ul');
  ul.innerHTML = d.dirs.map(n => '<li><span data-p="' + esc(d.path + '/' + n) + '"><i>›</i>' + esc(n) + '</span></li>').join('') +
    // files too, so anything the crawler missed can be added by hand
    d.files.map(n => { const f = d.path + '/' + n; return '<li class="file" data-file="' + esc(f) + '" title="' + esc(n) + '">' + (/\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(n) ? thumb(f) : '') + '<span>' + esc(n) + '</span><button class="btn">Add</button></li>'; }).join('');
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
  const fl = e.target.closest('li.file');
  if (fl) {
    if (!e.target.closest('.btn')) return;
    const pr = S.projects.find(p => p.slug === project);
    if (!pr) return say('Pick a project first, then Add.');
    const b = e.target.closest('.btn');
    if (await addFile(pr, fl.dataset.file)) { b.textContent = 'Added'; b.disabled = true; }
    return;
  }
  const s = e.target.closest('span'); if (!s) return;
  document.querySelectorAll('#tree .sel, #pages .sel').forEach(x => x.classList.remove('sel'));
  s.classList.add('sel'); folder = s.dataset.p; buttons();
  const li = s.parentElement, open = li.querySelector('ul');
  if (open) { open.remove(); s.querySelector('i').textContent = '›'; }
  else { s.querySelector('i').textContent = '⌄'; await branch(li, folder); }
});

// a PDF text card's page, drawn as a picture and added accepted (pagePicture in harvest.js)
async function pagePicture(id) {
  const f = findings.find(x => x.id === id);
  say('Drawing page ' + pdfPage(f) + '…'); busy(1);
  try { await api('/api/pagepicture', { id }); say('Page ' + pdfPage(f) + ' added as a picture — accepted; it is in Organize.'); loadFindings(); poll(); }
  catch (err) { oops(err); }
  finally { busy(-1); }
}
// one file into a project: the tree's Add button, and the right-click menu's Add to project
async function addFile(pr, file) {
  try {
    const d = await api('/api/addfile', { project: pr.slug, path: file, indesign: $('indesign').checked });
    say(d.kind === 'image' ? 'Added to ' + pr.title + ' — accepted; it is in Organize.' : 'Reading it for ' + pr.title + ' — its passages arrive in Pending.');
    poll();
    return true;
  } catch (err) { oops(err); }
}

/* ---- projects */
function drawProjects() {
  if ($('projects').querySelector('.rename')) return;   // not under a rename being typed; it redraws when that ends
  let last = null, h = '';
  for (const p of S.projects) {
    if (p.section !== last) { h += '<div class="sec cap">' + esc(p.section) + '</div>'; last = p.section; }
    h += '<div data-s="' + esc(p.slug) + '" class="' + (p.slug === project ? 'sel' : '') + '"><span>' + esc(p.title) + (p.draft ? ' · draft' : '') + (p.nicknames.length ? '<small>aka ' + p.nicknames.map(esc).join(', ') + '</small>' : '') + '</span><b>' + (p.pending || '') + '</b></div>';
  }
  $('projects').innerHTML = h;
}
$('projects').addEventListener('click', (e) => {
  const d = e.target.closest('[data-s]'); if (!d || e.target.closest('.rename')) return;
  // Asked BEFORE switching. It used to be asked by loadProj, after the list,
  // header and works had already moved on, so Cancel kept only the panel: one
  // project's details over another's works, asking again at every click.
  if (pd && pdDirty && pd.slug !== d.dataset.s) {
    if (!confirm($('ptitle').textContent + ' has unsaved project details. Discard them?\n\nCancel to stay on ' + $('ptitle').textContent + ' — Write to project saves them.')) return;
    setDirty(false); pd = null;
  }
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
/* The server says when something changed (/api/events — see EVENTS in
   harvest.js); the page no longer asks every few seconds. poll() is kept for
   the one case the stream cannot know about: right after this page's own
   action, to show its result now rather than up to half a second later. */
async function poll() {
  try { show(await api('/api/state')); }
  catch (e) { $('status').textContent = '⚠ ' + e.message; }
}
const events = new EventSource('/api/events');   // reconnects by itself if the connection drops
events.onmessage = (e) => show(JSON.parse(e.data));
events.onerror = () => { if (events.readyState !== EventSource.OPEN) $('status').textContent = '⚠ Lost touch with Harvest — reconnecting…'; };
function show(state) {
  S = state;
  const j = S.job;
  $('rootline').textContent = S.root ? 'Last crawl: ' + S.root : 'Pick a folder, then crawl it';
  // a message just shown to the user (moved, published, an error) stays put
  // for five seconds instead of being replaced by the next status check
  if (Date.now() - (say.at || 0) > 5000) $('status').textContent = j.error ? '⚠ ' + j.error
    : j.running ? j.phase + (j.for ? ' for ' + j.for : '') + (j.total ? ' ' + j.done + ' / ' + j.total : ' · ' + j.done) + ' · ' + j.added + ' found'
    : j.phase === 'Done' ? 'Done · ' + j.added + ' new'
    : j.phase === 'Stopped' ? 'Stopped · ' + j.added + ' found before stopping' : '';
  $('stop').hidden = !j.running;
  // redrawn only when it changed: the state arrives whenever ANYTHING did
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
  // held back by typing or a save on its way: look again shortly. Polling
  // used to come round on its own; the stream only speaks when something changes.
  clearTimeout(show.t);
  if (view === 'collect' && changed && !quiet) show.t = setTimeout(() => show(S), 1500);
  $('newcards').hidden = !(changed && j.running && findings.length);
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
// the page number (from 1) of a card read from a PDF page, else 0
const pdfPage = (f) => f.kind === 'text' && f.unit !== undefined && /\.(pdf|ai)$/i.test(f.path) ? f.unit + 1 : 0;
const label = (f) => tilde(f.path) + (f.kind === 'text' && f.unit !== undefined ? ' · ' + (/\.(pdf|ai)$/i.test(f.path) ? 'page ' : 'part ') + (f.unit + 1) : '');
function card(f) {
  const acts = f.status === 'pending'
    ? '<button class="btn" data-a="accepted">Accept</button><button class="btn" data-a="rejected">Reject</button>'
    : f.status === 'written' ? '<span class="dim cap">Written</span>'
    // a linked folder or page is UNLINKED, not undone: "Undo" on it was not
    // found when it was needed. Unlinking rejects it, which takes back its
    // undecided cards and keeps a later crawl from offering it again.
    : (f.status === 'accepted' && (f.kind === 'folder' || f.kind === 'page')) ? '<button class="btn" data-a="rejected" title="Take this ' + f.kind + ' off the project, with the cards from it still waiting in Pending and, for a web page, the pictures it brought in that you have not decided on. Cards you accepted yourself stay.">Unlink</button><button class="btn" data-reread="1" title="Read it again: anything missing comes back. Decided cards are left alone.">Read again</button>'
    : '<button class="btn" data-a="pending">Undo</button>' + (f.status === 'rejected' ? '<button class="btn" data-forget="1" title="Forget this rejection: a later crawl may suggest it again">Forget</button>' : '');
  let h = '<div class="card" data-id="' + f.id + '">' + (f.status === 'written' ? '' : '<input type="checkbox" class="pick"' + (picked.has(f.id) ? ' checked' : '') + '>');
  if (f.kind === 'nickname') h += '<div class="cap dim">Working title?</div><input class="big" data-k="edited" value="' + esc(f.edited ?? f.text) + '">' +
    '<div class="pairs">' + (f.pairs || []).map(([found, site]) => thumb(site) + thumb(found)).join('') + '</div>' +
    '<div class="dim">On the site · found in ' + tilde(f.path) + (f.count > 4 ? ' (' + f.count + ' matches)' : '') + '</div>';
  if (f.kind === 'page') h += '<div class="cap dim">Web page' + (f.linked ? ' · linked' : '') + '</div><div>' + esc(f.title || '') + '</div><div class="src">' + esc(f.path) + '</div>' +
    (f.pairs ? '<div class="pairs">' + f.pairs.map(([found, site]) => thumb(site) + thumb(found)).join('') + '</div><div class="dim">Pictures on this page match the site' + (f.count > 4 ? ' (' + f.count + ')' : '') + '</div>' : '');
  if (f.kind === 'folder') h += '<div class="cap dim">Folder' + (f.linked ? ' · linked' : '') + '</div><div>' + tilde(f.path) + '</div>';
  if (f.kind === 'folder' || f.kind === 'page') {
    // An accepted folder's contents arrive as Pending cards. Said here, with a
    // way to see just those: the card used to say only "linked", and nothing
    // led from it to the hundreds of cards it had made.
    if (f.status === 'accepted') {
      const mine = findings.filter(g => g.from === f.id), wait = mine.filter(g => g.status === 'pending').length;
      h += '<div class="dim">' + (f.stopped ? 'Stopped part-way — Read again to finish. ' : !f.expanded ? 'Reading it… cards appear as they are found. ' : '') +
        mine.length + ' card' + (mine.length === 1 ? '' : 's') + ' from it, ' + wait + ' waiting in Pending</div>' +
        (wait ? '<button class="btn" data-inside="' + esc(f.path) + '">Show what is inside</button>' : '');
    }
  }
  if (f.kind === 'image') {
    h += thumb(f.path) + '<div class="src">' + label(f) + '</div><div class="dim">' + [f.w && f.w + '×' + f.h, f.camera, f.taken].filter(Boolean).map(esc).join(' · ') + '</div>';
    if (f.status === 'accepted') h += '<div class="dim">Next: Organize — copies are stacked there and one is kept</div>';
  }
  if (f.kind === 'text') {
    const pg = pdfPage(f);
    h += '<div class="src">' + label(f) + '</div><textarea data-k="edited">' + esc(f.edited ?? f.text) + '</textarea>' +
      (pg ? '<button class="btn" data-pagepic="1" title="Draw this page of the PDF as a picture and add it to the project, accepted. The text card stays as it is.">Add page ' + pg + ' as a picture</button>' : '');
    if (f.status === 'accepted') h += '<select data-k="target">' + [['description','Add to description'],['detail','Add as detail lines'],['share','Use as share description'],['caption','Used as a caption (Organize)'],['organize','Left to Organize']].map(([v,t]) => '<option value="' + v + '"' + ((f.target || 'description') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
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
  if (inside) {   // Pending, filtered to everything under that folder (or from that page): the search box matches the path
    const p = inside.dataset.inside;
    $('pq').value = /^https?:/.test(p) ? p : (p + '/').replace(/\/+/g, '/'); $('psrc').value = '';
    document.querySelectorAll('#ptype .btn').forEach(x => x.classList.toggle('on', !x.dataset.t));
    shown.pending = 100; drawFindings(); $('pending').closest('.col').scrollTop = 0; return;
  }
  const rr = e.target.closest('[data-reread]');
  if (rr) { api('/api/finding', { id: rr.closest('.card').dataset.id, reread: true }).then(() => { say('Reading it again…'); poll(); }).catch(oops); return; }
  const fg = e.target.closest('[data-forget]');
  if (fg) return forget([fg.closest('.card').dataset.id]);
  const pp = e.target.closest('[data-pagepic]');
  if (pp) return pagePicture(pp.closest('.card').dataset.id);
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.closest('.card').dataset.id;
  const f = findings.find(x => x.id === id);
  const was = f.status;
  f.status = b.dataset.a; picked.delete(id); drawFindings();
  busy(1);
  try { await save(); Object.assign(f, await api('/api/finding', { id, status: b.dataset.a, indesign: $('indesign').checked })); }
  catch (err) { f.status = was; oops(err); if (/no longer there/.test(err.message)) loadFindings(); }
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
// the ticked cards, or one card (the right-click menu's Move to project)
async function bulk(body, ids = [...picked]) {
  const n = ids.length, these = new Set(ids);
  const to = body.project && S.projects.find(p => p.slug === body.project);
  // shown at once: moved cards leave this project, decided ones change column
  for (const f of findings) if (these.has(f.id)) { if (to) f.status = 'moving'; else f.status = body.status; }
  if (to) findings = findings.filter(f => f.status !== 'moving');
  ids.forEach(i => picked.delete(i)); drawFindings();
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
  document.querySelector('[data-pane=folders]').hidden = view === 'organize';   // Organize has no Folders column to show
  $('steps').hidden = view !== 'organize';   // writing is Organize's step, not Collect's
  if (view === 'organize') loadOrg(); else if (project) loadFindings();
});
const KIND_LABEL = { site: 'On the site', web: 'Old website', file: 'File' };
const opick = new Set();   // ticked works, kept across redraws and between List and Grid
const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
let orgView = remember('orgView') || 'list', orgCell = remember('orgCell') || '170';
// REMOVED works are hidden unless asked for: they only wait for Save, and
// greyed out among the rest they were clutter. The header counts them.
let showRemoved = remember('orgShowRemoved') === '1';
function orgPicks() {
  const n = opick.size;
  $('orgmerge').disabled = n < 2;
  $('orgsplit').disabled = !(org && org.stacks.some(t => opick.has(t.id) && t.members.length > 1));
  // Restore when everything ticked is already removed, Remove otherwise
  const ticked = org ? org.stacks.filter(t => opick.has(t.id)) : [];
  $('orgremove').disabled = !ticked.length;
  $('orgremove').textContent = ticked.length && ticked.every(t => t.removed) ? 'Restore' : 'Remove from project';
  $('orgmove').disabled = !n;
  $('orgmove').textContent = n > 1 ? 'Move ' + n + ' to project' : 'Move to project';
}
const tileLabel = (t) => t.n + (t.members.length > 1 ? ' · ' + t.members.length + ' copies' : '') + (t.removed ? ' · removed' : '') + (t.rotate ? ' · turned ' + t.rotate + '°' : '');
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
$('orgq').addEventListener('input', () => { if (org) drawOrg(); });
// ⌘F: Harvest.app's web view has no find bar, so on Organize it goes to the find box
document.addEventListener('keydown', (e) => { if (view === 'organize' && (e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); $('orgq').focus(); $('orgq').select(); } });
async function loadOrg() {
  loadPreview();   // the selected project, and the files as they now are (loadOrg also runs after Write)
  if (!project) { $('orgtitle').textContent = 'Pick a project'; $('stacks').innerHTML = ''; $('orgwrite').disabled = true; return; }
  $('orgtitle').textContent = S.projects.find(p => p.slug === project).title;
  loadProj(); loadTexts();
  $('orgmsg').textContent = 'Grouping copies…'; busy(1);
  try { org = await api('/api/organize?project=' + encodeURIComponent(project)); drawOrg(); $('orgmsg').textContent = ''; }
  catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
}
function drawOrg() {
  const live = org.stacks.filter(t => !t.removed);
  const copies = org.stacks.reduce((n, t) => n + t.members.length, 0);
  $('orgcount').textContent = live.length + ' work' + (live.length === 1 ? '' : 's') + ' · ' + copies + ' picture' + (copies === 1 ? '' : 's');
  $('orgwrite').disabled = false;   // with no works there may still be details or text to write
  // the find box matches EVERY copy's name, so a work turns up even when the copy it was found by is not the kept one
  const q = $('orgq').value.trim().toLowerCase();
  const named = (t) => !q || t.members.some(m => m.name.toLowerCase().includes(q));
  const gone = org.stacks.length - live.length, shown = (showRemoved ? org.stacks : live).filter(named);
  $('orgshowrm').hidden = !gone;
  $('orgshowrm').textContent = showRemoved ? 'Hide removed' : 'Show ' + gone + ' removed';
  for (const k of [...opick]) if (!shown.some(t => t.id === k)) opick.delete(k);   // a hidden work is never acted on unseen
  orgLook(); orgPicks();
  if (orgView === 'grid' && shown.length) {
    $('stacks').innerHTML = shown.map(t => {
      const k = t.members.find(m => m.key === t.keeper) || t.members[0];
      return '<div class="tile' + (t.removed ? ' removed' : '') + (opick.has(t.id) ? ' on' : '') + '" draggable="true" data-id="' + t.id + '" title="' + esc(k.name) + ' — click to tick, double-click to open, drag to reorder">' +
        '<div class="keep" style="--turn:' + t.rotate + 'deg">' + thumb(k.thumb) + '</div>' +
        '<input type="checkbox" class="spick"' + (opick.has(t.id) ? ' checked' : '') + '>' +
        '<div class="under"><small>' + tileLabel(t) + '</small>' +
        '<button class="btn" data-turn="-1" title="Turn left — applied to the file on Save">↺</button><button class="btn" data-turn="1" title="Turn right — applied to the file on Save">↻</button></div>' +
        '<div class="fname">' + esc(k.name) + '</div></div>';
    }).join('');
    return;
  }
  $('stacks').innerHTML = shown.length ? shown.map(t => {
    const k = t.members.find(m => m.key === t.keeper) || t.members[0];
    const info = (m) => [KIND_LABEL[m.kind], m.w && m.w + '×' + m.h, m.taken].filter(Boolean).join(' · ');
    return '<div class="stack' + (t.removed ? ' removed' : '') + '" data-id="' + t.id + '">' +
      '<div><div class="keep" style="--turn:' + t.rotate + 'deg">' + thumb(k.thumb) + '</div>' +
      '<div class="turns"><button class="btn" data-op="rotate" data-dir="-1" title="Turn left">↺</button><button class="btn" data-op="rotate" data-dir="1" title="Turn right">↻</button>' + (t.rotate ? '<span class="dim">turned ' + t.rotate + '° — applied on Save</span>' : '') + '</div>' +
      '<div class="meta">' + esc(info(k)) + '<br>' + esc(k.name) + (k.page ? '<br>from “' + esc(k.page.title) + '”' : '') + '</div>' +
      (t.members.length > 1 ? '<div class="copies">' + t.members.map(m => '<div class="copy' + (m.key === t.keeper ? ' on' : '') + '" data-key="' + esc(m.key) + '" title="' + esc(m.name + ' — ' + info(m) + (m.key === t.keeper ? ' (kept)' : ' — click to keep this one')) + '">' + thumb(m.thumb) + '<small>' + esc(KIND_LABEL[m.kind]) + '</small>' + '<button class="btn sep" data-split="' + esc(m.key) + '" title="Not the same work: give this copy a place of its own">Separate</button></div>').join('') + '</div><div class="dim">' + t.members.length + ' copies — the outlined one is kept</div>' : '') +
      '</div><div>' +
      '<div class="top"><input type="checkbox" class="spick"' + (opick.has(t.id) ? ' checked' : '') + '><b>' + t.n + '</b>' +
      '<button class="btn" data-op="move" data-dir="-1" title="Earlier">↑</button><button class="btn" data-op="move" data-dir="1" title="Later">↓</button>' +
      '<button class="btn" data-op="remove">' + (t.removed ? 'Restore' : 'Remove from project') + '</button></div>' +
      '<input data-f="alt" placeholder="Alt text — what is in the picture (required)" value="' + esc(t.alt) + '">' +
      '<textarea data-f="caption" placeholder="Caption — title, year, medium, size…">' + esc(t.caption) + '</textarea>' +
      (t.maybe.length ? '<div class="chips">' + t.maybe.map(x => '<span><button class="btn chip" data-merge="' + x.id + '">Same work as #' + x.n + '? Merge</button> <button class="btn chip" data-apart="' + x.id + '">Not the same</button></span>').join('') + '</div>' : '') +
      (t.suggest.length ? '<div class="chips">' + t.suggest.map(x => '<button class="btn chip" data-sug="' + esc(x.text) + '"><i>' + esc(x.from) + '</i>' + esc(x.text.length > 220 ? x.text.slice(0, 220) + '…' : x.text) + '</button>').join('') + '</div>' : '') +
      '</div></div>';
  }).join('') : '<p class="dim">' + (q ? (org.stacks.some(named) ? 'Only removed works are named “' + esc(q) + '” — Show removed to see them.' : 'No file here is named “' + esc(q) + '”.') : gone ? 'Every work here is removed. Write to project takes them off the site.' : 'No pictures yet. Accept some in Collect, or add them to the project in Keystatic.') + '</p>';
}
async function orgOp(body, redraw = true) {
  busy(1);
  try { await api('/api/organize', { project, ...body }); if (redraw) { org = await api('/api/organize?project=' + encodeURIComponent(project)); drawOrg(); } }
  catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
}
$('stacks').addEventListener('click', (e) => {
  const work = armed && e.target.closest('.stack, .tile');
  if (work) { e.preventDefault(); attach(work.dataset.id); return; }
  const tile = e.target.closest('.tile');
  // TURN, in grid: shown at once and sent without a redraw, so the grid does
  // not jump; the server keeps the same quarter-turn count as List's buttons
  const turn = tile && e.target.closest('[data-turn]');
  if (turn) {
    const t = org.stacks.find(x => x.id === tile.dataset.id), dir = +turn.dataset.turn;
    t.rotate = ((t.rotate || 0) + (dir > 0 ? 90 : 270)) % 360;
    tile.querySelector('.keep').style.setProperty('--turn', t.rotate + 'deg');
    tile.querySelector('small').textContent = tileLabel(t);
    orgOp({ op: 'rotate', stack: t.id, dir }, false);
    return;
  }
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
  const tile = e.target.closest('.tile'); if (!tile || e.target.closest('[data-turn]')) return;   // two quick turns are not a double-click to open
  remember('orgView', orgView = 'list'); drawOrg();
  document.querySelector('.stack[data-id="' + tile.dataset.id + '"]')?.scrollIntoView({ block: 'start' });
});
// DRAG, in grid: drop on a tile's left or right half to land before or after
// it. Sent as the arrows' own `move` op, with the step the drop works out to
// (the server clamps and splices); the tile moves at once, the redraw confirms
let dragId = null;
const dropSide = (e, tile) => { const r = tile.getBoundingClientRect(); return e.clientX > r.left + r.width / 2 ? 'after' : 'before'; };
const unmark = () => document.querySelectorAll('.tile.before, .tile.after').forEach(x => x.classList.remove('before', 'after'));
$('stacks').addEventListener('dragstart', (e) => {
  const tile = e.target.closest('.tile'); if (!tile) return;
  dragId = tile.dataset.id; tile.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', '');   // some engines start no drag without data
});
$('stacks').addEventListener('dragover', (e) => {
  const tile = dragId && e.target.closest('.tile'); if (!tile) return;
  e.preventDefault(); unmark();
  if (tile.dataset.id !== dragId) tile.classList.add(dropSide(e, tile));
});
$('stacks').addEventListener('drop', (e) => {
  const tile = dragId && e.target.closest('.tile'); if (!tile) return;
  e.preventDefault(); unmark();
  const ids = org.stacks.map(t => t.id), from = ids.indexOf(dragId), side = dropSide(e, tile);
  let to = ids.indexOf(tile.dataset.id) + (side === 'after');
  if (from < to) to--;   // its own place closes up first
  if (to === from) return;
  tile[side](document.querySelector('.tile.dragging'));
  orgOp({ op: 'move', stack: dragId, dir: to - from });
});
$('stacks').addEventListener('dragend', () => { unmark(); undrop(); document.querySelector('.tile.dragging')?.classList.remove('dragging'); dragId = null; });
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
$('orgremove').addEventListener('click', async () => {
  const ticked = org.stacks.filter(t => opick.has(t.id)), value = !ticked.every(t => t.removed);
  opick.clear();
  for (const t of ticked) await orgOp({ op: 'remove', stack: t.id, value }, false);
  await loadOrg();
  $('orgmsg').textContent = (value ? 'Removed ' : 'Restored ') + ticked.length + ' work' + (ticked.length === 1 ? '' : 's') + (value ? '. Write to project takes them off the site; Show removed, then Restore, brings them back before then.' : '.');
});
$('orgshowrm').addEventListener('click', () => { remember('orgShowRemoved', (showRemoved = !showRemoved) ? '1' : '0'); drawOrg(); });
// the opposite of merge: each ticked work's copies go back to being works of their own
$('orgsplit').addEventListener('click', async () => {
  const ids = org.stacks.filter(t => opick.has(t.id) && t.members.length > 1).map(t => t.id);
  const n = org.stacks.filter(t => ids.includes(t.id)).reduce((k, t) => k + t.members.length - 1, 0);
  opick.clear();
  for (const stack of ids) await orgOp({ op: 'unstack', stack }, false);
  await loadOrg();
  $('orgmsg').textContent = 'Separated ' + n + ' cop' + (n === 1 ? 'y' : 'ies') + ' into works of their own.';
});
// the same section-grouped list as the right-click menu, opened under the button
$('orgmove').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect(), ids = org.stacks.filter(t => opick.has(t.id)).map(t => t.id);
  openMenu({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 4 }, projectPicks(p => moveWorks(ids, p.slug), project));
});
// DRAG a grid tile onto a project's name: that work moves there, or every
// ticked work if the dragged one is ticked (as Finder drags a selection)
const undrop = () => document.querySelectorAll('#projects .drop').forEach(x => x.classList.remove('drop'));
$('projects').addEventListener('dragover', (e) => {
  const row = dragId && e.target.closest('[data-s]'); if (!row || row.dataset.s === project) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (!row.classList.contains('drop')) { undrop(); row.classList.add('drop'); }
});
$('projects').addEventListener('dragleave', (e) => { if (!e.relatedTarget?.closest?.('#projects .drop')) undrop(); });
$('projects').addEventListener('drop', (e) => {
  const row = dragId && e.target.closest('[data-s]'); if (!row || row.dataset.s === project) return;
  e.preventDefault(); undrop();
  moveWorks(opick.has(dragId) ? org.stacks.filter(t => opick.has(t.id)).map(t => t.id) : [dragId], row.dataset.s);
});
// the ticked works, or one work (the right-click menu's Move to project)
async function moveWorks(ids, to) {
  const title = S.projects.find(p => p.slug === to).title;
  ids.forEach(i => opick.delete(i));
  for (const stack of ids) await orgOp({ op: 'moveto', stack, to }, false);
  await loadOrg();
  $('orgmsg').textContent = 'Moved ' + ids.length + ' work' + (ids.length === 1 ? '' : 's') + ' to ' + title + '. Any already on this site are marked removed — Write to project takes them off.';
}
/* WRITE TO PROJECT — the one step between Organize and Publish. Collect
   finds and roughly sorts; Organize is where a project is planned, so this is
   where it is written (Robert, 2026-10-06). It was three buttons in two
   places — Collect's Write (text), Organize's Save (works), Project details'
   Save — and NOISE sat accepted and unwritten because two of them were never
   pressed. One button now, three writes, in an order that matters:
     1. Project details, if the panel holds edits. Step 3 appends to the
        description, and the panel saved AFTER it would put its older copy back.
     2. The works. Before the text because it may stop for a second click
        (pictures coming off the site), and nothing more is written until then.
     3. Accepted text placed nowhere else: description paragraphs, detail
        lines, share description, as each card says.
   Each is all-or-nothing on its own; a failure stops the rest, and the line
   says what was written before it. */
async function saveDetails() {
  if (!pd) return false;
  // Only the fields changed here are sent; the server leaves the rest as the
  // file has them — which may be newer than this form (an edit from the phone).
  const now = formValues(), data = {};
  for (const k in now) if (JSON.stringify(now[k]) !== JSON.stringify(pd.shown[k])) data[k] = now[k];
  const body = $('pbody').value !== pd.shownBody ? $('pbody').value : undefined;
  if (!Object.keys(data).length && body === undefined) return false;
  $('orgmsg').textContent = 'Saving project details — checking the site still builds…';
  const r = await api('/api/project', { project: pd.slug, data, body });
  setDirty(false);
  return !r.unchanged;
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
$('orgwrite').addEventListener('click', async () => {
  // fields still waiting on their pause are sent first: a work's, and a card edited in Collect
  for (const el of document.querySelectorAll('#stacks [data-f]')) if (el._t) { clearTimeout(el._t); el._t = null; await orgOp({ op: 'field', stack: el.closest('.stack').dataset.id, field: el.dataset.f, value: el.value }, false); }
  await save();
  const b = $('orgwrite'), confirm = b.dataset.armed === project, done = [];
  let msg = '';
  busy(1);
  try {
    if (await saveDetails()) done.push('project details');
    if (org && org.stacks.length) {
      const d = await api('/api/organize/save', { project, confirm });
      if (d.confirm) {
        b.dataset.armed = project;
        b.textContent = 'Takes ' + plural(d.confirm, 'picture', 'pictures') + ' off the site — click again';
        clearTimeout(orgWrite.t); orgWrite.t = setTimeout(() => { delete b.dataset.armed; b.textContent = 'Write to project'; }, 8000);
        if (done.length) msg = 'Wrote ' + done.join(', ') + '.';
        return;
      }
      done.push(plural(d.saved, 'work', 'works') + (d.dropped ? ' (took ' + d.dropped + ' off)' : ''));
    }
    const w = await api('/api/write', { project });
    if (w.written) done.push(plural(w.written, 'passage', 'passages'));
    delete b.dataset.armed; b.textContent = 'Write to project';
    msg = 'Wrote ' + (done.join(', ') || 'nothing new') + '. Not live yet — Publish (top right) when ready.';
  } catch (e) { msg = (done.length ? 'Wrote ' + done.join(', ') + ', then stopped: ' : '') + '⚠ ' + e.message; }
  finally {
    // Reload what was written, the panel included: one still showing the
    // description from before step 3 would write it back over the new text.
    // Not a panel whose own save failed — its edits are still only on screen.
    await poll();
    if (!pdDirty) pd = null;
    await loadOrg();   // first: reloading clears the message line
    $('orgmsg').textContent = msg;
    busy(-1);
  }
});
const orgWrite = {};

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
    // the panel uploads an icon; Keystatic is not needed for it
    say('Created ' + title + ' as a draft' + (project === d.slug ? ' — it is selected below' : '') + '. Give it a grid icon in Organize › Project details before it can go live.');
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

/* ---- TEXT → ANY FIELD: the project's accepted passages beside the works.
   Click one (or right-click) and say where it goes. A project field is filled
   in Project details, opened if shut, and Write to project checks and writes
   it — so it can be read and tidied first, and nothing reaches the file
   behind the panel's back. A work's caption or alt text: pick it, then click
   the work. Either way the text is ADDED (a one-line field — title, client,
   share description — is replaced, as Write does), and the passage is marked
   with where it went: `caption` for a work, `organize` for a project field,
   both of which Write skips. It stays in the column, dimmed, so it
   can be placed again. Text read out of a picture (a work's right-click ›
   Extract text) arrives here already `organize`, waiting to be placed. */
/* ---- PREVIEW: the site itself, beside the works. "As written" is built from
   the files on this Mac each time it loads (harvest.js, on a port of its own),
   so it shows what Write to project changed before Publish; "Live" is what
   visitors get now. It opens on the selected project. A fresh load every time
   (the ?v=), not a change of the part after #: the build has to run again to
   pick up a Write. The boundary — a link out of the site opens in the default
   browser, not in the pane — is HarvestApp.swift's; a plain browser has none. */
let prevOpen = remember('prevOpen') === '1', prevSrc = remember('prevSrc') || 'written';
function loadPreview() {
  $('preview').hidden = !prevOpen; $('prevtoggle').classList.toggle('on', prevOpen);
  $('orgbody').classList.toggle('prev', prevOpen);
  document.querySelectorAll('#prevsrc [data-src]').forEach(b => b.classList.toggle('on', b.dataset.src === prevSrc));
  if (!prevOpen || !S) return;
  const pr = S.projects.find(p => p.slug === project), shown = pr && !pr.draft;
  // a held-back project is not in the build, and the site would quietly show everything instead
  $('prevmsg').textContent = pr && pr.draft ? pr.title + ' is held back, so the site does not show it yet.' : '';
  $('prevframe').src = (prevSrc === 'live' ? S.live : S.preview) + '?v=' + Date.now() + (shown ? '#' + pr.section + '/' + pr.slug : '');
}
$('prevtoggle').addEventListener('click', () => { prevOpen = !prevOpen; remember('prevOpen', prevOpen ? '1' : '0'); loadPreview(); });
$('prevsrc').addEventListener('click', (e) => { const b = e.target.closest('[data-src]'); if (b) { remember('prevSrc', prevSrc = b.dataset.src); loadPreview(); } });
$('prevreload').addEventListener('click', loadPreview);

let textsOpen = remember('textsOpen') === '1', armed = null, armField = 'caption', otexts = [];
function textsLook() {
  $('texts').hidden = !textsOpen; $('textstoggle').classList.toggle('on', textsOpen);
  $('orgbody').classList.toggle('two', textsOpen);
}
$('textstoggle').addEventListener('click', () => { textsOpen = !textsOpen; remember('textsOpen', textsOpen ? '1' : '0'); disarm(); loadTexts(); });
async function loadTexts() {
  textsLook();
  if (!textsOpen || !project) return;
  const slug = project;
  try {
    const all = await api('/api/findings?project=' + encodeURIComponent(slug));
    if (slug !== project) return;   // switched while it loaded
    otexts = all.filter(f => f.kind === 'text' && f.status === 'accepted');
  } catch (e) { $('texts').innerHTML = '<p class="dim">⚠ ' + esc(e.message) + '</p>'; return; }
  drawTexts();
}
function drawTexts() {
  const src = (f) => /^https?:/.test(f.path) ? new URL(f.path).pathname : f.path.split('/').pop();
  const where = (f) => f.used ? ' · in ' + f.used : f.target === 'caption' ? ' · used as a caption' : '';
  $('texts').innerHTML = '<h2 class="cap">Text <span class="dim">— click one to place it</span></h2>' + (otexts.length ? otexts.map(f =>
    '<div class="tblock' + (armed === f.id ? ' on' : '') + (where(f) ? ' used' : '') + '" data-passage="' + f.id + '">' +
    '<small>' + esc(src(f) + where(f)) + '</small>' + esc(String(f.edited ?? f.text)) + '</div>').join('')
    : '<p class="dim">No accepted text for this project. Accept passages in Collect, or right-click a work › Extract text.</p>');
}
function disarm() { armed = null; document.body.classList.remove('arming'); if (otexts.length) drawTexts(); }
$('texts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-passage]'); if (!b) return;
  if (armed === b.dataset.passage) { disarm(); $('orgmsg').textContent = ''; return; }
  openMenu(e, passageMenu(b.dataset.passage));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) { disarm(); $('orgmsg').textContent = ''; } });
// Project details' fields a passage can go into; the description is the panel's body
const PLACES = { body: 'Description', details: 'Detail lines', share_description: 'Share description', title: 'Title', client: 'Client name', nicknames: 'Working titles' };
function passageMenu(id) {
  return [
    { head: 'Project details' },
    ...Object.entries(PLACES).map(([k, label]) => ({ label, run: () => place(id, k) })),
    { head: 'A work — click it next' },
    { label: 'Caption', run: () => arm(id, 'caption') },
    { label: 'Alt text', run: () => arm(id, 'alt') },
    '-',
    { label: 'Reject', run: () => rejectPassage(id) },
  ];
}
function arm(id, field) {
  armed = id; armField = field; document.body.classList.add('arming'); drawTexts();
  $('orgmsg').textContent = 'Now click the work this is the ' + (field === 'alt' ? 'alt text' : 'caption') + ' of — Esc to cancel.';
}
// where a passage went, so Write leaves it and the column says so
async function mark(f, target, used) {
  try { await api('/api/finding', { id: f.id, target, used }); Object.assign(f, { target, used }); } catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  drawTexts();
}
// as harvest.js's mdEscape, which Write uses: the passage is text, not Markdoc marks
const mdEscape = (t) => t.replace(/([\\`*_{}\[\]<>|])/g, '\\$1').replace(/^(\s*)([#>+-])/gm, '$1\\$2').replace(/^(\s*\d+)\./gm, '$1\\.');
async function place(id, k) {
  const f = otexts.find(x => x.id === id); if (!f) return;
  if (!projOpen) { projOpen = true; remember('projOpen', '1'); }
  await loadProj();
  if (!pd || pd.slug !== project) return;   // the panel kept another project's unsaved edits
  const el = k === 'body' ? $('pbody') : document.querySelector('#proj [data-p=' + k + ']');
  const text = String(f.edited ?? f.text).trim(), cur = el.value.trim();
  el.value = k === 'body' ? [cur, mdEscape(text)].filter(Boolean).join('\n\n')
    : k === 'details' || k === 'nicknames' ? [cur, ...text.split('\n').map(s => s.trim())].filter(Boolean).join('\n')
    : text.replace(/\s+/g, ' ');
  el.dispatchEvent(new Event('input', { bubbles: true }));   // marks the panel unsaved; the description's preview follows
  el.scrollIntoView({ block: 'nearest' });
  await mark(f, 'organize', PLACES[k].toLowerCase());
  $('orgmsg').textContent = 'Put in ' + PLACES[k].toLowerCase() + ' — Write to project when ready.';
}
async function rejectPassage(id) {
  try { await api('/api/finding', { id, status: 'rejected' }); otexts = otexts.filter(x => x.id !== id); drawTexts(); }
  catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
}
async function attach(stack) {
  const f = otexts.find(x => x.id === armed), t = org.stacks.find(x => x.id === stack), field = armField;
  disarm();
  if (!f || !t) return;
  let text = String(f.edited ?? f.text).trim();
  if (field === 'alt') text = text.replace(/\s+/g, ' ');   // one line: its box would drop the breaks and run the words together
  // the box may hold typing not yet sent: read it from the page if it is there
  const box = document.querySelector('.stack[data-id="' + stack + '"] [data-f=' + field + ']');
  if (box) { clearTimeout(box._t); box._t = null; }   // its pending save would land after this one and drop the passage
  const cur = (box ? box.value : t[field]).trim();
  await orgOp({ op: 'field', stack, field, value: cur ? cur + (field === 'alt' ? ' ' : '\n') + text : text });
  const what = (field === 'alt' ? 'alt text' : 'caption') + ' of work ' + t.n;
  await mark(f, 'caption', what);
  $('orgmsg').textContent = 'Added to the ' + what + '. Write to project when ready.';
}
// a work's right-click: the words in its kept copy become a passage here
async function extractWork(id) {
  const t = org.stacks.find(x => x.id === id), slug = project;
  $('orgmsg').textContent = 'Reading the text in work ' + t.n + '…'; busy(1);
  try {
    const f = await api('/api/extract', { project: slug, stack: id });
    if (!textsOpen) { textsOpen = true; remember('textsOpen', '1'); }
    await loadTexts();
    document.querySelector('#texts [data-passage="' + f.id + '"]')?.scrollIntoView({ block: 'nearest' });
    $('orgmsg').textContent = 'The text in work ' + t.n + ' is in the Text column — click it to place it.';
  } catch (e) { $('orgmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
}

/* ---- PROJECT PANEL: every field Keystatic edits, except the pictures (the works below).
   Save sends the whole form; the server writes it the way Keystatic would and
   runs build.js before and after — a save that would break the site is put back.
   The panel remembers WHICH project it holds (pd.slug), and Save goes there,
   never to whatever project is selected now. */
let pd = null, pdDirty = false;
// The panel says when it holds edits, and has the one Write right there: with
// the button only at the top right, a panel of edits looked unsaveable (Robert,
// 2026-10-10). Still ONE write — this clicks the header's — not a second Save.
function setDirty(v) { pdDirty = v; $('punsaved').hidden = !v; }
$('pwrite').addEventListener('click', () => $('orgwrite').click());
const marks = {};   // icon_image / wordmark: a site path, '' for none, or { upload, name } waiting for Save
let projOpen = remember('projOpen') === '1';
function projLook() { $('proj').hidden = !projOpen; $('projtoggle').classList.toggle('on', projOpen); }
$('projtoggle').addEventListener('click', () => { projOpen = !projOpen; remember('projOpen', projOpen ? '1' : '0'); projLook(); loadProj(); });
// `keep` is said by the caller: the file's value when a project is loaded,
// the menu's own when only the section changed. Reading it off the menu on
// load carried one project's lead into the next one opened (review, 2026-10-04).
function partOfOptions(section, keep) {
  const sel = document.querySelector('#proj [data-p=part_of]');
  // the same section, not itself, and not a sub-project: build.js refuses the rest
  const ok = S.projects.filter(p => p.section === section && p.slug !== pd.slug && !p.part_of);
  sel.innerHTML = '<option value="">— none: a project of its own —</option>' + ok.map(p => '<option value="' + esc(p.slug) + '">' + esc(p.title) + '</option>').join('') +
    (keep && !ok.some(p => p.slug === keep) ? '<option value="' + esc(keep) + '">' + esc(keep) + ' (not allowed here)</option>' : '');
  sel.value = keep;
}
async function loadProj() {
  projLook();
  if (!projOpen || !project || (pd && pd.slug === project)) return;
  if (pdDirty && !confirm('Discard the unsaved project details for ' + $('ptitle').textContent + '?')) return;
  try { pd = await api('/api/project?project=' + encodeURIComponent(project)); } catch (e) { $('pmsg').textContent = '⚠ ' + e.message; return; }
  fillProj();
}
function fillProj() {
  const d = pd.data;
  // Keystatic's defaults, for a field the file does not have yet
  const v = { section: 'build', order: 10, layout: 'standard', icon_type: 'glyph', ...d, expand: d.expand !== false };
  for (const el of document.querySelectorAll('#proj [data-p]')) {
    const k = el.dataset.p;
    if (k === 'part_of') continue;
    if (el.type === 'checkbox') el.checked = !!v[k];
    else el.value = Array.isArray(v[k]) ? v[k].join('\n') : (v[k] ?? '');
  }
  partOfOptions(v.section, d.part_of || '');
  marks.icon_image = d.icon_image || ''; marks.wordmark = d.wordmark || '';
  drawMarks();
  $('pbody').value = pd.body || '';
  $('ptitle').textContent = d.title || pd.slug;
  addr(v.section);
  $('pmsg').textContent = '';
  setDirty(false);
  // what the form showed when loaded: Save sends only what differs from it
  pd.shown = formValues(); pd.shownBody = $('pbody').value;
  showDesc();
}
// follows the Section menu: it said #build beside a menu reading ART
const addr = (section) => { $('paddr').textContent = 'Address #' + section + '/' + pd.slug + ' — permanent, it does not change with the title'; };
function formValues() {
  const out = { icon_image: marks.icon_image, wordmark: marks.wordmark };
  for (const el of document.querySelectorAll('#proj [data-p]')) out[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value;
  return out;
}
function drawMarks() {
  const glyph = document.querySelector('#proj [data-p=icon_type]').value === 'glyph';
  document.querySelector('#proj [data-p=icon_glyph]').hidden = !glyph;
  for (const box of document.querySelectorAll('#proj [data-mark]')) {
    const k = box.dataset.mark, m = marks[k];
    const pick = '<label class="btn">Choose file…<input type="file" accept=".png,.svg,image/png,image/svg+xml" hidden></label>';
    // a typed icon still offers the upload, which switches the icon to it: hidden
    // behind the menu, the upload was missed and Keystatic looked like the only way
    if (k === 'icon_image' && glyph) { box.innerHTML = '<span>Or an image (PNG or SVG)</span>' + pick; continue; }
    const src = !m ? '' : typeof m === 'object' ? m.upload : m;
    box.innerHTML = (src ? '<div class="tile"><img src="/raw?p=' + encodeURIComponent(src) + '"></div>' : '') +
      '<span>' + (typeof m === 'object' ? esc(m.name) + ' — saved with the project' : src ? esc(src.split('/').pop()) : 'None') + '</span>' + pick +
      (k === 'wordmark' && m ? '<button class="btn" data-unmark>Remove</button>' : '');
  }
}
$('proj').addEventListener('input', (e) => {
  setDirty(true);
  if (e.target.dataset.p === 'section') { partOfOptions(e.target.value, document.querySelector('#proj [data-p=part_of]').value); addr(e.target.value); }
  if (e.target.dataset.p === 'icon_type') drawMarks();
  if (e.target.id === 'pbody') { clearTimeout(showDesc.t); showDesc.t = setTimeout(showDesc, 300); }
});
$('proj').addEventListener('change', async (e) => {
  if (e.target.type !== 'file' || !e.target.files[0]) return;
  const k = e.target.closest('[data-mark]').dataset.mark, f = e.target.files[0];
  const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
  busy(1);
  try { marks[k] = { upload: (await api('/api/project/upload', { name: f.name, data })).upload, name: f.name }; if (k === 'icon_image') document.querySelector('#proj [data-p=icon_type]').value = 'image'; setDirty(true); drawMarks(); }
  catch (err) { $('pmsg').textContent = '⚠ ' + err.message; }
  finally { busy(-1); }
});
$('proj').addEventListener('click', (e) => {
  if (e.target.closest('[data-unmark]')) { marks[e.target.closest('[data-mark]').dataset.mark] = ''; setDirty(true); drawMarks(); }
  const b = e.target.closest('[data-md]'); if (b) markup(b.dataset.md);
});
// The description is Markdoc, as Keystatic writes it. The buttons put the
// marks in for you; the preview shows what the site will make of them.
const WRAP = { bold: ['**', '**'], italic: ['_', '_'], strike: ['~~', '~~'], underline: ['{% underline %}', '{% /underline %}'],
  light: ['{% light %}', '{% /light %}'], small: ['{% small %}', '{% /small %}'], large: ['{% large %}', '{% /large %}'], link: ['[', '](https://)'] };
const PREFIX = { list: () => '- ', numbered: (i) => (i + 1) + '. ', quote: () => '> ' };
function markup(kind) {
  const t = $('pbody'); let a = t.selectionStart, b = t.selectionEnd;
  if (WRAP[kind]) t.setRangeText(WRAP[kind][0] + t.value.slice(a, b) + WRAP[kind][1], a, b, 'select');
  else if (PREFIX[kind]) {   // whole lines: from the start of the first to the end of the last
    a = t.value.lastIndexOf('\n', a - 1) + 1;
    const e = t.value.indexOf('\n', b); b = e < 0 ? t.value.length : e;
    t.setRangeText(t.value.slice(a, b).split('\n').map((l, i) => PREFIX[kind](i) + l).join('\n'), a, b, 'select');
  } else if (kind === 'divider') t.setRangeText('\n\n---\n\n', b, b, 'end');
  t.focus(); setDirty(true); showDesc();
}
async function showDesc() {
  try { const d = await api('/api/preview', { body: $('pbody').value }); $('ppreview').innerHTML = d.error ? '<span class="dim">' + esc(d.error) + '</span>' : d.html; }
  catch { /* a preview is a convenience; Write to project is what checks */ }
}

/* ---- RIGHT-CLICK MENU — on a project, a folder or file in the tree, a card,
   or a work. Mostly the buttons already on the thing, gathered where the
   pointer is; what is new is Rename, Move to section, Hold back, View on
   live site, Show in Finder / Open, Move to top / bottom, and Add or Crawl
   for any project rather than only the selected one. In a text field the
   Mac's own menu stays (copy, paste, spelling). An item is { label, run },
   { label, sub: [items] }, { head } for a heading, or '-' for a rule. */
const isWeb = (p) => /^https?:/.test(p);
const opener = (b) => api('/api/open', b).catch(oops);
function closeMenu() { $('menu').hidden = true; $('menu').innerHTML = ''; }
function menuList(items) {
  const box = document.createElement('div'); box.className = 'mlist';
  for (const it of items) {
    if (it === '-') { box.appendChild(document.createElement('hr')); continue; }
    if (it.head) { const h = document.createElement('div'); h.className = 'mh'; h.textContent = it.head; box.appendChild(h); continue; }
    const b = document.createElement('button');
    b.className = 'btn mi'; b.textContent = it.label; b.disabled = !!it.off;
    if (it.title) b.title = it.title;
    if (it.sub) {
      const w = document.createElement('div'), sub = menuList(it.sub);
      w.className = 'mwrap'; b.classList.add('opens'); sub.classList.add('sub');
      b.addEventListener('click', () => { openSub(b); sub.querySelector('.mi')?.focus(); });
      w.append(b, sub); box.appendChild(w);
    } else {
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      box.appendChild(b);
    }
  }
  return box;
}
// a submenu beside its item, on whichever side has room, kept inside the window
function openSub(b) {
  const w = b.parentElement, sub = b.nextElementSibling;
  for (const o of w.parentElement.querySelectorAll(':scope > .mwrap.open')) if (o !== w) o.classList.remove('open');
  if (w.classList.contains('open')) return;
  w.classList.add('open');
  const r = b.getBoundingClientRect();
  sub.style.left = (r.right + sub.offsetWidth < innerWidth ? r.right : Math.max(0, r.left - sub.offsetWidth)) + 'px';
  sub.style.top = Math.max(8, Math.min(r.top - 7, innerHeight - sub.offsetHeight - 8)) + 'px';
}
function openMenu(e, items) {
  e.preventDefault();
  const m = $('menu');
  m.innerHTML = ''; m.appendChild(menuList(items)); m.hidden = false;
  m.style.left = (e.clientX + m.offsetWidth < innerWidth ? e.clientX : Math.max(0, e.clientX - m.offsetWidth)) + 'px';
  m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - m.offsetHeight - 8)) + 'px';
}
$('menu').addEventListener('mouseover', (e) => {
  const b = e.target.closest('.mi'); if (!b) return;
  if (b.classList.contains('opens')) openSub(b);
  else for (const o of b.parentElement.querySelectorAll(':scope > .mwrap.open')) o.classList.remove('open');
});
document.addEventListener('mousedown', (e) => { if (!$('menu').hidden && !e.target.closest('#menu')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('menu').hidden) closeMenu(); });
addEventListener('blur', closeMenu);
addEventListener('resize', closeMenu);
// a column scrolling moves what the menu is about out from under it; the menu's own lists scroll too, and stay
document.addEventListener('scroll', (e) => { if (!e.target.closest?.('#menu')) closeMenu(); }, true);
document.addEventListener('contextmenu', (e) => {
  closeMenu();
  const t = e.target;
  if (t.closest('input, textarea, select, #menu')) return;
  const pr = t.closest('#projects [data-s]'), file = t.closest('#tree li.file'), dir = t.closest('#tree span[data-p]');
  const card = t.closest('#review .card[data-id]'), work = t.closest('#stacks [data-id]'), passage = t.closest('#texts [data-passage]');
  const items = pr ? projectMenu(pr.dataset.s) : file ? fileMenu(file.dataset.file) : dir ? folderMenu(dir.dataset.p)
    : card ? cardMenu(card) : work ? workMenu(work.dataset.id) : passage ? passageMenu(passage.dataset.passage) : null;
  if (items) openMenu(e, items);
});
// every project but `except`, under section headings as in the Projects column
function projectPicks(go, except) {
  const out = []; let last = null;
  for (const p of S.projects) {
    if (p.slug === except) continue;
    if (p.section !== last) { out.push({ head: p.section }); last = p.section; }
    out.push({ label: p.title + (p.draft ? ' · draft' : ''), run: () => go(p) });
  }
  return out;
}
const showOpen = (p, open) => [
  { label: 'Show in Finder', off: isWeb(p), run: () => opener({ path: p, reveal: true }) },
  open || { label: isWeb(p) ? 'Open in browser' : 'Open', run: () => opener({ path: p }) },
];

// PROJECT. Rename, section and hold-back save through the same check as
// Project details (build.js run first), and say in the status line how it went.
function projectMenu(slug) {
  const p = S.projects.find(x => x.slug === slug);
  const pick = () => { if (project !== slug) document.querySelector('#projects [data-s="' + slug + '"]').click(); };
  const organize = () => { pick(); if (view !== 'organize') document.querySelector('[data-view=organize]').click(); };
  return [
    { label: 'Rename…', run: () => renameProject(slug) },
    { label: 'Move to section', sub: ['build', 'design', 'art'].map(k => ({ label: k.toUpperCase(), off: k === p.section, run: () => setProject(slug, { section: k }, 'Moved ' + p.title + ' to ' + k.toUpperCase()) })) },
    p.draft ? { label: 'Stop holding back', run: () => setProject(slug, { draft: false }, p.title + ' will go on the site') }
            : { label: 'Hold back (do not publish)', run: () => setProject(slug, { draft: true }, p.title + ' is held back') },
    '-',
    { label: 'Add working title…', run: () => { pick(); $('nick').focus(); } },
    { label: 'Open in Organize', run: organize },
    { label: 'Project details', run: () => { organize(); if (!projOpen) $('projtoggle').click(); } },
    '-',
    { label: 'View on live site', off: p.draft, title: p.draft ? 'Held back: it is not on the site' : '', run: () => opener({ project: slug }) },
  ];
}
async function setProject(slug, data, done) {
  say('Saving — checking the site still builds…'); busy(1);
  try {
    const r = await api('/api/project', { project: slug, data });
    if (pd && pd.slug === slug && !pdDirty) { pd = null; loadProj(); }   // the panel, if it shows this project and holds no edits of its own
    await poll();
    if (project === slug) $('orgtitle').textContent = S.projects.find(x => x.slug === slug).title;
    say(r.unchanged ? 'Nothing changed.' : done + '. Not live yet — Publish (top right) when ready.');
  } catch (e) { oops(e); }
  finally { busy(-1); }
}
// in place, as in Finder: Return or clicking away keeps it, Escape does not.
// The title only — the address (#section/slug) is permanent.
function renameProject(slug) {
  const p = S.projects.find(x => x.slug === slug), span = document.querySelector('#projects [data-s="' + slug + '"] > span');
  const box = document.createElement('input');
  box.className = 'rename'; box.value = p.title;
  span.replaceWith(box); box.focus(); box.select();
  let over = false;
  const end = (keep) => {
    if (over) return; over = true;
    const title = box.value.trim();
    box.remove(); drawProjects();
    if (keep && title && title !== p.title) setProject(slug, { title }, 'Renamed to ' + title);
  };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
  box.addEventListener('blur', () => end(true));
}

// FOLDER and FILE in the tree: for any project, not only the selected one
function folderMenu(dir) {
  return [
    { label: 'Link to project', sub: projectPicks(p => linkTo(p, dir)) },
    { label: 'Crawl for project', sub: projectPicks(p => api('/api/crawl', { root: dir, projects: [p.slug], indesign: $('indesign').checked }).then(() => { say('Crawling it for ' + p.title + '.'); poll(); }).catch(oops)) },
    '-', ...showOpen(dir),
  ];
}
async function linkTo(p, dir) {
  try {
    const body = { project: p.slug, path: dir, indesign: $('indesign').checked };
    if ((await api('/api/link', body)).confirm) {
      if (!confirm('That folder holds over 300 files. File every one of them under ' + p.title + '?\n\nTo sort them by project instead, use Crawl for project.')) return;
      await api('/api/link', { ...body, force: true });
    }
    say('Linked to ' + p.title + ' — what is inside arrives in Pending.'); poll();
  } catch (e) { oops(e); }
}
const fileMenu = (file) => [{ label: 'Add to project', sub: projectPicks(p => addFile(p, file)) }, '-', ...showOpen(file)];

// CARD: its own buttons, then Move and Finder. Each button is found again when
// chosen, since the column may have been redrawn while the menu was open.
function cardMenu(el) {
  const id = el.dataset.id, f = findings.find(x => x.id === id);
  if (!f) return null;
  const again = (sel) => () => document.querySelector('#review .card[data-id="' + CSS.escape(id) + '"] ' + sel)?.click();
  const own = [...el.querySelectorAll('.acts .btn, [data-inside]')].map(b => ({ label: b.textContent,
    run: again(b.dataset.a ? '[data-a="' + b.dataset.a + '"]' : b.dataset.reread ? '[data-reread]' : b.dataset.forget ? '[data-forget]' : '[data-inside]') }));
  if (page) own.push({ label: 'Add page ' + page + ' as a picture', run: () => pagePicture(id) });
  const page = pdfPage(f);
  return [
    ...own,
    ...(el.querySelector('.pick') ? [{ label: 'Move to project', sub: projectPicks(p => bulk({ project: p.slug }, [id]), project) }] : []),
    '-', ...showOpen(f.path, page && { label: 'Open at page ' + page, run: () => opener({ path: f.path, page }) }),
  ];
}

// WORK in Organize, list or grid. Show original is the kept copy.
function workMenu(id) {
  const t = org && org.stacks.find(x => x.id === id);
  if (!t) return null;
  const k = t.members.find(m => m.key === t.keeper) || t.members[0];
  const op = (body) => () => orgOp({ stack: id, ...body });
  return [
    { label: 'Move to top', run: op({ op: 'move', dir: -1e6 }) },
    { label: 'Move to bottom', run: op({ op: 'move', dir: 1e6 }) },
    '-',
    { label: 'Turn left', run: op({ op: 'rotate', dir: -1 }) },
    { label: 'Turn right', run: op({ op: 'rotate', dir: 1 }) },
    { label: 'Separate copies', off: t.members.length < 2, run: op({ op: 'unstack' }) },
    { label: t.removed ? 'Restore' : 'Remove from project', run: op({ op: 'remove' }) },
    { label: 'Move to project', sub: projectPicks(p => moveWorks([id], p.slug), project) },
    '-',
    { label: 'Extract text', title: 'Read the words in this picture into the Text column', run: () => extractWork(id) },
    isWeb(k.thumb) ? { label: 'Open original in browser', run: () => opener({ path: k.thumb }) } : { label: 'Show original in Finder', run: () => opener({ path: k.thumb, reveal: true }) },
  ];
}

/* ---- COLUMNS: Folders and Projects can each be shut from the header, and
   every column line can be dragged. A side column (Folders, Projects, Text)
   is sized in pixels; the three review columns share theirs as proportions,
   so with both side columns shut they fill the window. Remembered on this
   Mac, as List/Grid is. */
function paneLook(k, open) {
  document.querySelector('[data-pane=' + k + ']').classList.toggle('on', open);
  document.querySelector('main').classList.toggle('shut-' + k, !open);
}
['folders', 'projects'].forEach(k => paneLook(k, remember('pane-' + k) !== '0'));
$('panes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pane]'); if (!b) return;
  const open = !b.classList.contains('on');
  paneLook(b.dataset.pane, open); remember('pane-' + b.dataset.pane, open ? '1' : '0');
});
let widths = {};
try { widths = JSON.parse(remember('widths')) || {}; } catch {}
const setWidth = (k, v) => { widths[k] = v; document.documentElement.style.setProperty('--w-' + k, v); };
Object.entries(widths).forEach(([k, v]) => setWidth(k, v));
document.addEventListener('pointerdown', (e) => {
  const s = e.target.closest('.seam'); if (!s || e.button) return;
  e.preventDefault(); s.setPointerCapture(e.pointerId);
  s.classList.add('drag'); document.body.classList.add('sizing');
  const a = s.previousElementSibling, b = s.nextElementSibling, x0 = e.clientX, wa = a.offsetWidth, wb = b.offsetWidth;
  // the Preview may take most of the window: the site's wide layout needs the room
  const MIN = 140, clamp = (w) => Math.min(Math.max(w, MIN), innerWidth * ('right' in s.dataset ? 0.75 : 0.5));
  // proportions in pixels, so the column not beside this seam keeps its share.
  // All measured before any is written: each write re-lays out the other two.
  if (s.dataset.fr) [...document.querySelectorAll('#review > .col')].map(c => [c.dataset.w, c.offsetWidth + 'fr']).forEach(([k, v]) => setWidth(k, v));
  const move = (ev) => {
    const d = ev.clientX - x0;
    if (s.dataset.fr) { const na = Math.min(Math.max(wa + d, MIN), wa + wb - MIN); setWidth(a.dataset.w, na + 'fr'); setWidth(b.dataset.w, wa + wb - na + 'fr'); }
    else if (a.dataset.w && !('right' in s.dataset)) setWidth(a.dataset.w, clamp(wa + d) + 'px');   // the column left of the line
    else setWidth(b.dataset.w, clamp(wb - d) + 'px');   // Text or Preview, right of it (data-right: Text is on its left)
  };
  s.addEventListener('pointermove', move);
  s.addEventListener('lostpointercapture', () => {
    s.removeEventListener('pointermove', move);
    s.classList.remove('drag'); document.body.classList.remove('sizing');
    remember('widths', JSON.stringify(widths));
  }, { once: true });
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
