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
    try {
      const d = await api('/api/addfile', { project, path: fl.dataset.file });
      b.textContent = 'Added'; b.disabled = true;
      say(d.kind === 'image' ? 'Added to ' + pr.title + ' — accepted; it is in Organize.' : 'Reading it for ' + pr.title + ' — its passages arrive in Pending.');
      poll();
    } catch (err) { oops(err); }
    return;
  }
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
    // a linked folder or page is UNLINKED, not undone: "Undo" on it was not
    // found when it was needed. Unlinking rejects it, which takes back its
    // undecided cards and keeps a later crawl from offering it again.
    : (f.status === 'accepted' && (f.kind === 'folder' || f.kind === 'page')) ? '<button class="btn" data-a="rejected" title="Take this ' + f.kind + ' off the project, and the cards from it still waiting in Pending. Cards already accepted stay.">Unlink</button><button class="btn" data-reread="1" title="Read it again: anything missing comes back. Decided cards are left alone.">Read again</button>'
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
  loadProj();
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

/* ---- PROJECT PANEL: every field Keystatic edits, except the pictures (the works below).
   Save sends the whole form; the server writes it the way Keystatic would and
   runs build.js before and after — a save that would break the site is put back.
   The panel remembers WHICH project it holds (pd.slug), and Save goes there,
   never to whatever project is selected now. */
let pd = null, pdDirty = false;
const marks = {};   // icon_image / wordmark: a site path, '' for none, or { upload, name } waiting for Save
let projOpen = remember('projOpen') === '1';
function projLook() { $('proj').hidden = !projOpen; $('projtoggle').classList.toggle('on', projOpen); }
$('projtoggle').addEventListener('click', () => { projOpen = !projOpen; remember('projOpen', projOpen ? '1' : '0'); projLook(); loadProj(); });
function partOfOptions(section) {
  const sel = document.querySelector('#proj [data-p=part_of]'), keep = sel.value || (pd && pd.data.part_of) || '';
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
  partOfOptions(v.section);
  marks.icon_image = d.icon_image || ''; marks.wordmark = d.wordmark || '';
  drawMarks();
  $('pbody').value = pd.body || '';
  $('ptitle').textContent = d.title || pd.slug;
  $('paddr').textContent = 'Address #' + v.section + '/' + pd.slug + ' — permanent, it does not change with the title';
  $('pmsg').textContent = '';
  pdDirty = false;
  showDesc();
}
function drawMarks() {
  const glyph = document.querySelector('#proj [data-p=icon_type]').value === 'glyph';
  document.querySelector('#proj [data-p=icon_glyph]').hidden = !glyph;
  document.querySelector('[data-mark=icon_image]').hidden = glyph;
  for (const box of document.querySelectorAll('#proj [data-mark]')) {
    const k = box.dataset.mark, m = marks[k];
    const src = !m ? '' : typeof m === 'object' ? m.upload : m;
    box.innerHTML = (src ? '<div class="tile"><img src="/raw?p=' + encodeURIComponent(src) + '"></div>' : '') +
      '<span>' + (typeof m === 'object' ? esc(m.name) + ' — saved with the project' : src ? esc(src.split('/').pop()) : 'None') + '</span>' +
      '<label class="btn">Choose file…<input type="file" accept=".png,.svg,image/png,image/svg+xml" hidden></label>' +
      (k === 'wordmark' && m ? '<button class="btn" data-unmark>Remove</button>' : '');
  }
}
$('proj').addEventListener('input', (e) => {
  pdDirty = true;
  if (e.target.dataset.p === 'section') partOfOptions(e.target.value);
  if (e.target.dataset.p === 'icon_type') drawMarks();
  if (e.target.id === 'pbody') { clearTimeout(showDesc.t); showDesc.t = setTimeout(showDesc, 300); }
});
$('proj').addEventListener('change', async (e) => {
  if (e.target.type !== 'file' || !e.target.files[0]) return;
  const k = e.target.closest('[data-mark]').dataset.mark, f = e.target.files[0];
  const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
  busy(1);
  try { marks[k] = { upload: (await api('/api/project/upload', { name: f.name, data })).upload, name: f.name }; pdDirty = true; drawMarks(); }
  catch (err) { $('pmsg').textContent = '⚠ ' + err.message; }
  finally { busy(-1); }
});
$('proj').addEventListener('click', (e) => {
  if (e.target.closest('[data-unmark]')) { marks[e.target.closest('[data-mark]').dataset.mark] = ''; pdDirty = true; drawMarks(); }
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
  t.focus(); pdDirty = true; showDesc();
}
async function showDesc() {
  try { const d = await api('/api/preview', { body: $('pbody').value }); $('ppreview').innerHTML = d.error ? '<span class="dim">' + esc(d.error) + '</span>' : d.html; }
  catch { /* a preview is a convenience; Save is what checks */ }
}
$('psave').addEventListener('click', async () => {
  if (!pd) return;
  const data = { icon_image: marks.icon_image, wordmark: marks.wordmark };
  for (const el of document.querySelectorAll('#proj [data-p]')) data[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value;
  $('pmsg').textContent = 'Saving — checking the site still builds…'; busy(1);
  try {
    const r = await api('/api/project', { project: pd.slug, data, body: $('pbody').value });
    const slug = pd.slug; pd = null; pdDirty = false;
    await poll();
    await loadProj();   // whichever project is selected now: the one just saved, or the one switched to while it held unsaved edits
    if (project) $('orgtitle').textContent = S.projects.find(p => p.slug === project).title;
    $('pmsg').textContent = 'Saved. Not live yet — Publish (top right) when ready.' + (r.warning ? ' Note: the site already fails to build because of something else — ' + r.warning : '');
  } catch (e) { $('pmsg').textContent = '⚠ ' + e.message; }
  finally { busy(-1); }
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
