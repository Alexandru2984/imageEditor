#!/usr/bin/env bash
# Install the repository's versioned Nginx configuration with automatic
# rollback if syntax validation, reload, or the origin smoke test fails.
set -euo pipefail
umask 022

readonly HOST="imageeditor.micutu.com"
readonly REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly SITE_SOURCE="$REPO_ROOT/deploy/nginx/sites-available/$HOST"
readonly HEADERS_SOURCE="$REPO_ROOT/deploy/nginx/snippets/imageeditor-headers.conf"
readonly DOTFILES_SOURCE="$REPO_ROOT/deploy/nginx/snippets/imageeditor-block-dotfiles.conf"
readonly SITE_TARGET="/etc/nginx/sites-available/$HOST"
readonly HEADERS_TARGET="/etc/nginx/snippets/imageeditor-headers.conf"
readonly DOTFILES_TARGET="/etc/nginx/snippets/imageeditor-block-dotfiles.conf"
readonly BACKUP_DIR="/etc/nginx/backups/$HOST-$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [[ "${1:-}" == "--check" ]]; then
  sudo nginx -t -p "$REPO_ROOT/deploy/nginx/" -c nginx.test.conf
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

sudo install -d -o root -g root -m 0700 "$BACKUP_DIR"

backup_file() {
  local target=$1
  local name=$2
  if sudo test -e "$target"; then
    sudo cp -a "$target" "$BACKUP_DIR/$name"
  else
    sudo touch "$BACKUP_DIR/$name.missing"
  fi
}

restore_file() {
  local target=$1
  local name=$2
  if sudo test -e "$BACKUP_DIR/$name"; then
    sudo cp -a "$BACKUP_DIR/$name" "$target"
  else
    sudo rm -f "$target"
  fi
}

backup_file "$SITE_TARGET" site
backup_file "$HEADERS_TARGET" headers
backup_file "$DOTFILES_TARGET" dotfiles

restore_needed=true
reloaded=false
enabled_link_created=false
rollback() {
  local status=$?
  if [[ "$restore_needed" == true ]]; then
    echo "==> Restoring the previous Nginx configuration" >&2
    set +e
    restore_file "$SITE_TARGET" site
    restore_file "$HEADERS_TARGET" headers
    restore_file "$DOTFILES_TARGET" dotfiles
    if [[ "$enabled_link_created" == true ]]; then
      sudo rm -f "/etc/nginx/sites-enabled/$HOST"
    fi
    sudo nginx -t
    if [[ "$reloaded" == true ]]; then
      sudo systemctl reload nginx
    fi
    set -e
  fi
  return "$status"
}
trap rollback EXIT

echo "==> Installing versioned Nginx configuration"
sudo nginx -t -p "$REPO_ROOT/deploy/nginx/" -c nginx.test.conf
sudo install -o root -g root -m 0644 "$SITE_SOURCE" "$SITE_TARGET"
sudo install -o root -g root -m 0644 "$HEADERS_SOURCE" "$HEADERS_TARGET"
sudo install -o root -g root -m 0644 "$DOTFILES_SOURCE" "$DOTFILES_TARGET"

if ! sudo test -e "/etc/nginx/sites-enabled/$HOST"; then
  sudo ln -s "../sites-available/$HOST" "/etc/nginx/sites-enabled/$HOST"
  enabled_link_created=true
fi

sudo nginx -t
sudo systemctl reload nginx
reloaded=true

echo "==> Verifying origin security headers"
headers="$(
  curl --fail --silent --show-error --head \
    --connect-timeout 5 --max-time 15 --retry 2 \
    --resolve "$HOST:443:127.0.0.1" "https://$HOST/"
)"
grep -qi '^x-frame-options: DENY' <<<"$headers"
grep -qi '^cross-origin-opener-policy: same-origin' <<<"$headers"
grep -qi "^content-security-policy: .*object-src 'none'" <<<"$headers"

restore_needed=false
trap - EXIT
echo "==> Nginx configuration installed; backup retained at $BACKUP_DIR"
