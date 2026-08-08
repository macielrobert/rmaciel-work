# How this site works

Written for the person who owns it, not for a programmer. One page.

---

## The four parts

Each does exactly one job. Nothing else.

| Part | What it is |
|---|---|
| **GitHub** | The filing cabinet. Every version of every file, kept forever. Nothing there is running. |
| **Netlify** | The printer. Watches the cabinet, and whenever a file changes it rebuilds the site and puts it on the web. |
| **`build.js`** | The assembler. Your words live in `content/` as small data files; the site lives in `index.html` with a hole in it. This pours the first into the second. |
| **The CMS** (at `/keystatic`) | The form you type into, so you never open a data file by hand. |

You do not upload anything, ever. You change words in the CMS and the rest happens on its own.

---

## To change something

1. Go to your site's address with **`/keystatic`** on the end. Log in with GitHub.
2. Edit what you want. **Projects** are the work; **Singletons** are ABOUT, CONTACT and the site settings.
3. Press **Save**.

**Saving publishes, right now.** This is the one thing that changed with the new editor and it is worth knowing: there is no review step in front of it. The old editor parked every change in a pull request first; this one writes straight to the live content.

To get a review step back, click the branch name at the top of the editor and **create a branch** before you start editing. Your saves go there instead, and you can look at them on that branch's preview before merging. It is one extra click at the start of a session, and it is the difference between "seen it" and "hoped".

---

## To add a project

Same as above, but press **New Project**. Three fields decide where it lands:

- **Section** — BUILD, DESIGN, or ART.
- **Position in grid** — low numbers come first. They go 10, 20, 30 so you can slot something in between later without renumbering everything.
- **URL slug** — the permanent web address for that project, like `vessel-series`. **Set it once and never change it.** A link you've already sent to someone breaks if you do. Renaming the title is safe; changing the slug is not.

**Hold back** keeps a project written but off the live site.

---

## When something goes red

A red ✕ on GitHub means Netlify tried to rebuild and stopped. The site that's already live is untouched — a failed build never replaces a working one.

The build stops on purpose rather than publishing something broken, and it always names the file at fault:

| What you'll see | What it means |
|---|---|
| `required field "details" is missing or empty` | A project is missing something it needs. |
| `image "…" is referenced but does not exist` | An image was deleted but a project still points at it. |
| `cannot measure "…"` | An image in a project's image list is the wrong format. Those must be **PNG or JPEG**. |
| `the frontmatter is not valid JSON` | A project file got damaged — usually from editing it by hand instead of through the CMS. |
| `needs the @markdoc/markdoc package` | Someone ran the build without installing first. |

To read the actual message: open the failed deploy in Netlify and look for the line beginning `BUILD FAILED`.

Warnings are different from failures. `section "art" has no published projects` is a warning — the build finishes and the site publishes.

---

## Things not to do

- **Don't edit `index.html` by hand to change words.** The CMS is the source of truth, and the next build will overwrite whatever you typed.
- **Don't rename a project's URL slug once it's set.** It renames the file, which is the permanent address. A link you have already sent breaks.
- **Don't open `index.html` from the filing cabinet expecting to see the site.** It has a deliberate hole in it where the content goes. To see the real thing, use a preview link.
- **Don't touch anything to do with DNS, nameservers, MX or TXT records.** Your email runs on those. `TO-DO.md` opens with four standing rules about this — read them before changing any domain setting anywhere.

---

## Words you'll see

- **Commit** — a saved version, with a note about what changed.
- **Branch** — a parallel copy, so work in progress never touches what's live.
- **Pull request** — a proposal to fold a branch back into the real site.
- **Deploy preview** — a private copy of the site built from a pull request, at its own address.
- **Merge** — accepting a pull request. This is the moment a change becomes real.
- **`main`** — the branch that *is* the live site.

---

## Where the other documents fit

- **`TO-DO.md`** — the master to-do list, including the domain move. Start here when deciding what's next.
- **`CLAUDE.md`** — context for Claude. Read it if you want to know why the site is built the way it is.
- **`STRESS-TESTS.md`** — the testing checklist.
- **`DNS-BASELINE.md`** — a record of your domain's settings as they were before any of this. The restore point if something goes wrong.
