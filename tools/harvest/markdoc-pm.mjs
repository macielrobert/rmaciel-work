/* THE DESCRIPTION AS A DOCUMENT (UX-5): the Markdoc Keystatic writes, read
   into the editor Harvest shows, and written back. Two directions, one file,
   so the browser and tools/check-description.mjs test the same code.

   WHY PROSEMIRROR: it is the editor Keystatic itself is built on, so it is
   already installed with Keystatic (no new package) and the two editors
   agree on what a description IS — paragraphs, lists, quotes, dividers and
   marks over text, not characters typed around words. Served to the page
   from node_modules by harvest.js; nothing here reaches the site.
   Rejected: a hand-rolled contenteditable. Browsers write different markup
   for the same keystroke (div or p, b or strong, pasted styles), undo breaks
   the moment a script wraps a selection, and every one of those becomes a
   serializer bug that writes something Robert did not see.

   WRITTEN THE WAY KEYSTATIC WRITES: the document becomes a Markdoc tree and
   Markdoc's own format() prints it — what Keystatic's serializer does — so a
   file saved here and one saved there read the same. Two things Keystatic
   does not do, and both are about not changing Robert's words: text is
   escaped (format() prints "*" and "{%" as typed, which the next parse would
   turn into formatting), and whitespace at the edge of bold, italic or
   strikethrough is moved outside it, where Markdown needs it.

   ANYTHING IT CANNOT SHOW, IT REFUSES rather than drops: a node, tag or
   attribute not listed here throws `Unsupported`, and the page edits that
   description as Markdoc text instead. The vocabulary is the toolbar's —
   build.js (markdocTags) and keystatic.config.tsx own it; a mark added there
   is added here, or descriptions using it open as text. */

import { Schema } from 'prosemirror-model';
import Markdoc from '@markdoc/markdoc';

const { Ast } = Markdoc;

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    blockquote: { group: 'block', content: '(paragraph | list)+', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    divider: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    bullet_list: { group: 'block list', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: { group: 'block list', content: 'list_item+', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
    list_item: { content: 'paragraph list*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    text: { group: 'inline' },
    // a line typed as a line (build.js renders both kinds as <br>). `kind`
    // keeps which one the file had, so an untouched line is written back as it was
    hard_break: { group: 'inline', inline: true, selectable: false, attrs: { kind: { default: 'soft' } },
                  parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  },
  // Rank is nesting: an earlier mark is written outside a later one
  marks: {
    link: { attrs: { href: {}, title: { default: null } }, inclusive: false,
            parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: d.getAttribute('href'), title: d.getAttribute('title') }) }],
            toDOM: (m) => ['a', { href: m.attrs.href, title: m.attrs.title }, 0] },
    light: { parseDOM: [{ tag: 'span.w-l' }], toDOM: () => ['span', { class: 'w-l' }, 0] },
    // one size at a time: Smaller over Larger replaces it
    small: { excludes: 'small large', parseDOM: [{ tag: 'span.t-s' }], toDOM: () => ['span', { class: 't-s' }, 0] },
    large: { excludes: 'small large', parseDOM: [{ tag: 'span.t-l' }], toDOM: () => ['span', { class: 't-l' }, 0] },
    underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
  },
});

export class Unsupported extends Error {}
const TAG_MARKS = ['light', 'small', 'large', 'underline'];
const NODE_MARKS = { strong: 'strong', em: 'em', s: 'strike', link: 'link' };

/* ---- Markdoc -> editor */
export function fromMarkdoc(src) {
  const ast = Markdoc.parse(String(src || ''));
  const kids = blocks(ast.children);
  const doc = schema.node('doc', null, kids.length ? kids : [schema.node('paragraph')]);
  try { doc.check(); } catch (e) { throw new Unsupported('an arrangement the editor cannot hold (' + e.message + ')'); }
  return doc;
}
const blocks = (nodes) => nodes.map(block);
function block(n) {
  if (n.type === 'paragraph') return schema.node('paragraph', null, inline(n.children, []));
  if (n.type === 'blockquote') return schema.node('blockquote', null, blocks(n.children));
  if (n.type === 'hr') return schema.node('divider');
  if (n.type === 'list') {
    // Markdoc writes every number as "1."; a list that starts elsewhere would be renumbered
    if (n.attributes.ordered && n.attributes.start != null && n.attributes.start !== 1) throw new Unsupported('a numbered list that does not start at 1');
    return schema.node(n.attributes.ordered ? 'ordered_list' : 'bullet_list', null, n.children.map(item));
  }
  throw new Unsupported(n.type === 'tag' ? `{% ${n.tag} %} around whole paragraphs` : what(n));
}
function item(n) {
  if (n.type !== 'item') throw new Unsupported(what(n));
  // a tight item holds its words directly, a loose one in paragraphs: both are paragraphs here
  return schema.node('list_item', null, n.children.map(c => c.type === 'inline' ? schema.node('paragraph', null, inline([c], [])) : block(c)));
}
function inline(nodes, marks) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'inline') out.push(...inline(n.children, marks));
    else if (n.type === 'text') { if (n.attributes.content) out.push(schema.text(String(n.attributes.content), marks)); }
    else if (n.type === 'softbreak' || n.type === 'hardbreak') out.push(schema.nodes.hard_break.create({ kind: n.type === 'softbreak' ? 'soft' : 'hard' }, null, marks));
    else if (NODE_MARKS[n.type] || (n.type === 'tag' && TAG_MARKS.includes(n.tag))) {
      if (n.type === 'tag' && Object.keys(n.attributes).length) throw new Unsupported(`{% ${n.tag} %} with settings`);
      const type = schema.marks[NODE_MARKS[n.type] || n.tag];
      const mark = n.type === 'link' ? type.create({ href: n.attributes.href, title: n.attributes.title || null }) : type.create();
      const next = mark.addToSet(marks);
      // Smaller inside Larger, or bold inside bold: the editor holds one of each
      if (next.length !== marks.length + 1) throw new Unsupported('formatting inside the same formatting');
      out.push(...inline(n.children, next));
    } else throw new Unsupported(what(n));
  }
  return out;
}
// in the note the page shows: what the description has that the editor does not
const NAMES = { code: 'inline code (backticks)', fence: 'a code block', heading: 'a heading', image: 'a picture', table: 'a table', error: 'Markdoc it cannot read' };
const what = (n) => n.type === 'tag' ? `{% ${n.tag} %}` : NAMES[n.type] || 'a ' + n.type;

/* ---- editor -> Markdoc */
export function toMarkdoc(doc) {
  const kids = [];
  doc.forEach(b => { const n = out(b); if (n) kids.push(n); });
  return Markdoc.format(new Ast.Node('document', {}, kids)).replace(/\n+$/, '') + (kids.length ? '\n' : '');
}
function out(b) {
  const T = b.type.name;
  if (T === 'paragraph') return b.content.size ? new Ast.Node('paragraph', {}, [new Ast.Node('inline', {}, runs(b))]) : null;
  if (T === 'divider') return new Ast.Node('hr');
  const kids = [];
  b.forEach(c => { const n = T.endsWith('_list') ? li(c) : out(c); if (n) kids.push(n); });
  if (!kids.length) return null;
  if (T === 'blockquote') return new Ast.Node('blockquote', {}, kids);
  return new Ast.Node('list', { ordered: T === 'ordered_list', marker: T === 'ordered_list' ? '.' : '-' }, kids);
}
// as Keystatic: one paragraph (and lists under it) is a tight item, its words
// directly in the item; more than one keeps the paragraphs
function li(c) {
  const paras = []; c.forEach(x => { if (x.type.name === 'paragraph') paras.push(x); });
  if (paras.length > 1) { const k = []; c.forEach(x => { const n = out(x); if (n) k.push(n); }); return new Ast.Node('item', {}, k); }
  const k = [];
  c.forEach(x => { if (x.type.name === 'paragraph') { if (x.content.size) k.push(new Ast.Node('inline', {}, runs(x))); } else { const n = out(x); if (n) k.push(n); } });
  return new Ast.Node('item', {}, k);
}
// The marks over a paragraph's text, as nested Markdoc nodes: the run of
// marks still open is kept, closed where a mark ends, opened where one starts.
function runs(para) {
  const root = { children: [] }, stack = [{ mark: null, node: root }];
  let lineStart = true;
  para.forEach(n => {
    const marks = n.marks;
    let keep = 1;
    while (keep < stack.length && keep - 1 < marks.length && stack[keep].mark.eq(marks[keep - 1])) keep++;
    stack.length = keep;
    for (let i = keep - 1; i < marks.length; i++) {
      const m = marks[i], node = wrapper(m);
      stack[stack.length - 1].node.children.push(node);
      stack.push({ mark: m, node });
      lineStart = false;
    }
    const into = stack[stack.length - 1].node.children;
    if (n.isText) { into.push(new Ast.Node('text', { content: escape(n.text, lineStart, ['strong', 'em', 'strike'].includes(stack[stack.length - 1].mark?.type.name)) })); lineStart = false; }
    else if (n.type.name === 'hard_break') { into.push(new Ast.Node(n.attrs.kind === 'hard' ? 'hardbreak' : 'softbreak')); lineStart = true; }
  });
  return expel(root.children);
}
function wrapper(m) {
  const T = m.type.name;
  if (T === 'link') return new Ast.Node('link', m.attrs.title ? { href: m.attrs.href, title: m.attrs.title } : { href: m.attrs.href }, []);
  if (T === 'strong' || T === 'em') return new Ast.Node(T, {}, []);
  if (T === 'strike') return new Ast.Node('s', {}, []);
  const t = new Ast.Node('tag', {}, [], T);
  t.inline = true;
  return t;
}
// Markdown reads "** word**" as two asterisks, not bold: whitespace at the edge
// of bold, italic and strikethrough goes outside it (as Keystatic does)
function expel(children) {
  const res = [];
  for (const c of children) {
    if (c.children.length) c.children = expel(c.children);
    if (!['strong', 'em', 's'].includes(c.type)) { res.push(c); continue; }
    const first = c.children[0], last = c.children[c.children.length - 1];
    let lead = '', trail = '';
    if (first?.type === 'text') { lead = /^\s*/.exec(first.attributes.content)[0]; first.attributes.content = first.attributes.content.slice(lead.length); }
    if (last?.type === 'text') { trail = /\s*$/.exec(last.attributes.content)[0]; last.attributes.content = last.attributes.content.slice(0, last.attributes.content.length - trail.length); }
    c.children = c.children.filter(x => x.type !== 'text' || x.attributes.content);
    if (lead) res.push(new Ast.Node('text', { content: lead }));
    if (c.children.length) res.push(c);
    if (trail) res.push(new Ast.Node('text', { content: trail }));
  }
  return res;
}
// Text stays text: Markdown's punctuation is escaped, and at the start of a
// line what would begin a list or a divider is too. Not what format() escapes
// itself — * _ ~ directly inside bold, italic and strikethrough; a leading * or
// >, and "# ", anywhere else — or the backslash would be doubled and shown.
export function escape(t, lineStart, wrapped) {
  t = t.replace(wrapped ? /[\\`{}[\]<>|]/g : /[\\`*_{}[\]<>|~]/g, '\\$&').replace(/&(?=#?\w+;)/g, '\\&');
  return lineStart ? t.replace(/^([+=-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2') : t;
}

/* The document the editor would save, read back: if it is not the document
   the editor holds, saving would change what Robert sees. Asked of every
   description before it is shown formatted (editor.mjs). */
export function roundTrips(doc) {
  try { return fromMarkdoc(toMarkdoc(doc)).eq(doc); } catch { return false; }
}
