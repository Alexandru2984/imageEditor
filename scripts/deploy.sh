#!/usr/bin/env bash
# Build, test and publish the image editor on this VPS.
#
#   ./scripts/deploy.sh               gate, build and publish HEAD
#   ./scripts/deploy.sh --rollback    point the site back at the previous release
#   ./scripts/deploy.sh --list        show the releases on disk
#
# Every deploy is a complete, root-owned directory under releases/. Nginx
# serves $SITE_ROOT/current, a symlink that is swapped with a single atomic
# rename(2), so a visitor gets either the old release or the new one, never a
# mix. Hashed assets that a replaced release used are carried into the new one
# (as hard links) for ASSET_RETENTION_DAYS, so tabs opened before a deploy can
# still lazy-load the chunks and workers they reference.
set -euo pipefail
umask 022

readonly HOST="imageeditor.micutu.com"
readonly SITE_ROOT="${SITE_ROOT:-/srv/canary/$HOST}"
readonly RELEASES="$SITE_ROOT/releases"
readonly CURRENT="$SITE_ROOT/current"
readonly ASSET_RETENTION_DAYS="${ASSET_RETENTION_DAYS:-30}"
readonly KEEP_RELEASES="${KEEP_RELEASES:-5}"
readonly RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

cd "$(dirname "$0")/.."

die() {
  echo "$*" >&2
  exit 1
}

for value in "$ASSET_RETENTION_DAYS" "$KEEP_RELEASES"; do
  [[ "$value" =~ ^[0-9]+$ ]] || die "ASSET_RETENTION_DAYS and KEEP_RELEASES must be non-negative integers"
done
((KEEP_RELEASES >= 2)) || die "KEEP_RELEASES must be at least 2 so a rollback target exists"

[[ -d "$RUNTIME_DIR" && -w "$RUNTIME_DIR" ]] ||
  die "A private writable runtime directory is required for the deploy lock"
exec 9>"$RUNTIME_DIR/imageeditor-deploy.lock"
flock -n 9 || die "Another image editor deploy is already running"

# Release ids sort chronologically: <UTC timestamp>-<commit>.
list_releases() {
  sudo find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' -printf '%f\n' 2>/dev/null |
    sort
}

current_release() {
  if sudo test -L "$CURRENT"; then
    basename "$(sudo readlink "$CURRENT")"
  fi
}

# Point current at releases/$1 atomically. The first deploy replaces the
# directory that used to be served in place: the two are exchanged in one
# renameat2(RENAME_EXCHANGE) and the old tree is kept as a release.
switch_to() {
  local release=$1
  local next="$SITE_ROOT/.current.next"
  sudo rm -f "$next"
  sudo ln -s "releases/$release" "$next"
  if sudo test -d "$CURRENT" && ! sudo test -L "$CURRENT"; then
    sudo mv -T --exchange "$next" "$CURRENT"
    sudo mv -T "$next" "$RELEASES/00000000T000000Z-legacy"
  else
    sudo mv -T "$next" "$CURRENT"
  fi
}

# The origin (nginx on this host, bypassing Cloudflare) must serve exactly
# this index and every script and stylesheet it references.
smoke_test() {
  local expected_index=$1
  local origin=(--fail --silent --show-error --connect-timeout 5 --max-time 15
    --retry 2 --resolve "$HOST:443:127.0.0.1")
  curl "${origin[@]}" "https://$HOST/" | cmp --silent - "$expected_index" || return 1
  local asset
  while read -r asset; do
    curl "${origin[@]}" --output /dev/null "https://$HOST$asset" || return 1
  done < <(grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' "$expected_index" | sort -u)
}

case "${1:-}" in
  --list)
    active="$(current_release)"
    while read -r release; do
      [[ -n "$release" ]] || continue
      [[ "$release" == "$active" ]] && echo "* $release" || echo "  $release"
    done < <(list_releases)
    exit 0
    ;;
  --rollback)
    active="$(current_release)"
    [[ -n "$active" ]] || die "current is not a release symlink; nothing to roll back"
    previous="$(list_releases | awk -v active="$active" '$0 == active { print prev; exit } { prev = $0 }')"
    [[ -n "$previous" ]] || die "No release older than $active to roll back to"
    switch_to "$previous"
    index="$(mktemp)"
    # The copy is meant to be ours, not root's.
    # shellcheck disable=SC2024
    sudo cat "$RELEASES/$previous/index.html" >"$index"
    smoke_test "$index" || die "Rolled back to $previous, but the origin smoke test failed ($index)"
    rm -f "$index"
    echo "==> Rolled back from $active to $previous"
    exit 0
    ;;
  "") ;;
  *) die "Usage: $0 [--rollback | --list]" ;;
esac

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] ||
  die "Refusing to deploy a dirty worktree. Commit or stash every change first."

echo "==> Installing the locked dependency graph without lifecycle scripts"
npm ci --ignore-scripts --no-audit --no-fund

echo "==> Auditing, linting, testing, typechecking and building"
npm run audit
npm run audit:signatures
npm run check
npm run test:e2e

[[ -f dist/index.html && -f dist/404.html && -d dist/assets ]] || die "Build output is incomplete"

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
readonly RELEASE
readonly STAGE="$RELEASES/.$RELEASE.partial"
NOW="$(date -u +%s)"
readonly NOW
carried="$(mktemp)"
switched=false
previous=""

cleanup() {
  if [[ "$switched" == true && -n "$previous" ]]; then
    echo "==> Smoke test failed; switching back to $previous" >&2
    switch_to "$previous" || true
  fi
  # A release that never went live (or was switched away from) is removed.
  if [[ "$(current_release)" != "$RELEASE" ]]; then
    sudo rm -rf "${RELEASES:?}/$RELEASE" "${RELEASES:?}/$RELEASE.carried"
  fi
  sudo rm -rf "$STAGE"
  rm -f "$carried"
}
trap cleanup EXIT

sudo install -d -o root -g root -m 0755 "$SITE_ROOT" "$RELEASES"
previous="$(current_release)"
if sudo test -d "$CURRENT" && ! sudo test -L "$CURRENT"; then
  previous="00000000T000000Z-legacy"
fi

echo "==> Staging release $RELEASE"
sudo rsync -a --chown=root:root --chmod=D755,F644 dist/ "$STAGE/"

# Carry forward hashed assets that the new build no longer contains.
# releases/<id>.carried records "<asset> <epoch it stopped being current>";
# an asset is dropped once it has been superseded for the retention period.
if [[ -n "$previous" ]]; then
  if [[ "$previous" == *-legacy ]]; then
    source_dir="$CURRENT"
  else
    source_dir="$RELEASES/$previous"
  fi
  previous_carried="$(sudo cat "$RELEASES/$previous.carried" 2>/dev/null || true)"
  while read -r asset; do
    [[ -n "$asset" ]] || continue
    sudo test -e "$STAGE/assets/$asset" && continue
    since="$(awk -v asset="$asset" '$1 == asset { print $2; exit }' <<<"$previous_carried")"
    since="${since:-$NOW}"
    ((NOW - since <= ASSET_RETENTION_DAYS * 86400)) || continue
    sudo ln "$source_dir/assets/$asset" "$STAGE/assets/$asset" 2>/dev/null ||
      sudo cp -p "$source_dir/assets/$asset" "$STAGE/assets/$asset"
    printf '%s %s\n' "$asset" "$since" >>"$carried"
  done < <(sudo find "$source_dir/assets" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null)
fi
sudo install -o root -g root -m 0644 "$carried" "$RELEASES/$RELEASE.carried"
echo "    carried forward $(wc -l <"$carried") older asset(s)"

# The worker never needs write access: everything is root-owned and read-only.
sudo chown -R root:root "$STAGE"
sudo find "$STAGE" -type d -exec chmod 0755 {} +
sudo find "$STAGE" -type f -exec chmod 0644 {} +
sudo mv -T "$STAGE" "$RELEASES/$RELEASE"

echo "==> Publishing"
switch_to "$RELEASE"
switched=true
smoke_test dist/index.html
switched=false

# The legacy in-place docroot was writable by the web server; lock it down now
# that it is only a rollback target.
if sudo test -d "$RELEASES/00000000T000000Z-legacy"; then
  sudo chown -R root:root "$RELEASES/00000000T000000Z-legacy"
  sudo find "$RELEASES/00000000T000000Z-legacy" -type d -exec chmod 0755 {} +
  sudo find "$RELEASES/00000000T000000Z-legacy" -type f -exec chmod 0644 {} +
fi

echo "==> Pruning old releases (keeping $KEEP_RELEASES and the rollback target)"
while read -r old; do
  [[ -n "$old" && "$old" != "$RELEASE" && "$old" != "$previous" ]] || continue
  sudo rm -rf "${RELEASES:?}/$old" "${RELEASES:?}/$old.carried"
done < <(list_releases | head -n "-$KEEP_RELEASES")

trap - EXIT
rm -f "$carried"
echo "==> Done. Deployed $RELEASE to https://$HOST (previous: ${previous:-none})"
