#!/usr/bin/env node
/* CHECK DESCRIPTION — Harvest's formatted description editor against the
   site's own renderer (UX-5):

     node tools/check-description.mjs

   The editor reads a description's Markdoc into a document and writes the
   document back (tools/harvest/markdoc-pm.mjs). What it writes must render
   on the site exactly as what it read, and read back as the same document —
   otherwise saving a description Robert only glanced at would change it.
   Checked on every description in content/ and on fixtures holding every
   toolbar mark, list, quote, divider, both kinds of line break, and the
   punctuation Markdown would otherwise take as formatting. The renderer is
   build.js's renderMarkdoc itself, not a copy. tools/check-harvest.js runs
   this too. */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { schema, fromMarkdoc, toMarkdoc, roundTrips, Unsupported } from './harvest/markdoc-pm.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderMarkdoc } = createRequire(import.meta.url)(path.join(ROOT, 'build.js'));
const fails = [];
let n = 0, text = 0;

function check(src, label) {
  n++;
  let doc;
  try { doc = fromMarkdoc(src); }
  catch (e) { if (e instanceof Unsupported) { text++; console.log(`text ${label}: opens as Markdoc text — ${e.message}`); return; } throw e; }
  const out = toMarkdoc(doc);
  if (!roundTrips(doc)) fails.push(`${label}: written back, it reads as a different document\n${out}`);
  if (src.trim() && shape(renderMarkdoc(out, label)) !== shape(renderMarkdoc(src, label)))
    fails.push(`${label}: written back, it renders differently\n  was ${renderMarkdoc(src, label)}\n  now ${renderMarkdoc(out, label)}`);
  try { if (toMarkdoc(fromMarkdoc(out)) !== out) fails.push(`${label}: a second save changes it again\n${out}`); }
  catch (e) { fails.push(`${label}: written back, it no longer opens formatted — ${e.message}\n${out}`); }
}

// The rendering with the NESTING ORDER of inline marks taken out: bold around
// a link and a link around bold look the same, and the editor holds marks as
// a set. Every word is listed with the marks over it; blocks stay as they are.
const INLINE = new Set(['strong', 'em', 's', 'u', 'a', 'span']);
function shape(html) {
  const out = [], open = [];
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) out.push(JSON.stringify(text) + '[' + [...open].sort().join(' ') + ']');
    else if (!INLINE.has(tag)) out.push('<' + close + tag + '>');
    else if (close) open.splice(open.lastIndexOf(open.findLast(x => x.startsWith(tag))), 1);
    else open.push(tag + attrs);
  }
  return out.join('');
}

const bodyOf = (f) => { const t = fs.readFileSync(f, 'utf8'); const end = t.indexOf('\n---', 3); return t.slice(t.indexOf('\n', end + 1) + 1); };
const dir = path.join(ROOT, 'content', 'projects');
for (const f of [...fs.readdirSync(dir).filter(f => f.endsWith('.mdoc')).map(f => path.join(dir, f)), path.join(ROOT, 'content', 'about.mdoc')])
  check(bodyOf(f), path.relative(ROOT, f));

check([
  'Plain, **bold**, *italic*, ~~struck~~, {% underline %}under{% /underline %}, {% light %}light{% /light %},',
  '{% small %}smaller{% /small %} and {% large %}larger{% /large %}, [a link](https://example.com) and **[bold link](https://example.com)**.',
  'A line of its own',
  'and a hard one\\',
  'after it.',
  '',
  '- one',
  '- two **bold**',
  '  - nested',
  '',
  '1. first',
  '1. second',
  '',
  '> A quote',
  '> on two lines',
  '',
  '---',
  '',
  'Escaped: \\* \\_ \\[x\\](y) \\{% light %\\} \\~\\~ \\` \\| \\\\ \\&amp; and \\- \\# \\> at a line start',
  '\\- dash',
  '3\\. not a list',
].join('\n'), 'fixture: every mark');

// What only the editor can make: whitespace at a mark's edge, and Markdown's
// punctuation typed as words — Markdoc source cannot hold either as such
const t = (s, ...m) => schema.text(s, m.map(k => schema.marks[k].create()));
const made = schema.node('doc', null, [
  schema.node('paragraph', null, [t('a '), t(' bold with spaces ', 'strong'), t('and '), t('*stars* _under_ {% light %} [x](y) <b> 1. ', 'em'), t('end')]),
  schema.node('paragraph', null, [t('- not a list'), schema.nodes.hard_break.create(), t('# not a heading'), schema.nodes.hard_break.create({ kind: 'hard' }), t('2) nor this')]),
  schema.node('paragraph', null, [t('x'), t('   ', 'strong'), t('only spaces were bold')]),
]);
const madeOut = toMarkdoc(made);
let back = schema.node('doc', null, [schema.node('paragraph')]);
try { back = fromMarkdoc(madeOut); } catch (e) { fails.push('fixture: typed punctuation: no longer opens formatted — ' + e.message); }
n++;
if (back.textContent !== made.textContent) fails.push(`fixture: typed punctuation: the words changed\n  typed ${made.textContent}\n  read  ${back.textContent}\n${madeOut}`);
if (!roundTrips(back)) fails.push(`fixture: typed punctuation: does not read back as itself\n${madeOut}`);

console.log(fails.length ? 'FAIL description editor:\n  ' + fails.join('\n  ')
  : `ok   description editor round-trips ${n} descriptions and fixtures${text ? ` (${text} open as Markdoc text)` : ''}`);
process.exit(fails.length ? 1 : 0);
