#!/usr/bin/env node
/* CHECK TOKENS — the site and Harvest share their design values by COPY,
   and this is what keeps the copies honest:

     node tools/check-tokens.js

   index.html is the source (STYLE-GUIDE.md, "Where the values live"). Harvest's
   page.css repeats the custom properties it needs under the same names, and
   keystatic.config.tsx repeats the two custom-mark sizes. Copying was chosen
   over sharing a file because sharing costs the site a second request or a
   build step that rewrites its CSS; the price of copying is drift, and this
   check is that price paid.

   A name declared in both files must have the same set of values in both —
   a set, because a theme value is written once per theme (--bg is #000 in one
   rule and #fff in another). A name in only one file is that file's own
   business (Harvest's column widths, the site's fade lengths). Exits 1 on any
   difference, naming it. tools/check-harvest.js runs it too. */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// one spelling per value: no spaces, no leading zero, lower case
const norm = v => v.trim().replace(/\s+/g, '').replace(/(^|[^\d.])0\./g, '$1.').toLowerCase();

const props = css => {
  const out = new Map();
  for (const [, name, val] of bare(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(norm(val));
  }
  return out;
};

const html = read('index.html');
const site = props(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
const harvest = props(read('tools/harvest/page.css'));

const fails = [];
let shared = 0;
for (const [name, vals] of harvest) {
  if (!site.has(name)) continue;
  shared++;
  const a = [...site.get(name)].sort().join(' | '), b = [...vals].sort().join(' | ');
  if (a !== b) fails.push(`${name}: index.html has ${a}, page.css has ${b}`);
}

// the custom marks' sizes, wherever a copy of them lives
const markSize = (src, cls) => (bare(src).match(new RegExp('\\.' + cls + '\\s*\\{[^}]*font-size:\\s*([\\d.]+em)')) || [])[1];
const ks = read('keystatic.config.tsx');
for (const cls of ['t-s', 't-l']) {
  const want = markSize(html, cls);
  const label = cls === 't-s' ? 'Smaller' : 'Larger';
  const copies = {
    // Keystatic writes the size as a style object beside the mark's class
    'keystatic.config.tsx': (ks.match(new RegExp("className:\\s*'" + cls + "',\\s*style:\\s*\\{\\s*fontSize:\\s*'([\\d.]+em)'")) || [])[1],
  };
  for (const [file, got] of Object.entries(copies))
    if (norm(got || '') !== norm(want || '')) fails.push(`.${cls} (${label}): index.html has ${want}, ${file} has ${got || 'nothing'}`);
}

if (!shared) fails.push('no custom property is shared — has page.css stopped copying the site\'s values?');
console.log(fails.length ? 'FAIL design values differ:\n  ' + fails.join('\n  ')
                         : `ok   design values match (${shared} shared names, 2 mark sizes)`);
process.exit(fails.length ? 1 : 0);
