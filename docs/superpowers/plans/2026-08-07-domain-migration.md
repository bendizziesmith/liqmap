# Migration: liqmap.netlify.app → liqmap.smithblock.ai

## Failure modes enumerated first

1. **Email breakage (hard constraint).** smithblock.ai's GoDaddy zone carries ImprovMX MX
   + SPF for justin@smithblock.ai — the inbox TradingView replies to. Registrar-side
   action is exactly ONE added record for the `liqmap` subdomain. No MX/TXT edits, no
   nameserver delegation to Netlify (delegation would move email DNS wholesale), no
   Netlify DNS zone creation for the apex.
2. **Dead-redirect intermediate state.** Setting the primary custom domain may make
   Netlify 301 `liqmap.netlify.app` → `liqmap.smithblock.ai` immediately — before DNS for
   the new host exists. The netlify.app URL is named in the signed licence application;
   a redirect to an unresolvable host is worse than the status quo. Mitigation: test the
   alias the moment the primary is set; if it dead-redirects, roll back (unset
   custom_domain) and re-sequence to DNS-first.
3. **Cert provisioning delay.** Let's Encrypt can only issue once DNS validates. Poll with
   backoff ~10 min; report outstanding rather than declaring done.
4. **Service-worker origin lock.** Registrations and caches are per-origin by browser
   design, so the new origin starts clean and the old one is untouched — verified
   explicitly, not assumed (`sw.js` already keys on `self.location.origin`, nothing
   hardcodes a host).
5. **Hardcoded origins.** index.html og:url / og:image / twitter:image; no canonical link
   exists yet (add one); README. Manifest start_url/scope are relative; robots.txt names
   no host; no sitemap exists. Runtime data paths must stay Bybit-only/relative — asserted
   by test.

## Sequence, with rollback points

| step | action | rollback |
|---|---|---|
| A | Code: canonical + OG/Twitter → new origin; README; origin test | `git revert` |
| B | `netlify api updateSite` → custom_domain = liqmap.smithblock.ai; immediately probe the alias | `updateSite {custom_domain: null}` |
| C | Registrar: check for credentials; expected absent → hand over the one record | n/a (nothing run) |
| D | Poll DNS ≤10 min → cert provision → force HTTPS → real-browser verify both origins | cert/HTTPS are additive; no rollback needed |

Irreversible steps: none — every step above reverts cleanly. The only action flagged as
unrecoverable-if-wrong (editing existing DNS records) is explicitly out of scope.

## The one DNS record

    Type:  CNAME
    Name:  liqmap
    Value: liqmap.netlify.app
    TTL:   600 (or GoDaddy's default 1 hour)
