#!/usr/bin/env node
/* CHECK HARVEST — run once before pushing a change to Harvest:

     node tools/check-harvest.js

   Once, not after every edit: Robert keeps Harvest open while it is worked
   on, and a check that restarts things after each edit is downtime for him.
   This one never touches his Harvest. It starts its own copy with a
   throwaway home folder (so its own empty memory) on a port of its own,
   asks it for the page and its state, and stops that copy by its own process
   id — never by name, which would also stop his.

   What it catches, each one a mistake that has actually been made:
     • a syntax error in the server or in the page's script;
     • an unbalanced brace in the page's CSS, which silently drops every rule
       after it;
     • the page's script asking for an element id the page does not have
       ($('x') is null, and the first click on it throws);
     • a server that starts but cannot serve the page, its state or the
       event stream the page listens to. */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const TOOLS = __dirname, PAGE = path.join(TOOLS, 'harvest');
const fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

for (const f of [path.join(TOOLS, 'harvest.js'), path.join(PAGE, 'page.js')]) {
  let ok = true;
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { ok = false; console.log(String(e.stderr)); }
  check(ok, 'syntax: ' + path.relative(TOOLS, f));
}

// comments first: a brace inside one is not a rule
const css = fs.readFileSync(path.join(PAGE, 'page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let depth = 0, bad = false;
for (const c of css) { if (c === '{') depth++; if (c === '}' && --depth < 0) bad = true; }
check(!bad && depth === 0, 'css braces balance');

// the colours and sizes page.css copies from the site (STYLE-GUIDE.md)
let same = true;
try { execFileSync(process.execPath, [path.join(TOOLS, 'check-tokens.js')], { stdio: 'pipe' }); }
catch (e) { same = false; console.log(String(e.stdout)); }
check(same, 'design values match the site');

const html = fs.readFileSync(path.join(PAGE, 'page.html'), 'utf8');
const js = fs.readFileSync(path.join(PAGE, 'page.js'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const missing = [...new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))].filter(i => !ids.has(i));
check(!missing.length, 'every $(id) the script uses is in the page' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));

// a scratch copy of the server, as the testing rules require
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-check-'));
const child = spawn(process.execPath, [path.join(TOOLS, 'harvest.js')], { env: { ...process.env, HOME: home, HARVEST_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { out += d; });
const done = (code) => { child.kill('SIGINT'); setTimeout(() => { fs.rmSync(home, { recursive: true, force: true }); console.log(fails.length ? `\n${fails.length} problem(s).` : '\nAll good.'); process.exit(code); }, 500); };
const giveUp = setTimeout(() => { check(false, 'server started (no answer in 30 s)\n' + out); done(1); }, 30000);
child.on('exit', (c) => { if (!out.includes('open at')) { clearTimeout(giveUp); check(false, 'server started — it exited with ' + c + '\n' + out); done(1); } });
const wait = setInterval(async () => {
  const m = out.match(/open at (http:\/\/127\.0\.0\.1:\d+)\//);
  if (!m) return;
  clearInterval(wait); clearTimeout(giveUp);
  check(true, 'server started');
  for (const p of ['/', '/page.css', '/page.js', '/api/state']) {
    let ok = false;
    try { const r = await fetch(m[1] + p); ok = r.ok && (await r.text()).length > 0; } catch {}
    check(ok, 'serves ' + p);
  }
  // the event stream never ends: read its first message and let go
  let first = '';
  try {
    const r = await fetch(m[1] + '/api/events');
    first = new TextDecoder().decode((await r.body.getReader().read()).value || new Uint8Array());
  } catch {}
  check(first.startsWith('data: {'), 'event stream sends the state');
  done(fails.length ? 1 : 0);
}, 200);
