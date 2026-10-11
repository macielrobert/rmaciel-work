/* THE DESCRIPTION, EDITED FORMATTED (UX-5). It was a Markdoc textarea with
   buttons that typed the marks around a selection, and the result was seen
   only in the site preview after a save. Now the words are shown as the site
   sets them — its face, 12px, 1.7, its marks, lists, quotes and dividers —
   and the buttons format them. markdoc-pm.mjs says why ProseMirror, and
   what it writes.

   THE TEXTAREA IS STILL THE VALUE. #pbody holds the Markdoc and everything
   in page.js reads it — the draft, Save, Kept text, Discard — so this module
   only keeps it current: every edit here writes the Markdoc into it and
   fires its `input`, which is what marks the fields unsaved. Opened, a
   description is left exactly as the file has it until it is edited.
   Rejected: making the editor the value and page.js ask it — a dozen readers
   to change, each one a way for Save to send something other than what is shown.

   MARKDOC TEXT stays one click away (the button at the end of the toolbar),
   and is where a description opens when the editor cannot show all of it
   (markdoc-pm.mjs refuses rather than drops): the note under the toolbar
   says which part, and nothing is lost. In text mode the same buttons type
   the marks, as before (markup() in page.js).

   The page works without this module: if it fails to load, the textarea is
   what shows, and the console says why. */

import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, wrapIn, lift, chainCommands } from 'prosemirror-commands';
import { canSplit } from 'prosemirror-transform';
import { schema, fromMarkdoc, toMarkdoc, roundTrips, Unsupported } from './markdoc-pm.mjs';

const $ = (id) => document.getElementById(id);
const area = $('pbody'), host = $('pdesc'), note = $('descnote'), modeBtn = $('descmode');
const N = schema.nodes, M = schema.marks;
const remember = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} };
let wantText = remember('descText') === '1';   // chosen, not forced: kept across projects
let shown = null;                              // the Markdoc the editor was loaded with
let warned = false;                            // the note says an edit would not save as shown

const MARK_OF = { bold: M.strong, italic: M.em, underline: M.underline, strike: M.strike, light: M.light, small: M.small, large: M.large };

// ---- commands the toolbar and the keys share
const listAround = (state) => {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === N.bullet_list || $f.node(d).type === N.ordered_list) return { node: $f.node(d), pos: $f.before(d) };
  return null;
};
// A list on, off or switched. On: every selected paragraph becomes an item.
// Off: the whole list goes back to paragraphs — no button nests a list, so
// there is no half-way to stop at.
const toggleList = (type) => (state, dispatch) => {
  const l = listAround(state);
  if (l && l.node.type !== type) { if (dispatch) dispatch(state.tr.setNodeMarkup(l.pos, type)); return true; }
  if (l) {
    // the cursor stays in its words: where it was in the item, it is in the paragraph
    const blocks = [], head = state.selection.head;
    let at = null, out = l.pos;
    l.node.forEach((item, itemOff) => item.forEach((b, bOff) => {
      const was = l.pos + 2 + itemOff + bOff;
      if (head >= was && head <= was + b.nodeSize) at = out + (head - was);
      blocks.push(b); out += b.nodeSize;
    }));
    if (dispatch) {
      const tr = state.tr.replaceWith(l.pos, l.pos + l.node.nodeSize, blocks);
      if (at != null) tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  const { $from, $to } = state.selection, range = $from.blockRange($to);
  if (!range) return false;
  const items = [], head = state.selection.head;
  let at = range.start + 3, pos = range.start;
  for (let i = range.startIndex; i < range.endIndex; i++) {
    const b = range.parent.child(i);
    if (b.type !== N.paragraph) return false;
    // each item before it adds its two edges, and the list its own one
    if (head >= pos && head <= pos + b.nodeSize) at = head + 2 + 2 * items.length;
    items.push(N.list_item.create(null, b)); pos += b.nodeSize;
  }
  if (dispatch) {
    const tr = state.tr.replaceWith(range.start, range.end, type.create(null, items));
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)))).scrollIntoView());
  }
  return true;
};
const inQuote = (state) => { const $f = state.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === N.blockquote) return true; return false; };
const toggleQuote = (state, dispatch) => inQuote(state) ? lift(state, dispatch) : wrapIn(N.blockquote)(state, dispatch);
const divider = (state, dispatch) => {
  if (dispatch) {
    const $t = state.selection.$to, at = $t.depth ? $t.after(1) : $t.pos, tr = state.tr.insert(at, N.divider.create());
    if (at + 1 >= tr.doc.content.size) tr.insert(at + 1, N.paragraph.create());   // somewhere to type after it
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView());
  }
  return true;
};
// Return in a list item: a new item; in an empty one, out of the list
const listEnter = (state, dispatch) => {
  const $f = state.selection.$from;
  if ($f.depth < 2 || $f.node(-1).type !== N.list_item) return false;
  if (!$f.parent.content.size && state.selection.empty) return lift(state, dispatch);
  const tr = state.tr.deleteSelection(), pos = tr.selection.from;
  if (!canSplit(tr.doc, pos, 2)) return false;
  if (dispatch) dispatch(tr.split(pos, 2).scrollIntoView());
  return true;
};
const lineBreak = (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; };

// a formatting command's edit says so, for the guard in dispatchTransaction
const formatting = (cmd) => (state, dispatch, v) => cmd(state, dispatch && ((tr) => dispatch(tr.setMeta('format', true))), v);
const COMMANDS = Object.fromEntries(Object.entries({
  ...Object.fromEntries(Object.entries(MARK_OF).map(([k, m]) => [k, toggleMark(m)])),
  list: toggleList(N.bullet_list), numbered: toggleList(N.ordered_list), quote: toggleQuote, divider,
}).map(([k, c]) => [k, formatting(c)]));

// ---- the view
const view = new EditorView(host, {
  state: EditorState.create({ schema }),
  attributes: { 'aria-label': 'Description', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' },
  /* EVERY EDIT IS CHECKED, not only the description as it opens (Codex's
     review of PR #52): the document is written and read back, and if it
     would not come back as shown, a formatting button's edit is refused and
     anything else (typing, pasting) is kept with a warning. markdoc-pm.mjs
     handles every case tools/check-description.mjs knows; this is for one
     it does not. */
  dispatchTransaction(tr) {
    const next = view.state.apply(tr);
    if (tr.docChanged && !roundTrips(next.doc)) {
      warned = true;
      if (tr.getMeta('format')) { tellNote('Not applied: Markdoc cannot keep that formatting there as it would show here. Try it on whole words.'); return; }
      tellNote('⚠ Part of the description would not save as it shows here. Undo (⌘Z), or look at it in Markdoc text before saving.');
    } else if (tr.docChanged && warned) { warned = false; tellNote(''); }
    view.updateState(next);
    if (tr.docChanged) { area.value = toMarkdoc(view.state.doc); area.dispatchEvent(new Event('input', { bubbles: true })); }
    paint();
  },
});
const plugins = [
  history(),
  keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, 'Mod-b': COMMANDS.bold, 'Mod-i': COMMANDS.italic, 'Mod-u': COMMANDS.underline,
           Enter: listEnter, 'Shift-Enter': lineBreak, 'Mod-k': () => { openLink(); return true; } }),
  keymap(baseKeymap),
];

// Which buttons are on where the cursor is: pressed, not just tinted (STYLE-GUIDE.md, selected states)
function paint() {
  const st = view.state, { from, to, empty, $from } = st.selection;
  const on = (m) => empty ? !!m.isInSet(st.storedMarks || $from.marks()) : st.doc.rangeHasMark(from, to, m);
  const l = listAround(st);
  const state = { ...Object.fromEntries(Object.entries(MARK_OF).map(([k, m]) => [k, on(m)])), link: on(M.link),
    list: l?.node.type === N.bullet_list, numbered: l?.node.type === N.ordered_list, quote: inQuote(st) };
  for (const b of document.querySelectorAll('#mdbar [data-md]')) {
    const k = b.dataset.md;
    if (!(k in state) || !api.active) { b.classList.remove('on'); b.removeAttribute('aria-pressed'); continue; }
    b.classList.toggle('on', !!state[k]); b.setAttribute('aria-pressed', String(!!state[k]));
  }
}

// ---- links: a field under the toolbar (the Mac app shows no prompt())
const linkRow = $('mdlink'), linkUrl = $('mdlinkurl');
function linkRange() {
  const st = view.state, { $from, from, to } = st.selection;
  if (from !== to) return { from, to };
  // the cursor inside a link: the whole link
  const m = M.link.isInSet($from.marks());
  if (!m) return null;
  let a = from, b = from;
  while (a > $from.start() && st.doc.rangeHasMark(a - 1, a, M.link)) a--;
  while (b < $from.end() && st.doc.rangeHasMark(b, b + 1, M.link)) b++;
  return { from: a, to: b };
}
function openLink() {
  const r = linkRange();
  if (!r) { tellNote('Select the words to link first.'); return; }
  let href = '';
  view.state.doc.nodesBetween(r.from, r.to, (n) => { const m = M.link.isInSet(n.marks); if (m) href = m.attrs.href; });
  linkRow.hidden = false; linkRow.dataset.from = r.from; linkRow.dataset.to = r.to;
  $('mdunlink').hidden = !href;
  linkUrl.value = href || 'https://'; linkUrl.focus(); linkUrl.select();
}
function closeLink() { linkRow.hidden = true; view.focus(); }
function setLink(href) {
  const from = +linkRow.dataset.from, to = +linkRow.dataset.to, tr = view.state.tr.removeMark(from, to, M.link).setMeta('format', true);
  if (href) tr.addMark(from, to, M.link.create({ href }));
  view.dispatch(tr); closeLink();
}
$('mdlinkgo').addEventListener('click', () => setLink(linkUrl.value.trim()));
$('mdunlink').addEventListener('click', () => setLink(''));
$('mdlinkno').addEventListener('click', closeLink);
linkUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setLink(linkUrl.value.trim()); } if (e.key === 'Escape') { e.preventDefault(); closeLink(); } });

function tellNote(s) { note.textContent = s; note.hidden = !s; }
function showMode(text) {
  host.hidden = text; area.hidden = !text; modeBtn.classList.toggle('on', text); modeBtn.setAttribute('aria-pressed', String(text));
  linkRow.hidden = true;
  paint();
}

/* What page.js calls. load() shows a description: formatted if the editor
   can hold all of it and Markdoc text was not chosen. */
const api = window.desc = {
  get active() { return !host.hidden; },
  load(src) {
    shown = String(src ?? '');
    tellNote(''); warned = false;
    if (wantText) { showMode(true); return; }
    let doc;
    try {
      doc = fromMarkdoc(shown);
      if (!roundTrips(doc)) throw new Unsupported('formatting the editor would write differently');
    } catch (e) {
      if (!(e instanceof Unsupported)) console.warn('description editor: ' + e.message);
      tellNote('Shown as Markdoc text: this description has ' + (e instanceof Unsupported ? e.message : 'something the editor could not read') + ', which the formatted editor cannot show. Nothing is lost.');
      showMode(true);
      return;
    }
    view.updateState(EditorState.create({ schema, doc, plugins }));
    showMode(false);
  },
  command(kind) {
    if (kind === 'link') { openLink(); return; }
    COMMANDS[kind]?.(view.state, view.dispatch, view);
    view.focus();
  },
  focus() { view.focus(); },
};
modeBtn.addEventListener('click', () => {
  wantText = api.active;
  remember('descText', wantText ? '1' : '0');
  if (wantText) showMode(true);
  else { api.load(area.value); if (api.active) view.focus(); }
});
view.dom.addEventListener('focus', paint);
// a toolbar click must not take the cursor out of the words it is formatting
$('mdbar').addEventListener('mousedown', (e) => { if (api.active && e.target.closest('[data-md]')) e.preventDefault(); });
api.load(area.value);
