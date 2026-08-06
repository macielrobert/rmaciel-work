// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import netlify from '@astrojs/netlify';
import keystatic from '@keystatic/astro';

/* ONE STYLESHEET, ADDED TO THE EDITOR AND NOWHERE ELSE.

   Keystatic's page comes from inside the package — `/keystatic/[...params]`
   is injected by its own integration, not written here — so there is no file
   of ours to drop a <link> into. This adds one.

   TWO SIMPLER-LOOKING ROUTES WERE TRIED AND REJECTED, both read out of
   Astro's source rather than guessed at:

     Writing src/pages/keystatic/[...params].astro to shadow theirs. Astro 7
     keeps BOTH routes and sorts the list by URL shape alone, with no tiebreak
     on where a route came from — two routes with one pattern have no defined
     winner (core/routing/create-manifest.js).

     `injectScript('page', "import './x.css'")`. It builds green and ships
     NOTHING: a page-stage script becomes a bare <script src>, while the page's
     stylesheets are collected from the page component's imports, which that
     script is not part of (core/build/pipeline.js, headElements). The CSS was
     silently dropped — caught only by grepping the built output for it.

   So the CSS is read here at build time and handed to the `head-inline`
   stage, which Astro writes verbatim into every page's <head> and — unlike
   the page stage — carries through into the server manifest this site's SSR
   actually renders from (core/app/pipeline.js). A missing file throws during
   config, before a broken editor can deploy.

   The four lines of script are only there because Astro has a hook for
   injecting a SCRIPT and none for injecting a STYLE. The CSS itself stays in
   a real .css file, where it can be read and edited as CSS.

   `<` guards the one hazard of putting text inside a <script>: any
   literal `</` would end the tag early. Nothing in the file has one today;
   this makes sure a future edit cannot introduce one.

   "Every page" here means the editor and nothing else. Astro does not build
   the site — index.html comes from build.js and never sees this. */
const keystaticMobileFix = {
  name: 'keystatic-mobile-fix',
  hooks: {
    'astro:config:setup': ({ injectScript }) => {
      const css = readFileSync(
        new URL('./src/keystatic-mobile.css', import.meta.url),
        'utf8',
      );
      injectScript(
        'head-inline',
        `var s=document.createElement('style');` +
          `s.textContent=${JSON.stringify(css).replace(/</g, '\\u003c')};` +
          `document.head.appendChild(s);`,
      );
    },
  },
};

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
  integrations: [react(), keystatic(), keystaticMobileFix],
  // build.js owns dist/; Astro writes alongside it rather than over it
  outDir: './dist',
  publicDir: './.astro-public',
  vite: { build: { emptyOutDir: false } },
});
