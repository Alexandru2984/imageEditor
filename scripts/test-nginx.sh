#!/usr/bin/env bash
# Serve dist/ through the repository's Nginx site and check how it behaves:
# security headers on every kind of response, caching, content types, real
# 404s, refused methods and compression.
#
#   npm run build && ./scripts/test-nginx.sh
#
# Runs without root: the site is copied into a private prefix, TLS is dropped
# and it listens on a free loopback port (or PORT, if set).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly REPO_ROOT
readonly SITE="$REPO_ROOT/deploy/nginx/sites-available/imageeditor.micutu.com-canary"
readonly HEADERS="$REPO_ROOT/deploy/nginx/snippets/imageeditor-headers.conf"
PORT="${PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')}"
readonly PORT
readonly BASE="http://127.0.0.1:$PORT"

[[ -f "$REPO_ROOT/dist/index.html" ]] || { echo "Run npm run build first" >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed" >&2; exit 1; }

PREFIX="$(mktemp -d)"
readonly PREFIX
cleanup() {
  [[ -f "$PREFIX/nginx.pid" ]] && nginx -p "$PREFIX/" -c nginx.conf -e "$PREFIX/error.log" -s stop 2>/dev/null
  rm -rf "$PREFIX"
}
trap cleanup EXIT

mkdir -p "$PREFIX/snippets" "$PREFIX/site"
cp "$HEADERS" "$PREFIX/snippets/"
ln -s "$REPO_ROOT/dist" "$PREFIX/site/current"

# Keep only the HTTPS server block, served as plain HTTP on the test port.
python3 - "$SITE" "$PREFIX" "$PORT" <<'EOF'
import re, sys
site, prefix, port = sys.argv[1:]
text = open(site).read()
block = text[text.index("server {\n    listen 443"):]
block = re.sub(r"\n    listen [^\n]*", "", block, count=0)
block = block.replace("server {\n", f"server {{\n    listen 127.0.0.1:{port};\n", 1)
block = re.sub(r"\n    (http2|ssl_)[^\n]*", "", block)
block = block.replace("/srv/canary/imageeditor.micutu.com/current", f"{prefix}/site/current")
block = re.sub(r"/var/log/nginx/[^;]*", f"{prefix}/access.log", block)
open(f"{prefix}/site.conf", "w").write(block)
open(f"{prefix}/nginx.conf", "w").write(f"""
pid {prefix}/nginx.pid;
error_log {prefix}/error.log;
events {{}}
http {{
  include /etc/nginx/mime.types;
  client_body_temp_path {prefix}/tmp; proxy_temp_path {prefix}/tmp;
  fastcgi_temp_path {prefix}/tmp; uwsgi_temp_path {prefix}/tmp; scgi_temp_path {prefix}/tmp;
  access_log {prefix}/access.log;
  include site.conf;
}}
""")
EOF
mkdir -p "$PREFIX/tmp"
nginx -p "$PREFIX/" -c nginx.conf -e "$PREFIX/error.log" -t -q
nginx -p "$PREFIX/" -c nginx.conf -e "$PREFIX/error.log"
for _ in $(seq 50); do curl -s -o /dev/null "$BASE/" && break; sleep 0.1; done

failures=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

# check <description> <path> <expected status> <header regex>... [-- curl args]
check() {
  local what=$1 path=$2 status=$3
  shift 3
  local patterns=() args=()
  while (($#)); do
    if [[ $1 == -- ]]; then shift; args=("$@"); break; fi
    patterns+=("$1")
    shift
  done
  local response
  response="$(curl -s -o /dev/null -D - "${args[@]}" "$BASE$path" | tr -d '\r')"
  if ! grep -qE "^HTTP/[0-9.]+ $status( |$)" <<<"$response"; then
    fail "$what: expected $status, got $(head -n 1 <<<"$response")"
    return
  fi
  local pattern
  for pattern in "${patterns[@]}"; do
    if ! grep -qiE "$pattern" <<<"$response"; then
      fail "$what: no header matching /$pattern/"
      return
    fi
  done
  pass "$what"
}

readonly SECURE=(
  "^content-security-policy: default-src 'none';.*script-src 'self' 'wasm-unsafe-eval';.*manifest-src 'self'"
  "^cross-origin-embedder-policy: require-corp"
  "^cross-origin-opener-policy: same-origin"
  "^x-content-type-options: nosniff"
  "^x-frame-options: DENY"
  "^strict-transport-security: max-age="
)
js="$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$REPO_ROOT/dist/index.html" | head -n 1)"
wasm="/assets/$(find "$REPO_ROOT/dist/assets" -maxdepth 1 -name '*.wasm' -printf '%f\n' | head -n 1)"

echo "Nginx site behaviour ($BASE):"
check "index" / 200 "${SECURE[@]}" "^cache-control: no-cache" "^content-type: text/html"
check "index with a query string" "/?utm_source=test" 200 "^cache-control: no-cache"
check "hashed script" "$js" 200 "${SECURE[@]}" \
  "^cache-control: public, max-age=31536000, immutable" "^content-type: application/javascript"
check "WebAssembly runtime" "$wasm" 200 "${SECURE[@]}" "^content-type: application/wasm" \
  "^cache-control: public, max-age=31536000, immutable"
check "compressed script" "$js" 200 "^content-encoding: gzip" -- -H "Accept-Encoding: gzip"
check "web app manifest" /site.webmanifest 200 "${SECURE[@]}" \
  "^content-type: application/manifest\+json" "^cache-control: public, max-age=3600$"
check "social preview image" /og-image.png 200 "${SECURE[@]}" "^cache-control: public, max-age=3600$"
check "robots.txt" /robots.txt 200 "^content-type: text/plain"
check "sitemap" /sitemap.xml 200 "^content-type: (text|application)/xml"
check "unknown page is a real 404" /no-such-page 404 "${SECURE[@]}" "^cache-control: no-cache" \
  "^content-type: text/html"
check "missing hashed asset is a 404" /assets/missing-0000.js 404 "${SECURE[@]}"
check "404 page is not directly addressable" /404.html 404
check "dotfiles are hidden" /.git/config 404
check "environment files are hidden" /.env 404
check "POST is refused" / 405 "${SECURE[@]}" -- -X POST
check "PUT is refused" /index.html 405 -- -X PUT
check "HEAD is allowed" / 200 -- -I

if ! curl -s "$BASE/no-such-page" | grep -q "<title>Page not found"; then
  fail "404 responses use 404.html"
else
  pass "404 responses use 404.html"
fi

if ((failures)); then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "All Nginx checks passed"
