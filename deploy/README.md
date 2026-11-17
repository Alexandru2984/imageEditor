# Production deployment

imageeditor.micutu.com is a static build served by Nginx on this VPS:

```
Cloudflare → cloudflared tunnel (catch-all) → nginx 127.0.0.1:443
  → /etc/nginx/sites-available/imageeditor.micutu.com-canary
  → /srv/canary/imageeditor.micutu.com/current → releases/<id>/
```

The source lives in `/home/micu/imageEditor`. A commit is not live until it is
deployed with the script below.

## Deploying

From a clean, committed checkout:

```sh
./scripts/deploy.sh
```

The script takes an exclusive per-user lock, installs the locked dependency
graph with lifecycle scripts disabled, verifies registry signatures, and runs
the audit, lint, unit, typecheck, build and browser E2E gates. Set
`E2E_CHROMIUM_PATH` when Playwright's own Chromium is not installed.

The audit gate (`scripts/audit.mjs`) fails on any advisory at any
severity. The one exception is an entry in `scripts/audit-allowlist.json`
that has a written reason and an expiry date, and it only applies while the
advisory affects development tooling alone. Advisories in anything shipped to
browsers can never be allowlisted.

It then stages the build as a new release,
`releases/<UTC time>-<commit>/`, owned by root and read-only to the Nginx
worker. Hashed assets from the release being replaced are hard-linked into the
new one, so tabs opened before the deploy can still lazy-load their chunks and
the background-removal worker. Each carried asset is dropped once it has been
superseded for `ASSET_RETENTION_DAYS` (30 by default).
`releases/<id>.carried` records when each one was superseded.

`current` is switched with one atomic `rename(2)`, and the localhost origin
must then serve exactly the new `index.html` and every script and stylesheet it
references. If it does not, `current` goes back to the previous release and the
new one is deleted. The newest `KEEP_RELEASES` releases (5 by default) and the
rollback target are kept.

The first deploy on this VPS replaces the old in-place docroot, which was
owned by and writable to `www-data`. It does this with a single
`renameat2(RENAME_EXCHANGE)`, so there is no moment without a site. The old
tree is kept as `releases/00000000T000000Z-legacy` and made root-owned.

```sh
./scripts/deploy.sh --list       # releases on disk; * marks the live one
./scripts/deploy.sh --rollback   # back to the release before the live one
```

## Nginx

The site and its header snippet are versioned under `deploy/nginx/`:

```sh
./scripts/install-nginx.sh --check   # validate the repository copy only
./scripts/install-nginx.sh           # install, reload and verify
```

The installer backs up the active files under `/etc/nginx/backups/`, validates
the complete configuration and reloads without downtime. It then checks the
origin directly:
- security headers;
- `no-cache` on the index and `immutable` on hashed assets;
- a real 404 for unknown URLs and dotfiles;
- 405 for anything but GET and HEAD.

If any step fails, it restores the previous configuration.

Deploy before installing the Nginx site when both change: the new Content
Security Policy is stricter (`default-src 'none'`, model downloads pinned to
one Hugging Face revision) and assumes the current build.

What the site configuration guarantees:
- Every response carries the security headers in
  `snippets/imageeditor-headers.conf`: a strict CSP, cross-origin isolation
  (COOP/COEP/CORP), HSTS, `nosniff`, `DENY` framing, and a locked-down
  Permissions-Policy. Each location that adds a header includes the snippet
  again, because nginx otherwise drops the inherited headers.
- `/assets/*` (content-hashed) is cached for a year as `immutable`. The index
  and 404 page are `no-cache`. Other public files (icons, manifest, robots,
  sitemap) are cached for an hour.
- Unknown URLs get a real 404 with `404.html`, not the app with status 200.
- Dotfiles answer 404, request bodies are refused, and only GET and HEAD are
  allowed.

The preview server in `vite.config.ts` sends the same headers, so the E2E
suite exercises the production CSP. That includes a test asserting that
loading and editing raise no CSP violations.

## Cloudflare

Cloudflare features that rewrite HTML or inject scripts must stay disabled for
this hostname: Browser Insights, email obfuscation, Rocket Loader, and
challenge scripts on the app route. They conflict with the strict CSP by
design; do not add `script-src 'unsafe-inline'` to accommodate them.

Before any commercial deployment, resolve the BRIA model licensing requirement
documented in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
