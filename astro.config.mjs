// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import netlify from '@astrojs/netlify';
import keystatic from '@keystatic/astro';

/* THE EDITOR IS A SERVER APP; THE SITE IS NOT.

   Keystatic's GitHub backend needs a server route to exchange the OAuth code
   for a token — that is why `output: 'server'` and a Netlify adapter appear in
   a repository whose whole point is a static single file.

   This does NOT change what a visitor downloads. index.html is still built by
   build.js, still one file, still zero runtime dependencies. Astro builds only
   the /keystatic editor and its API route, and nothing it emits is referenced
   by the site.

   The two builds are kept separate on purpose: `node build.js` still runs on
   Node built-ins alone and still works with npm uninstalled. If this whole
   experiment is abandoned, deleting Astro leaves the site build untouched. */
export default defineConfig({
  output: 'server',
  adapter: netlify(),
  integrations: [react(), keystatic()],
  // build.js owns dist/; Astro writes alongside it rather than over it
  outDir: './dist',
  publicDir: './.astro-public',
  vite: { build: { emptyOutDir: false } },
});
