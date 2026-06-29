#!/usr/bin/env bash
# Pull the latest main, reinstall, rebuild the web client, and restart the service.
# Run on the VPS. The CI workflow (.github/workflows/deploy.yml) pipes this script
# over SSH so the box always runs the latest version of these steps.
set -euo pipefail

APP_DIR="${BRIDGE_DIR:-/srv/claude-bridge}"
SERVICE="${BRIDGE_SERVICE:-bridge}"

cd "$APP_DIR"

echo "==> Fetching origin/main"
git fetch --prune origin
git reset --hard origin/main

echo "==> Installing dependencies (npm ci)"
npm ci

echo "==> Building web client"
npm run build

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Deployed $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
