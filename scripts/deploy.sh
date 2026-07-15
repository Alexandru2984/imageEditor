#!/usr/bin/env bash
# Build and deploy the image editor to the Nginx docroot on this VPS.
# New assets are copied first and index.html is replaced atomically, so a
# browser can never receive an index that points at files not yet deployed.
set -euo pipefail
umask 022

readonly HOST="imageeditor.micutu.com"
readonly DOCROOT="/var/www/$HOST"
readonly ASSET_RETENTION_DAYS="${ASSET_RETENTION_DAYS:-35}"

cd "$(dirname "$0")/.."

if [[ ! "$ASSET_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "ASSET_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to deploy a dirty worktree. Commit or stash every change first." >&2
  exit 1
fi

echo "==> Installing the locked dependency graph without lifecycle scripts"
npm ci --ignore-scripts --no-audit --no-fund

echo "==> Auditing, linting, testing, typechecking and building"
npm run audit
npm run audit:signatures
npm run check

if [[ ! -f dist/index.html || ! -d dist/assets ]]; then
  echo "Build output is incomplete" >&2
  exit 1
fi

readonly DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
readonly NEXT_INDEX="$DOCROOT/.index.html.$DEPLOY_ID"
readonly PREVIOUS_INDEX="$DOCROOT/.index.previous.$DEPLOY_ID"
had_previous_index=false
published=false

rollback() {
  local status=$?
  if [[ "$published" == true ]]; then
    echo "==> Smoke test failed; restoring the previous index" >&2
    if [[ "$had_previous_index" == true ]]; then
      sudo mv -fT "$PREVIOUS_INDEX" "$DOCROOT/index.html"
    else
      sudo rm -f "$DOCROOT/index.html"
    fi
  fi
  sudo rm -f "$NEXT_INDEX" "$PREVIOUS_INDEX"
  return "$status"
}
trap rollback EXIT

echo "==> Copying new assets before publishing the new index"
sudo install -d -o www-data -g www-data -m 0755 "$DOCROOT"
sudo rsync -a --chown=www-data:www-data --exclude=/index.html dist/ "$DOCROOT/"

if sudo test -f "$DOCROOT/index.html"; then
  sudo cp -a "$DOCROOT/index.html" "$PREVIOUS_INDEX"
  had_previous_index=true
fi
sudo install -o www-data -g www-data -m 0644 dist/index.html "$NEXT_INDEX"
sudo mv -fT "$NEXT_INDEX" "$DOCROOT/index.html"
published=true

echo "==> Verifying the origin serves the exact new index"
curl --fail --silent --show-error \
  --connect-timeout 5 --max-time 15 --retry 2 \
  --resolve "$HOST:443:127.0.0.1" "https://$HOST/" \
  | cmp --silent - dist/index.html

published=false
sudo rm -f "$PREVIOUS_INDEX"

# Keep hashed assets longer than their 30-day browser cache lifetime so tabs
# opened before a deploy can still lazy-load the matching worker bundle.
sudo find "$DOCROOT/assets" -type f -mtime "+$ASSET_RETENTION_DAYS" -delete

trap - EXIT

echo "==> Done. Deployed $(git rev-parse --short HEAD) to https://$HOST"
