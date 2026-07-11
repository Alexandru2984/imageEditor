#!/usr/bin/env bash
# Build and deploy the image editor to the nginx docroot on this VPS.
# Requires sudo for the rsync/chown into /var/www.
set -euo pipefail

DOCROOT="/var/www/imageeditor.micutu.com"

cd "$(dirname "$0")/.."

echo "==> Building (typecheck gate + vite build)"
npm run build

echo "==> Syncing dist/ -> $DOCROOT"
sudo rsync -a --delete dist/ "$DOCROOT/"
sudo chown -R www-data:www-data "$DOCROOT"

echo "==> Done. Deployed $(git rev-parse --short HEAD) to https://imageeditor.micutu.com"
