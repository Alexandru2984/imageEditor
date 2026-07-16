# Production deployment

The shared host must run a supported operating system before application
deployment. For the Ubuntu 25.10 to 26.04 LTS migration, follow the gated
[`VPS_UPGRADE_RUNBOOK.md`](VPS_UPGRADE_RUNBOOK.md) and its read-only pre/post
checker. Do not combine the operating-system migration with an editor release.

The complete production Nginx site and its private snippets are versioned under
`deploy/nginx/`. Apply them explicitly from the repository root:

```sh
./scripts/install-nginx.sh
```

The installer backs up both active files, validates the complete Nginx graph,
reloads without stopping the server, checks the headers directly against the
localhost origin, and restores the previous configuration on failure.
Validate without installing or reloading with `./scripts/install-nginx.sh --check`.

Deploy a clean, committed revision with:

```sh
./scripts/deploy.sh
```

The deploy script takes an exclusive per-user lock, performs a locked install
with lifecycle scripts disabled, verifies registry signatures, runs the
vulnerability, unit, build, and browser E2E gates, then copies hashed assets
before atomically publishing `index.html`. Site files are root-owned and
read-only to the Nginx worker. The script verifies the localhost origin and
rolls the index back if that smoke test fails. It keeps old hashed assets for 35
days by default, slightly longer than their 30-day browser cache lifetime.
Override retention only when necessary, for example
`ASSET_RETENTION_DAYS=60 ./scripts/deploy.sh`.

Cloudflare features that rewrite HTML or inject scripts (including Browser
Insights, email obfuscation, Rocket Loader, or challenge scripts on the app
route) must remain disabled for this hostname. They conflict with the strict
CSP by design; do not add `script-src 'unsafe-inline'` to accommodate them.

Before any commercial deployment, resolve the BRIA model licensing requirement
documented in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
