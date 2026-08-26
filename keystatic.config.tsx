/* =========================================================================
   Keystatic configuration — THE CMS. Live at /keystatic.
   =========================================================================

   THE WHOLE REASON THIS EXISTS is the `mark()` calls further down. Decap's
   toolbar took names from a fixed built-in list and could not be extended, so
   underline, weight and size could only ever be TYPED as bracket tags — a tax
   that grows with the archive. Here a custom mark REQUIRES an icon: the type
   will not compile without one, so a formatting control cannot exist without a
   button. That inversion is the entire argument for the migration, and it is
   the only reason the cost below was worth paying.

   STORAGE: `format: { data: 'json', contentField: 'summary' }` writes one
   `content/projects/<slug>.mdoc` per project — JSON frontmatter between `---`
   fences, then the rich text as Markdoc. Entry data stays JSON, which
   `JSON.parse` reads with no dependency; only prose needs the parser.

   THIS FILE AND TWO OTHERS ARE ONE DECISION. A button here writes markup;
   `build.js` must map it; `index.html` must style it. A button with no
   renderer entry produces NOTHING, silently. None of the three may grow alone.
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
   markup the site is already built to render — no new CSS, no mapping table.

   `style` exists only so the EDITOR shows the effect while typing. `className`
   is what the site keys off, but the editor has no access to index.html's
   stylesheet, so without an inline style a size or weight mark applied in the
   description field looked like nothing had happened. The two must be kept in
   step by hand — the values below mirror the CSS, and changing one means
   changing the other. */
const components = {
  light: mark({
    label: 'Lighter',
    icon: strokeIcon('M6 18 L12 6 L18 18'),
    tag: 'span',
    className: 'w-l',
    style: { fontWeight: '300' },
    schema: {},
  }),
  small: mark({
    label: 'Smaller',
    icon: strokeIcon('M9 17 L9 9 M6 9 L12 9|M14 17 L18 17'),
    tag: 'span',
    className: 't-s',
    style: { fontSize: '0.85em' },
    schema: {},
  }),
  large: mark({
    label: 'Larger',
    icon: strokeIcon('M4 18 L10 6 L16 18 M6 14 L14 14'),
    tag: 'span',
    className: 't-l',
    style: { fontSize: '1.27em' },
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
   Code blocks were enabled briefly and removed: they need a monospace face,
   which this site deliberately stopped shipping, so they would fall back to
   the system mono — a fifth typeface on a page with one chosen one.

   Inline code, code blocks and tables stay off: not asked for, and each carries the same
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
  codeBlock: false,
} as const;

const description = (label: string) =>
  fields.markdoc({ label, components, options: editorOptions });

export default config({
  /* REVIEW BEFORE PUBLISH — and it is NOT configured here.

     Decap had `publish_mode: editorial_workflow`, so every save opened a pull
     request with its own deploy preview. Keystatic has no equivalent setting:
     left alone it commits straight to the default branch.

     The equivalent lives on GITHUB, not in this file. With a branch protection
     rule requiring pull requests on `main`, Keystatic receives
     BRANCH_PROTECTION_RULE_VIOLATION on save and answers it with:

       "Changes must be made via pull request to this branch.
        Create a new branch to save changes."   [Create branch and save]

     — which is the Decap loop back, driven by the repository rather than by a
     CMS flag. Read out of Keystatic's own UI source, not assumed.

     So the protection rule is load-bearing. Remove it and the editor silently
     resumes writing to production content with no review step, and nothing in
     this file will say so. See NOTES-KEYSTATIC-SETUP.md.

     `branchPrefix` only prefills the new-branch name — it does not hide
     branches — and mirrors the `cms/` names Decap used, so the branches an
     editor creates stay distinguishable from the ones code work creates. */
  storage: {
    kind: 'github',
    repo: { owner: 'macielrobert', name: 'rmaciel-work' },
    branchPrefix: 'cms/',
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
        /* SUB-PROJECTS: TWO OR MORE WORKS BEHIND ONE ICON.

           Every icon in the grid is a different mark, most of them client
           logos, and that stays true — so a second project for a client the
           row already shows cannot have an icon of its own. It points at the
           first one instead and shares it. Inside the window a row of work
           titles picks between them.

           A RELATIONSHIP FIELD, NOT A TYPED KEY. A text field naming the
           group would split a client in two the first time a character was
           typed differently, and nothing would say so — the row would just
           show one work. This is a picker over projects that already exist,
           so there is no spelling to get wrong.

           ONE LEVEL ONLY. The project picked here must not itself be a
           sub-project; build.js fails the build rather than following a
           chain, because a client inside a client has no rendering.

           Sub-projects still need an icon file — the form requires one — and
           it is simply unused. Said here because a required field that does
           nothing is otherwise a mystery. */
        part_of: fields.relationship({
          label: 'Sub-project of',
          collection: 'projects',
          description:
            'Leave empty for a normal project. Set it to share another project\u2019s grid icon \u2014 both then live behind that one icon, picked between inside the window. Must be in the same section, and that project must not itself be a sub-project.',
        }),
        /* The heading over the row of works. Only read on the project that
           OWNS the icon; a sub-project's own value is ignored, because the
           heading names the client and the client is the icon. Blank leaves
           the window headed by the project's own title, exactly as now. */
        client: fields.text({
          label: 'Client name',
          description:
            'Only used when this project has sub-projects. Shown as the window heading above them \u2014 usually the client the icon belongs to. Leave blank otherwise.',
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
