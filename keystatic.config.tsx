/* =========================================================================
   Keystatic configuration — SPIKE
   =========================================================================

   PURPOSE OF THIS FILE, RIGHT NOW: prove the editor can be served, logged
   into against a PRIVATE repository, and used on a phone. Nothing here has
   been used to write real content yet, and `build.js` does not read any of
   it. Decap remains the working CMS at /admin until this is judged.

   THE WHOLE REASON THIS EXISTS is the `mark()` calls further down. Decap's
   toolbar takes names from a fixed built-in list and cannot be extended, so
   underline, weight and size could only ever be typed as bracket tags. Here
   a custom mark REQUIRES an icon — the type will not compile without one —
   so a formatting control cannot exist without a button. That inversion is
   the entire argument for the migration.

   STORAGE: `format: { data: 'json', contentField: 'summary' }` keeps entry
   data as JSON, which `JSON.parse` still reads with no dependency, and puts
   only the rich text in a `.mdoc` file. So the build gains ONE parser for
   prose and keeps its dependency-free path for everything else.
   ========================================================================= */

import { config, fields, collection, singleton } from '@keystatic/core';
import { mark } from '@keystatic/core/content-components';

/* Icons are plain inline SVG rather than an icon package: one less import to
   break on upgrade, and these are drawn to match the site's own controls. */
const strokeIcon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    {d.split('|').map((seg, i) => <path key={i} d={seg} />)}
  </svg>
);

/* THE CUSTOM MARKS.
   `className` lands on a <span> in the output, and those class names are the
   ones index.html ALREADY styles (.w-l, .t-s, .t-l). So the editor emits the
   markup the site is already built to render — no new CSS, no mapping table. */
const components = {
  light: mark({
    label: 'Lighter',
    icon: strokeIcon('M6 18 L12 6 L18 18'),
    tag: 'span',
    className: 'w-l',
    schema: {},
  }),
  small: mark({
    label: 'Smaller',
    icon: strokeIcon('M9 17 L9 9 M6 9 L12 9|M14 17 L18 17'),
    tag: 'span',
    className: 't-s',
    schema: {},
  }),
  large: mark({
    label: 'Larger',
    icon: strokeIcon('M4 18 L10 6 L16 18 M6 14 L14 14'),
    tag: 'span',
    className: 't-l',
    schema: {},
  }),
  /* UNDERLINE IS A CUSTOM MARK HERE, not a built-in.
     `fields.document` has an `inlineMarks.underline` option; `fields.markdoc`
     does NOT — its option list is bold / italic / strikethrough / code and
     nothing else. Checked against MarkdocEditorOptions rather than assumed a
     second time. */
  underline: mark({
    label: 'Underline',
    icon: strokeIcon('M6 4 L6 11 A6 6 0 0 0 18 11 L18 4|M5 20 L19 20'),
    tag: 'u',
    schema: {},
  }),
};

/* THE TOOLBAR, STATED EXHAUSTIVELY.

   Every one of the thirteen settings is named, including the false ones.
   An earlier version listed three and assumed the rest defaulted off; they
   default ON. Silence is not a setting, so nothing here is left unsaid.

   HEADINGS ARE OFF, and are the only omission.
   Under Decap a heading was borrowed to mean "large text" because it was the
   only honest button available. That workaround is obsolete now `Larger` is a
   real mark. Headings would emit <h1>-<h6> that index.html does not style, and
   six levels of hierarchy the layout has no answer for. Paragraph goes with
   them: with no headings to switch back from, a block-type menu has one entry.

   EVERYTHING ELSE IS ON BY REQUEST — and each one is a promise the RENDERER
   has to keep. A button here writes markup; the build has to turn that markup
   into something the window can show. Until it does, these produce nothing on
   the site. What each still needs, in build.js and in CSS:

     strikethrough  <s>            a rule; trivial
     link           <a>            styling, and a decision about how a link
                                   behaves inside churning text
     bullet list    <ul><li>       list styling inside the window measure
     numbered list  <ol><li>       the same
     divider        <hr>           a rule; it is a CONTROL-weight line, so it
                                   must not churn
     quote          <blockquote>   indent and measure
     code block     <pre><code>    styling AND a monospace face — which this
                                   site deliberately no longer ships. It would
                                   fall back to the system mono, a fifth
                                   typeface on a page with one chosen one.

   Inline code and tables stay off: not asked for, and each carries the same
   renderer debt. Inline images stay off because imagery belongs to the
   `images` field, which the layout is built around.

   Clear Formatting needs no setting — it appears wherever marks exist. */
const editorOptions = {
  bold: true,
  italic: true,
  strikethrough: true,
  code: false,
  heading: false,
  blockquote: true,
  orderedList: true,
  unorderedList: true,
  table: false,
  link: true,
  image: false,
  divider: true,
  codeBlock: true,
} as const;

const description = (label: string) =>
  fields.markdoc({ label, components, options: editorOptions });

export default config({
  storage: {
    kind: 'github',
    repo: { owner: 'macielrobert', name: 'rmaciel-work' },
  },

  collections: {
    projects: collection({
      label: 'Projects',
      slugField: 'title',
      path: 'content/projects/*',
      format: { data: 'json', contentField: 'summary' },
      columns: ['title', 'section'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Title',
            description: 'Shown as the window header.',
          },
          slug: {
            label: 'URL slug',
            description:
              'Frozen permanent address. Set once and never change it — a sent link breaks if this changes, and renaming it is what deleted a project under the previous CMS.',
          },
        }),
        section: fields.select({
          label: 'Section',
          options: [
            { label: 'BUILD', value: 'build' },
            { label: 'DESIGN', value: 'design' },
            { label: 'ART', value: 'art' },
          ],
          defaultValue: 'build',
        }),
        order: fields.integer({
          label: 'Position in grid',
          defaultValue: 10,
          description: 'Low numbers first. Use 10, 20, 30 to leave gaps.',
        }),
        draft: fields.checkbox({
          label: 'Hold back (do not publish)',
          defaultValue: false,
        }),
        details: fields.array(
          fields.text({ label: 'Line' }),
          { label: 'Detail lines', itemLabel: (p) => p.value },
        ),
        summary: description('Description'),
        layout: fields.select({
          label: 'Layout',
          options: [
            { label: 'Standard', value: 'standard' },
            { label: 'Grid', value: 'grid' },
            { label: 'Text', value: 'text' },
          ],
          defaultValue: 'standard',
        }),
        expand: fields.checkbox({ label: 'Allow image expand', defaultValue: true }),
        icon_type: fields.select({
          label: 'Grid icon — kind',
          options: [
            { label: 'Typed character (glyph)', value: 'glyph' },
            { label: 'Uploaded mark', value: 'image' },
          ],
          defaultValue: 'glyph',
        }),
        icon_glyph: fields.text({ label: 'Grid icon — character' }),
        icon_image: fields.image({
          label: 'Grid icon — file',
          directory: 'images',
          publicPath: '/images/',
          description: 'Transparent PNG or SVG. Alpha is the shape.',
        }),
        wordmark: fields.image({
          label: 'Wordmark / hero mark',
          directory: 'images',
          publicPath: '/images/',
        }),
        images: fields.array(
          fields.object({
            src: fields.image({
              label: 'File',
              directory: 'images',
              publicPath: '/images/',
            }),
            alt: fields.text({ label: 'Alt text' }),
            caption: fields.text({ label: 'Caption' }),
          }),
          { label: 'Images', itemLabel: (p) => p.fields.alt.value || 'Image' },
        ),
        share_description: fields.text({
          label: 'Share description',
          multiline: true,
          description: 'Plain text. Used in link previews and search results.',
        }),
      },
    }),
  },

  singletons: {
    about: singleton({
      label: 'ABOUT',
      path: 'content/about',
      format: { data: 'json', contentField: 'summary' },
      schema: {
        title: fields.text({ label: 'Title', defaultValue: 'ABOUT' }),
        details: fields.array(
          fields.text({ label: 'Line' }),
          { label: 'Detail lines', itemLabel: (p) => p.value },
        ),
        summary: description('Description'),
      },
    }),
    contact: singleton({
      label: 'CONTACT',
      path: 'content/contact',
      format: { data: 'json' },
      schema: {
        email: fields.text({ label: 'Email address' }),
        intro: fields.text({ label: 'Intro copy', multiline: true }),
      },
    }),
    site: singleton({
      label: 'Site settings',
      path: 'content/site',
      format: { data: 'json' },
      schema: {
        site_title: fields.text({ label: 'Browser tab title' }),
        description: fields.text({ label: 'Site description', multiline: true }),
        share_image: fields.image({
          label: 'Default share image',
          directory: 'images',
          publicPath: '/images/',
        }),
        copyright: fields.text({ label: 'Copyright line' }),
      },
    }),
  },
});
