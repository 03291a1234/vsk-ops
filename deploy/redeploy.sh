#!/usr/bin/env bash
# Rebuild + redeploy both apps to the existing Azure App Services.
# Run after `az login` (interactive browser login — this tenant's security defaults
# block the device-code flow). Idempotent; safe to re-run.
#
#   az login
#   ~/Desktop/vsk-ops/deploy/redeploy.sh
set -euo pipefail

RG=vsk
API_APP=vsk-indane-api
WEB_APP=vsk-indane-web
API_URL="https://$API_APP.azurewebsites.net"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"

echo "== Build + deploy API =="
dotnet publish "$REPO_ROOT/src/VskOps.Api" -c Release -o "$TMP/api" >/dev/null
(cd "$TMP/api" && zip -qr "$TMP/api.zip" .)
az webapp deploy -g $RG -n $API_APP --src-path "$TMP/api.zip" --type zip -o none

echo "== Build + deploy frontend (API origin baked in) =="
cd "$REPO_ROOT/frontend"
npm ci
VITE_API_URL="$API_URL" npm run build
(cd dist && zip -qr "$TMP/web.zip" .)
az webapp deploy -g $RG -n $WEB_APP --src-path "$TMP/web.zip" --type zip -o none

rm -rf "$TMP"
echo
echo "Deployed."
echo "  App:      https://$WEB_APP.azurewebsites.net"
echo "  API:      $API_URL/swagger"
echo "Tip: if the app was already open, close and reopen it once (PWA cache)."
