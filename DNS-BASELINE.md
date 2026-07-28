# DNS Baseline — before the Netlify migration

Captured by `dig` from outside, so this is what the internet actually sees,
not what a control panel chooses to display.

**Domain:** rmaciel.work
**Captured:** July 27, 2026
**Registrar / DNS host:** Squarespace
**Mail:** Google Workspace (real mailbox)

> An empty section below means **confirmed absent** — the query ran and
> returned nothing. It does not mean "not checked."

---

## MX — the email. NEVER CHANGE THESE.

```
1  aspmx.l.google.com.
5  alt1.aspmx.l.google.com.
5  alt2.aspmx.l.google.com.
10 alt3.aspmx.l.google.com.
10 alt4.aspmx.l.google.com.
```

Standard Google Workspace set. Priority number first — lower is tried first.
These five records ARE the email service; nothing else in this file affects it.

Note: Google may at some point suggest replacing these with a single
`smtp.google.com` record. That newer form is fine, but this set is fully
supported and needs no action. **Do not make that change during the
migration** — one thing at a time.

---

## A records — the website. THESE CHANGE AT CUTOVER.

```
198.49.23.144
198.49.23.145
198.185.159.144
198.185.159.145
```

Squarespace's servers. At cutover these get replaced with Netlify's value
(read the current one off Netlify's *Check DNS configuration* panel).

---

## www — CNAME. THIS CHANGES AT CUTOVER.

```
www  ->  ext-sq.squarespace.com.
         (resolving to the same four Squarespace IPs above)
```

Becomes a CNAME pointing at the Netlify subdomain.

---

## CNAME on the root — none, and that is CORRECT

Not a missing record. A name carrying a CNAME can hold no other records,
including MX, so a CNAME on the apex would destroy the email. The apex uses
A (or ALIAS/ANAME) records instead. Empty here is the healthy state.

---

## TXT on the root — CONFIRMED ABSENT

No SPF record. No `google-site-verification` string. Nothing to preserve.

## DKIM (`google._domainkey`) — CONFIRMED ABSENT

Never generated in the Google Admin console.

## DMARC (`_dmarc`) — CONFIRMED ABSENT

---

## Nameservers

```
ns01.squarespacedns.com.      dns1.p02.nsone.net.
ns02.squarespacedns.com.      dns2.p02.nsone.net.
ns03.squarespacedns.com.      dns3.p02.nsone.net.
ns04.squarespacedns.com.      dns4.p02.nsone.net.
```

Squarespace, with NS1 as their DNS backend. Both sets listed is normal.

**These must not change.** Moving nameservers to another provider means
recreating the MX records by hand, which is the main way this migration could
break email.

---

## Summary for the cutover

| Record | Action |
|---|---|
| A (root) × 4 | **Replace** with Netlify's |
| CNAME `www` | **Replace** with Netlify's |
| MX × 5 | **Leave alone** |
| Nameservers | **Leave alone** |
| TXT / DKIM / DMARC | Nothing there to touch |

Two records change. Everything else stays exactly as it is.

---

## Re-run to compare

```
for t in MX TXT A NS CNAME; do echo "--- $t"; dig rmaciel.work $t +short; done
echo "--- DKIM";  dig google._domainkey.rmaciel.work TXT +short
echo "--- DMARC"; dig _dmarc.rmaciel.work TXT +short
echo "--- WWW";   dig www.rmaciel.work +short
```

After cutover, the A and www lines should show Netlify. Everything else should
be byte-identical to this file. If MX ever differs, something went wrong —
restore from the block above.
