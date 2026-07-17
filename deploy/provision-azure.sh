#!/usr/bin/env bash
# One-shot provisioning + first deployment for the split setup:
#   API      → Windows App Service  (vsk-indane-api)
#   Frontend → Linux App Service    (vsk-indane-web, static build served by pm2)
# Prereqs: az login done; dotnet 8 + node on PATH. Idempotent — safe to re-run.
set -euo pipefail

RG=vsk
LOCATION=centralindia
SQL_SERVER=vsk-indane-ind
API_APP=vsk-indane-api
WEB_APP=vsk-indane-web
API_PLAN=vsk-api-plan-win
WEB_PLAN=vsk-web-plan-linux
SKU=F1
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== SQL firewall: current machine + Azure services =="
MYIP=$(curl -s -4 https://ifconfig.me)
az sql server firewall-rule create -g $RG -s $SQL_SERVER -n dev-machine \
    --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
az sql server firewall-rule create -g $RG -s $SQL_SERVER -n AllowAllWindowsAzureIps \
    --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none

echo "== App Service plans ($SKU) =="
az appservice plan create -g $RG -n $API_PLAN --sku $SKU -o none
az appservice plan create -g $RG -n $WEB_PLAN --sku $SKU --is-linux -o none

echo "== Web apps =="
az webapp create -g $RG -p $API_PLAN -n $API_APP --runtime "dotnet:8" -o none
az webapp create -g $RG -p $WEB_PLAN -n $WEB_APP --runtime "NODE:20-lts" -o none

echo "== API app settings (connection string comes from appsettings.Development.json) =="
CONN=$(python3 -c "import json;print(json.load(open('$REPO_ROOT/src/VskOps.Api/appsettings.Development.json'))['ConnectionStrings']['VskOps'])")
JWTKEY=$(openssl rand -base64 48 | tr -d '\n')
az webapp config appsettings set -g $RG -n $API_APP -o none --settings \
    ConnectionStrings__VskOps="$CONN" \
    Jwt__Key="$JWTKEY" \
    Database__MigrateOnStartup=true \
    Cors__AllowedOrigins__0="https://$WEB_APP.azurewebsites.net"

echo "== Build + deploy API =="
cd "$REPO_ROOT"
dotnet publish src/VskOps.Api -c Release -o /tmp/vsk-publish
(cd /tmp/vsk-publish && zip -qr /tmp/vsk-api.zip .)
az webapp deploy -g $RG -n $API_APP --src-path /tmp/vsk-api.zip --type zip -o none

echo "== Build + deploy frontend (API origin baked in) =="
cd "$REPO_ROOT/frontend"
npm ci
VITE_API_URL="https://$API_APP.azurewebsites.net" npm run build
(cd dist && zip -qr /tmp/vsk-web.zip .)
az webapp config set -g $RG -n $WEB_APP -o none \
    --startup-file "pm2 serve /home/site/wwwroot --no-daemon --spa"
az webapp deploy -g $RG -n $WEB_APP --src-path /tmp/vsk-web.zip --type zip -o none

echo
echo "Done."
echo "  API:      https://$API_APP.azurewebsites.net/swagger"
echo "  Frontend: https://$WEB_APP.azurewebsites.net"
echo "First visit: use 'Create the first Owner account' on the login screen."
