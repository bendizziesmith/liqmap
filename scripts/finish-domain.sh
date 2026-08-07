#!/usr/bin/env bash
# Finish the liqmap.smithblock.ai migration once the CNAME exists at GoDaddy.
#
# Everything up to DNS is already done: the site's primary custom domain is set, the app
# ships the new canonical origin, and liqmap.netlify.app still serves. This waits for the
# record, provisions the Let's Encrypt cert, forces HTTPS, and verifies both origins.
#
# Usage: bash scripts/finish-domain.sh
set -uo pipefail
SITE=9f075656-8c73-421b-b04e-a74218946f99
HOST=liqmap.smithblock.ai

echo "1/4 waiting for DNS ..."
for i in $(seq 1 60); do
  R=$(dig +short "$HOST" CNAME @8.8.8.8; dig +short "$HOST" A @8.8.8.8)
  [ -n "$R" ] && { echo "    resolved: $R"; break; }
  printf "."; sleep 15
done
[ -z "${R:-}" ] && { echo "    still not resolving after 15 min — check the CNAME at GoDaddy"; exit 1; }

echo "2/4 provisioning certificate (Let's Encrypt) ..."
netlify api provisionSiteTLSCertificate --data "{\"site_id\":\"$SITE\"}" >/dev/null 2>&1
for i in $(seq 1 20); do
  S=$(netlify api showSiteTLSCertificate --data "{\"site_id\":\"$SITE\"}" 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("state",""))' 2>/dev/null)
  echo "    cert state: ${S:-pending}"
  [ "$S" = "issued" ] && break
  sleep 15
done

echo "3/4 forcing HTTPS ..."
netlify api updateSite --data "{\"site_id\":\"$SITE\",\"body\":{\"force_ssl\":true}}" >/dev/null 2>&1
netlify api getSite --data "{\"site_id\":\"$SITE\"}" 2>/dev/null \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("    force_ssl:",d.get("force_ssl"),"ssl_url:",d.get("ssl_url"))'

echo "4/4 verifying both origins ..."
for u in "https://$HOST/" "https://liqmap.netlify.app/"; do
  printf "    %-36s " "$u"
  curl -s -o /dev/null -w "code=%{http_code} redirect='%{redirect_url}'\n" --max-time 25 "$u"
done
echo
echo "Then run the browser verification:"
echo "  node scripts/verify-origin.mjs https://$HOST/"
