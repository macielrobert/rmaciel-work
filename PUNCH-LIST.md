# Punch list — everything that must be true before launch

The last pass before the domain points at this site. Nothing here is
exploratory: each line is a known, specific thing that is currently wrong or
missing, and every one has been verified against the repository as it stands.

`TO-DO.md` is the master plan and holds the history. **This is the gate.**

---

## A note on wording: this is not a domain transfer

Moving the *registration* away from Squarespace is a separate operation, is not
required to launch, and is deferred indefinitely (`TO-DO.md`, DEFERRED).

What launch actually involves is **changing two DNS records** so the domain
points at Netlify instead of Squarespace. The registration, the nameservers,
and the mail records all stay exactly where they are. Conflating the two is the
single most likely way to break the email, which is why the distinction is
written down here.

---

## 0. Carried over from the CMS migration

Everything here was created or discovered while replacing Decap with
Keystatic. None of it blocks writing content; all of it blocks launch.

- [ ] **Decide what to do about review-before-publish.** Keystatic writes
      straight to `main`. The fix is a GitHub branch protection rule, and
      **rulesets are not enforced on a private repository on the free plan** —
      GitHub says so on the ruleset page. Four options, none free-and-automatic:
      - **Create a branch in the editor** before each session. Works today, one
        click, relies on remembering.
      - **Make the repository public.** Rules become free — but the licensed
        font files would then be redistributed in a public repo, which is a
        different permission from web embedding. **Check the licence first.**
      - **Pay for GitHub Team.**
      - **Swap the default branch** so Keystatic writes to `content` and
        production deploys from `main`. Free and structural; costs one more
        branch to keep track of.
- [ ] **Add `rmaciel.work` to the GitHub App's Callback URLs** at cutover.
      Keystatic builds the redirect from whatever host the request arrived on,
      so a new address cannot log in until its callback is listed. One per
      origin; GitHub accepts no wildcards.
- [ ] Update the GitHub App's **Homepage URL** to the real domain. Cosmetic —
      it plays no part in the login flow.
- [ ] **Decide whether the editor should be public at all.** `/keystatic` will
      be reachable at `rmaciel.work/keystatic`. Only someone who can write to
      the repository can save anything, so it is not a hole — but it is a login
      page on a portfolio. Netlify can password-protect a path on paid plans;
      the free alternative is to accept it.
- [ ] **Keystatic is pre-1.0** (`0.6.4`). Versions are pinned exactly in
      `package.json`, which is deliberate: by semver a minor release may break
      the custom marks. Upgrade on purpose, check `/keystatic` on a preview
      first, never let it float.
- [ ] **First image upload creates `images/`**, which does not exist yet. The
      build skips a missing directory by design, so nothing is wrong today —
      but the first upload is the first time that path runs for real.
- [x] **Which slug is the real URL — DECIDED: the authored one.** Three files
      had disagreed, and the editor was promising the opposite of what the
      site did: `index.html` built the URL from the **title**, while
      `keystatic.config.tsx` called the slug field a *"Frozen permanent
      address"* and `README.md` said *"Renaming the title is safe; changing
      the slug is not."*

      `buildData()` now prefers `p.slug` — the CMS filename — and falls back
      to `slugify(title)` only for ABOUT and hand-written entries. **No
      existing URL changed** (verified across all fifteen; Keystatic derives
      filenames from titles too, so they agreed exactly at the moment of the
      switch). The editor's help text and the README are now true as written.

      What this buys while writing real content: **a title can be edited
      freely without moving a link.** The slug still cannot — that part of the
      warning stands, and it is now the only thing that carries it.

---

## 1. Content — do this first, it is the long pole

- [ ] **Set the real contact address.** Currently `hello@studio.xyz`, a
      placeholder. This is what the SEND button on the site mails to, so
      shipping it wrong means enquiries go nowhere.
      → CMS: **CONTACT → Email address**
- [ ] Replace the 14 placeholder projects with real work
- [ ] Real icons and wordmarks. **Transparent PNG or SVG with real
      counterforms** — alpha is the shape, so an opaque PNG or any JPG bakes
      as a solid block. Request the mark, not the lockup.
- [ ] Alt text on every image (the CMS requires it, so this is really a
      quality check, not a completeness one)
- [ ] Real ABOUT copy
- [ ] **Combinatorial layout test with the real copy** — a one-line summary and
      an over-long title, in every layout, both orientations. This is the class
      of bug that placeholder copy hides completely.
- [ ] Once no project relies on them, delete the ~120 lines of placeholder
      generators in `index.html` (`placeholderImages`, `placeholderWordmark`,
      `makeTestPNG`, the `SVG_*` shapes)
- [ ] **Delete `big-deal-project`** — a test entry written while proving the
      editor. It is on the live site.
- [ ] **Check formatted copy through the character churn.** `spanify()` walks
      into child elements so it should churn normally, but a size span changes
      the line box mid-animation and that has never been seen running.
- [ ] **Judge lists, quote and divider at 11px on a phone.** The spacing is a
      first guess, never looked at.

---

## 2. Site — currently missing, all host-independent

- [ ] **Real `<title>`.** It still reads `SVG Noise Lab — v80`. That string is
      what shows in a browser tab, a bookmark, and a Google result.
- [ ] **Share and search metadata** — description, Open Graph tags, favicon,
      an `<h1>`. There are currently none of any of these, so a link pasted
      anywhere previews as a blank rectangle.
      `content/site.json` already collects the description and share image;
      nothing reads them yet.
- [ ] **`404.html`** — does not exist, so a mistyped address gets Netlify's
      page rather than this site's
- [ ] **Contact form endpoint** — SEND currently opens the visitor's mail app
      via `mailto:`. Swap for Netlify's native form handling. Consider a
      confirm-on-close when the form has been typed into.
- [x] **`IMAGE_TRANSFORM`** — wired to Netlify's Image CDN. The strip measures
      each rendered thumbnail and asks for the rung above it; the expanded view
      asks at `EXPAND_W` 2048. Neither asks for the camera original any more. **Still needs one check on the deploy
      preview**: open a project with real photographs and confirm the strip
      loads rather than showing three empty grey boxes. A wrong URL shape is a
      404 per image and looks exactly like that.
- [ ] Throttle `resize()` — it currently reallocates the GPU buffer and forces
      two layout reads on every resize event. Desktop-only symptom.

---

## 3. Test on a real address

Half of `STRESS-TESTS.md` cannot run in a preview without an address bar. Run
these on the deploy preview **before** the cutover, not after:

- [ ] Deep links, back, forward, reload while deep
- [ ] `?nogl` fallback at four viewport sizes
- [ ] Real WebGL failure (Firefox, `webgl.disabled=true`)
- [ ] Console clean on a normal load — no silent degrade
- [ ] Keyboard navigation and VoiceOver
- [ ] Fix whatever this surfaces before going further

---

## 4. Cutover — about five minutes of actual work

**Read the four standing rules at the top of `TO-DO.md` first.** They are the
four ways to lose the email.

- [ ] **Harvest the old Squarespace site first.** `rmaciel.work` still serves it,
  including ~38 unlinked pages of copy and pictures that exist nowhere else.
  The moment the domain points here, those pages stop answering at that
  address. Run Harvest → **Crawl website** → `rmaciel.work`, and write what is
  wanted, BEFORE the step below.
- [ ] In Netlify: add the custom domain, open **Check DNS configuration**, and
      read the current target values off that panel
- [ ] Decide apex (`rmaciel.work`) or `www` as primary. Apex reads better and
      the performance difference is nil at this file size.
- [ ] In Squarespace DNS, change **only these two things**:
      - the apex record — ALIAS/ANAME to Netlify's apex load balancer if
        offered, otherwise an A record to Netlify's IP
      - the `www` CNAME
- [ ] **Leave the five MX records alone.** They are the email.
- [ ] **Leave the nameservers alone.**
- [ ] **Never put a CNAME on the apex.** A name carrying a CNAME can hold no
      other records, including MX. This is the one edit that kills mail.
- [ ] Wait for propagation — up to a day

`DNS-BASELINE.md` records every setting as it was beforehand, captured from
outside with `dig`. It is the restore point.

---

## 5. Verify — all four must pass

- [ ] Site loads on the apex **and** on `www`
- [ ] HTTPS certificate issued
- [ ] Mail **to** the domain address, sent from an outside account, arrives
- [ ] Mail **from** the domain address delivers elsewhere

If any mail test fails, restore the records from `DNS-BASELINE.md` before
doing anything else.

---

## 6. About a week later

- [ ] Cancel the Squarespace **website** subscription — that one only
- [ ] Keep the **domain** subscription. It carries the MX records.
- [ ] Keep the **Google Workspace** subscription. In Squarespace's interface
      "cancel" means two different things and one of them suspends the inbox.
- [ ] Confirm DNS management is still reachable afterwards
