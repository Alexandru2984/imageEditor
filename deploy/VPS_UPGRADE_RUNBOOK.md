# VPS upgrade runbook: Ubuntu 25.10 to 26.04 LTS

This runbook covers the shared production VPS that serves
`imageeditor.micutu.com`. It intentionally separates preparation, reversible
maintenance, the operating-system upgrade, and application deployment. Never
continue past a **NO-GO** gate merely because the current applications appear
healthy.

## Recommended migration strategy

The safest route is a rehearsal on a provider snapshot clone or a temporary
Ubuntu 26.04 VPS, followed by a controlled production cutover. The host runs a
large and diverse workload, so this is materially safer than discovering a
runtime incompatibility during an in-place upgrade.

If a clone is unavailable, an in-place upgrade is acceptable only with a full
provider snapshot, verified rescue-console access, restorable off-host data
backups, and an announced maintenance window.

## Observed baseline (2026-07-16 UTC)

- OpenStack/KVM VPS, Ubuntu 25.10, kernel `6.17.0-40-generic`.
- 290 GiB root filesystem with about 87 GiB free; `/boot` has about 680 MiB
  free.
- 45 GiB RAM with about 24 GiB available; swap is almost fully allocated and
  must be monitored, although this is not by itself evidence of current memory
  pressure.
- cgroup v2 is active, which satisfies Ubuntu 26.04's container requirement.
- No held packages, incomplete dpkg state, failed systemd units, or unhealthy
  Docker containers were observed.
- Approximately 80 running systemd services, including 46 custom services.
- Approximately 47-48 running Docker containers across nine Compose projects.
- Mailcow runs 18 containers and owns persistent mail, encryption, database,
  Redis, and index volumes. Its checkout has three local modifications that
  must be preserved and reviewed separately.
- Host databases include PostgreSQL 17, MariaDB 11.8, Redis 8, and multiple
  containerized PostgreSQL/MariaDB/Redis instances.
- Several services execute `/usr/bin/python3.13`; Ubuntu 26.04 changes the
  default Python to 3.14. Do not remove Python 3.13 or obsolete packages until
  all custom services pass post-upgrade checks.
- Ubuntu 26.04 changes PHP from 8.4 to 8.5. The `admin.micutu.com` and
  `php.micutu.com` Nginx sites currently reference the PHP 8.4 FPM socket.
- PostgreSQL 18 is the target Ubuntu series. Keep the PostgreSQL 17 cluster
  intact during the OS upgrade and perform its major-version migration as a
  separate, backed-up maintenance operation.
- The active APT configuration contains only Ubuntu repositories; the
  NodeSource repository is present but disabled.
- Several first-party repositories under `/home/micu` contain uncommitted or
  unpushed work. In particular, this editor is intentionally ahead of its
  remote, and other application repositories also have local-only state. A
  provider snapshot and protected off-host copy must preserve working trees;
  Git remotes alone are not a backup. No repository should be pushed merely as
  an upgrade precaution.
- SSH key authentication, UFW, Fail2ban, unattended upgrades, and Certbot are
  active. Docker-published ports still require a separate `DOCKER-USER` firewall
  review because Docker can bypass normal UFW expectations.

## Completed production upgrade (2026-07-16 UTC)

- Ubuntu 26.04 LTS is active on kernel `7.0.0-27-generic`; APT and dpkg are
  clean, no reboot is pending, and the provider snapshot from 03:20 UTC remains
  the host-level rollback point.
- PostgreSQL 18.4 is online on port 5432 with the migrated application data.
  PostgreSQL 17 remains preserved and offline on port 5434 as a rollback
  cluster. Do not delete it until the observation period and a fresh database
  backup are complete.
- PHP 8.5 FPM and the PHP extensions previously used by the host are installed.
  The active and canonical Nginx configurations for `admin.micutu.com` and
  `php.micutu.com` use `/run/php/php8.5-fpm.sock`.
- The Aichat, NVIDIA Chat, Brainfuck, COBOL, and Micu Market virtual
  environments remain on Python 3.13. Their internal interpreter links were
  pinned to `/usr/bin/python3.13`, and the Python 3.13 runtime packages were
  marked as manually installed so a future `apt autoremove` cannot remove them.
- The Lisp service permits writes only to its Common Lisp cache in addition to
  its existing application data paths. SBCL 2.6 compiled a fresh cache and the
  service is healthy under its existing sandbox.
- The abandoned Antigravity/Polyglot deployment, source tree, backup timer,
  certificate, stale Kubernetes logs, and portfolio entry were removed.
  `polyglot.micutu.com` still resolves through Cloudflare and its DNS record
  must be removed manually from the Cloudflare account.
- Post-upgrade validation reports zero failures: 47 Docker containers are
  running with no unhealthy containers, all 18 Mailcow containers are running,
  all 66 remaining Nginx hostnames respond without a 5xx error, and systemd has
  no failed units. The known dirty Mailcow checkout remains the sole warning.

## Hard NO-GO gates

Do not update packages or start `do-release-upgrade` until all of these are
true:

1. A full provider snapshot exists and its identifier/time is recorded.
2. The provider serial/rescue console has been opened and authentication tested.
3. A restorable copy of critical data exists off this VPS.
4. Mailcow has a fresh full backup, including `vmail`, `crypt`, `mysql`, Redis,
   Rspamd, and Postfix data.
5. Host PostgreSQL and MariaDB have fresh logical dumps.
6. Docker Compose files, bind-mounted configuration, `/etc`, Nginx, systemd
   units, certificates, application environment files, and local-only source
   working trees are backed up with restrictive permissions.
7. A maintenance window is active and mail/application users have been warned.
8. The preflight script reports zero failures.

The provider snapshot is the operating-system rollback. A logical/database
backup is the data rollback. Neither replaces the other.

## Read-only technical preflight

First refresh the sudo credential without changing the machine:

```sh
sudo -v
./scripts/vps-upgrade-check.sh pre
```

The script must fail while manual confirmations are absent. After independently
verifying every gate, rerun it with explicit confirmations:

```sh
PROVIDER_SNAPSHOT_CONFIRMED=1 \
RESCUE_CONSOLE_CONFIRMED=1 \
OFFHOST_BACKUP_CONFIRMED=1 \
MAINTENANCE_WINDOW_CONFIRMED=1 \
./scripts/vps-upgrade-check.sh pre
```

Never set a confirmation merely to make the script green.

## Backup preparation

Choose an encrypted destination on another machine or mounted provider storage;
do not keep the only backup on `/dev/sda1`. Record checksums, ownership, backup
time, and a restore command. Do not place backups, database dumps, private keys,
or environment files in this Git repository.

Use Mailcow's maintained helper from its original location:

```sh
MAILCOW_BACKUP_LOCATION=/path/to/off-host-storage \
  /opt/mailcow-dockerized/helper-scripts/backup_and_restore.sh backup all
```

Create logical dumps for the host PostgreSQL and MariaDB instances using a
root-only destination. Validate that the dumps are non-empty and can be listed
or parsed before proceeding. Container databases must be covered by their own
Compose-project backup or by a consistent volume/database backup.

Preserve the dirty Mailcow checkout as a protected archive. Do not reset or
overwrite it: one modified path is key material and must never be printed into
logs or committed.

## Compatibility work before the release upgrade

1. Record the installed PHP 8.4 modules so equivalent PHP 8.5 packages can be
   installed.
2. Prepare Nginx changes from `php8.4-fpm.sock` to `php8.5-fpm.sock`, but apply
   them only after PHP 8.5 is installed.
3. Record `pg_lsclusters`, PostgreSQL roles/extensions, and dump checksums. Do
   not delete the version 17 cluster during the release upgrade.
4. Capture the list and health of every Compose project and custom systemd
   service. Custom compiled binaries and Python virtual environments must be
   tested after the glibc/OpenSSL/Python transition.
5. Disable deployment webhooks and scheduled jobs that can modify application
   state during maintenance.
6. Keep the current firewall rules available from the rescue console. Do not
   redesign Docker networking during the OS upgrade.

## Maintenance sequence

Run the upgrade inside `tmux` from an existing SSH session while the provider
console remains open. Keep a second SSH session connected for observation.

1. Capture the final provider snapshot and off-host backups.
2. Run the confirmed preflight and stop on any failure.
3. Apply all available Ubuntu 25.10 package updates first.
4. Reboot into the fully updated 25.10 kernel if requested and rerun preflight.
5. Freeze custom application writers, background jobs, and deployment hooks.
6. Start `sudo do-release-upgrade` interactively. Record every configuration
   prompt. Preserve locally maintained SSH, Nginx, firewall, and service
   configuration for later three-way review; do not accept replacements blindly.
7. Do not agree to remove obsolete packages until the post-upgrade service
   inventory has passed. Python 3.13 and runtime libraries may still be required.
8. Reboot only after the upgrader finishes successfully and the console is
   ready.

If SSH, networking, the bootloader, storage, or Docker cannot be recovered
quickly from the provider console, stop and restore the provider snapshot.

## Post-upgrade recovery order

1. Confirm Ubuntu 26.04, networking, SSH keys, time sync, disk mounts, and UFW.
2. Validate package state and inspect failed units and the journal.
3. Validate Docker before starting or changing Compose projects.
4. Validate Mailcow DNS, SMTP, IMAP, delivery, TLS, queues, and all persistent
   volumes.
5. Install/validate PHP 8.5 FPM and equivalent modules, update the two Nginx
   socket references, then run `nginx -t` before reload.
6. Keep PostgreSQL 17 online on its original port. If PostgreSQL 18 was created,
   confirm ports and application connections; schedule `pg_upgradecluster` as a
   separate operation after another backup.
7. Start and verify custom systemd services in dependency order. Rebuild only
   the services that fail because of runtime or shared-library transitions.
8. Validate every Compose project, database, public hostname, certificate,
   backup timer, Fail2ban jail, and monitoring target.
9. Run the post-upgrade checker:

```sh
sudo -v
./scripts/vps-upgrade-check.sh post
```

Do not run `apt autoremove` and do not delete old kernels, Python 3.13, PHP
configuration, or the PostgreSQL 17 cluster until the host has remained healthy
through an observation period and backups have been refreshed.

## Image editor deployment after host stabilization

Only after the shared host is healthy:

```sh
cd /home/micu/imageEditor
./scripts/install-nginx.sh
./scripts/deploy.sh
```

Then verify the origin and Cloudflare responses, the exact deployed asset hash,
all browser security headers, upload/project/export flows, and the real AI model
test. These scripts include validation and rollback, but they do not replace the
host snapshot.

## Primary references

- [Ubuntu 26.04 release notes](https://documentation.ubuntu.com/release-notes/26.04/)
- [Changes from Ubuntu 25.10](https://documentation.ubuntu.com/release-notes/26.04/changes-since-previous-interim/)
- [Docker on Ubuntu and firewall caveats](https://docs.docker.com/engine/install/ubuntu/)
- [Mailcow backup documentation](https://docs.mailcow.email/backup_restore/b_n_r-backup/)
