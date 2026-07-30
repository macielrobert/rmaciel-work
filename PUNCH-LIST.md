# Punch list — everything that must be true before launch

The last pass before the domain points at this site. Nothing here is
exploratory: each line is a known, specific thing that is currently wrong or
missing, and every one has been verified against the repository as it stands.

`PLAN.md` is the master plan and holds the history. **This is the gate.**

---

## A note on wording: this is not a domain transfer

Moving the *registration* away from Squarespace is a separate operation, is not
required to launch, and is deferred indefinitely (`PLAN.md`, DEFERRED).

What launch actually involves is **changing two DNS records** so the domain
points at Netlify instead of Squarespace. The registration, the nameservers,
and the mail records all stay exactly where they are. Conflating the two is the
single most likely way to break the email, which is why the distinction is
written down here.

---

## 1. Content — do this first, it is the long pole

- [ ] **Set the real contact address.** Currently `hello@studio.xyz`, a
      placeholder. This is what the SEND button on the site mails to, so
      shipping it wrong means enquiries go nowhere.
      → CMS: **Fixtures → CONTACT → Email address**
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
- [ ] **`IMAGE_TRANSFORM`** — still `null`, so every image serves at full size.
      Set it to Netlify's image CDN format and verify the format against their
      live docs at the time; the comment above it in `index.html` has the shape.
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

**Read the four standing rules at the top of `PLAN.md` first.** They are the
four ways to lose the email.

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
