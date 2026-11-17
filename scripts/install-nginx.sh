#!/usr/bin/env bash
# Install the repository's Nginx site for imageeditor.micutu.com, rolling back
# automatically if validation, the reload or the origin checks fail.
#
#   ./scripts/install-nginx.sh           install and reload
#   ./scripts/install-nginx.sh --check   validate the repository copy only
set -euo pipefail
umask 022

readonly HOST="imageeditor.micutu.com"
readonly SITE="$HOST-canary"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly REPO_ROOT
readonly SITE_SOURCE="$REPO_ROOT/deploy/nginx/sites-available/$SITE"
readonly HEADERS_SOURCE="$REPO_ROOT/deploy/nginx/snippets/imageeditor-headers.conf"
readonly SITE_TARGET="/etc/nginx/sites-available/$SITE"
readonly HEADERS_TARGET="/etc/nginx/snippets/imageeditor-headers.conf"
BACKUP_DIR="/etc/nginx/backups/$SITE-$(date -u +%Y%m%dT%H%M%SZ)-$$"
readonly BACKUP_DIR

if [[ "${1:-}" == "--check" ]]; then
  sudo nginx -t -q -p "$REPO_ROOT/deploy/nginx/" -c nginx.test.conf
  echo "Repository Nginx configuration is valid"
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

sudo install -d -o root -g root -m 0700 "$BACKUP_DIR"

backup_file() {
  local target=$1 name=$2
  if sudo test -e "$target"; then
    sudo cp -a "$target" "$BACKUP_DIR/$name"
  fi
}

restore_file() {
  local target=$1 name=$2
  if sudo test -e "$BACKUP_DIR/$name"; then
    sudo cp -a "$BACKUP_DIR/$name" "$target"
  else
    sudo rm -f "$target"
  fi
}

backup_file "$SITE_TARGET" site
backup_file "$HEADERS_TARGET" headers

restore_needed=true
reloaded=false
enabled_link_created=false
rollback() {
  if [[ "$restore_needed" == true ]]; then
    echo "==> Restoring the previous Nginx configuration" >&2
    set +e
    restore_file "$SITE_TARGET" site
    restore_file "$HEADERS_TARGET" headers
    if [[ "$enabled_link_created" == true ]]; then
      sudo rm -f "/etc/nginx/sites-enabled/$SITE"
    fi
    if sudo nginx -t -q && [[ "$reloaded" == true ]]; then
      sudo systemctl reload nginx
    fi
    set -e
  fi
}
trap rollback EXIT

echo "==> Validating the repository configuration"
sudo nginx -t -q -p "$REPO_ROOT/deploy/nginx/" -c nginx.test.conf

echo "==> Installing $SITE (backup in $BACKUP_DIR)"
sudo install -o root -g root -m 0644 "$HEADERS_SOURCE" "$HEADERS_TARGET"
sudo install -o root -g root -m 0644 "$SITE_SOURCE" "$SITE_TARGET"
if ! sudo test -e "/etc/nginx/sites-enabled/$SITE"; then
  sudo ln -s "$SITE_TARGET" "/etc/nginx/sites-enabled/$SITE"
  enabled_link_created=true
fi

sudo nginx -t -q
sudo systemctl reload nginx
reloaded=true
sleep 1

echo "==> Verifying the origin"
origin=(--silent --show-error --connect-timeout 5 --max-time 15 --retry 2
  --resolve "$HOST:443:127.0.0.1")
expect() {
  local what=$1 actual=$2 pattern=$3
  if ! grep -qiE "$pattern" <<<"$actual"; then
    echo "Origin check failed: $what" >&2
    echo "$actual" >&2
    return 1
  fi
}
index_headers="$(curl "${origin[@]}" --head "https://$HOST/")"
expect "index status" "$index_headers" '^HTTP/[0-9.]+ 200'
expect "CSP" "$index_headers" "^content-security-policy: default-src 'none';.*object-src 'none'"
expect "COEP" "$index_headers" '^cross-origin-embedder-policy: require-corp'
expect "frame options" "$index_headers" '^x-frame-options: DENY'
expect "index caching" "$index_headers" '^cache-control: no-cache'

asset="$(curl "${origin[@]}" "https://$HOST/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -n 1 || true)"
if [[ -n "$asset" ]]; then
  asset_headers="$(curl "${origin[@]}" --head "https://$HOST$asset")"
  expect "asset status" "$asset_headers" '^HTTP/[0-9.]+ 200'
  expect "asset caching" "$asset_headers" '^cache-control: public, max-age=31536000, immutable'
  expect "asset nosniff" "$asset_headers" '^x-content-type-options: nosniff'
fi
status_of() { curl "${origin[@]}" --output /dev/null --write-out '%{http_code}' "$@"; }
expect "real 404" "$(status_of "https://$HOST/this-page-does-not-exist")" '^404$'
expect "POST refused" "$(status_of -X POST "https://$HOST/")" '^405$'
expect "dotfiles hidden" "$(status_of "https://$HOST/.git/config")" '^404$'

restore_needed=false
trap - EXIT
echo "==> Nginx configuration installed; backup retained in $BACKUP_DIR"
