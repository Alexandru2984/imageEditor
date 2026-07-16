#!/usr/bin/env bash
# Read-only readiness and health checks for the shared production VPS.
# This script never installs packages, changes configuration, or restarts a
# service. In pre-upgrade mode it deliberately fails until the four manual
# safety confirmations are supplied by the operator.
set -u -o pipefail
umask 077

readonly MODE="${1:-pre}"
if [[ "$MODE" != "pre" && "$MODE" != "post" ]]; then
  echo "Usage: $0 [pre|post]" >&2
  exit 2
fi

if (( EUID == 0 )); then
  SUDO=()
else
  SUDO=(sudo -n)
fi

errors=0
warnings=0

pass() {
  echo "PASS  $*"
}

warn() {
  echo "WARN  $*" >&2
  warnings=$((warnings + 1))
}

fail() {
  echo "FAIL  $*" >&2
  errors=$((errors + 1))
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi
  fail "Required command is missing: $1"
  return 1
}

check_active() {
  if systemctl is-active --quiet "$1"; then
    pass "$1 is active"
  else
    fail "$1 is not active"
  fi
}

require_confirmation() {
  local variable=$1
  local description=$2
  if [[ "${!variable:-}" == "1" ]]; then
    pass "$description is confirmed"
  else
    fail "$description is not confirmed (set $variable=1 only after verification)"
  fi
}

echo "VPS upgrade check: $MODE"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "$MODE" == "pre" && "${VERSION_ID:-}" == "25.10" ]]; then
    pass "Source release is Ubuntu 25.10"
  elif [[ "$MODE" == "post" && "${VERSION_ID:-}" == "26.04" ]]; then
    pass "Target release is Ubuntu 26.04"
  else
    fail "Unexpected OS release for $MODE mode: ${PRETTY_NAME:-unknown}"
  fi
else
  fail "Cannot read /etc/os-release"
fi

if [[ -e /sys/fs/cgroup/cgroup.controllers ]]; then
  pass "cgroup v2 is active"
else
  fail "cgroup v2 is not active; Ubuntu 26.04 cannot run this container workload"
fi

root_available_mib=$(df -Pm / | awk 'NR == 2 { print $4 }')
boot_available_mib=$(df -Pm /boot | awk 'NR == 2 { print $4 }')
if [[ "$root_available_mib" =~ ^[0-9]+$ ]] && (( root_available_mib >= 20480 )); then
  pass "Root filesystem has at least 20 GiB free (${root_available_mib} MiB)"
else
  fail "Root filesystem needs at least 20 GiB free (${root_available_mib:-unknown} MiB)"
fi
if [[ "$boot_available_mib" =~ ^[0-9]+$ ]] && (( boot_available_mib >= 400 )); then
  pass "/boot has at least 400 MiB free (${boot_available_mib} MiB)"
else
  fail "/boot needs at least 400 MiB free (${boot_available_mib:-unknown} MiB)"
fi

read -r swap_total swap_used < <(free -m | awk '/^Swap:/ { print $2, $3 }')
if [[ "$swap_total" =~ ^[0-9]+$ ]] && (( swap_total > 0 && swap_used * 100 / swap_total >= 90 )); then
  warn "Swap usage is at least 90% (${swap_used}/${swap_total} MiB); inspect memory pressure"
else
  pass "Swap is below the 90% warning threshold"
fi

failed_units=$(systemctl list-units --failed --no-legend --plain --no-pager | awk '$1 ~ /\.(service|socket|mount|timer)$/ { count++ } END { print count + 0 }')
if (( failed_units == 0 )); then
  pass "systemd has no failed units"
else
  fail "systemd has $failed_units failed unit(s)"
fi

dpkg_audit=$(dpkg --audit 2>&1)
if [[ -z "$dpkg_audit" ]]; then
  pass "dpkg reports no incomplete package state"
else
  fail "dpkg reports an incomplete package state"
fi

package_holds=$(apt-mark showhold 2>/dev/null | awk 'NF { count++ } END { print count + 0 }')
if (( package_holds == 0 )); then
  pass "APT has no held packages"
else
  fail "APT has $package_holds held package(s)"
fi

pending_updates=$(apt list --upgradable 2>/dev/null | tail -n +2 | awk 'NF { count++ } END { print count + 0 }')
if (( pending_updates == 0 )); then
  pass "The current package index reports no pending upgrades"
elif [[ "$MODE" == "pre" ]]; then
  fail "$pending_updates package upgrade(s) must be applied before the release upgrade"
else
  warn "$pending_updates package upgrade(s) remain after the release upgrade"
fi

if [[ -e /run/reboot-required ]]; then
  fail "A reboot is already required"
else
  pass "No reboot is currently pending"
fi

for service in ssh nginx docker mariadb postgresql redis-server coturn fail2ban; do
  check_active "$service.service"
done
if [[ "$MODE" == "pre" ]]; then
  check_active "php8.4-fpm.service"
else
  check_active "php8.5-fpm.service"
fi

if "${SUDO[@]}" true >/dev/null 2>&1; then
  pass "Non-interactive administrative access is available"
else
  fail "Administrative access is unavailable; run sudo -v before this check"
fi

if require_command nginx && "${SUDO[@]}" nginx -t >/dev/null 2>&1; then
  pass "Nginx configuration is valid"
else
  fail "Nginx configuration validation failed"
fi
if require_command sshd && "${SUDO[@]}" sshd -t >/dev/null 2>&1; then
  pass "OpenSSH server configuration is valid"
else
  fail "OpenSSH server configuration validation failed"
fi

ufw_status=$("${SUDO[@]}" ufw status 2>/dev/null | sed -n '1p')
if [[ "$ufw_status" == "Status: active" ]]; then
  pass "UFW is active"
else
  fail "UFW is not active"
fi

if require_command docker && "${SUDO[@]}" docker info >/dev/null 2>&1; then
  docker_running=$("${SUDO[@]}" docker ps -q | awk 'NF { count++ } END { print count + 0 }')
  docker_unhealthy=$("${SUDO[@]}" docker ps --filter health=unhealthy -q | awk 'NF { count++ } END { print count + 0 }')
  docker_cgroup=$("${SUDO[@]}" docker info --format '{{.CgroupVersion}}' 2>/dev/null)
  pass "Docker is reachable with $docker_running running container(s)"
  if (( docker_unhealthy == 0 )); then
    pass "Docker has no unhealthy containers"
  else
    fail "Docker has $docker_unhealthy unhealthy container(s)"
  fi
  if [[ "$docker_cgroup" == "2" ]]; then
    pass "Docker uses cgroup v2"
  else
    fail "Docker does not report cgroup v2"
  fi

  mailcow_total=$("${SUDO[@]}" docker ps -a --filter name=mailcowdockerized -q | awk 'NF { count++ } END { print count + 0 }')
  mailcow_running=$("${SUDO[@]}" docker ps --filter name=mailcowdockerized -q | awk 'NF { count++ } END { print count + 0 }')
  if (( mailcow_total > 0 && mailcow_total == mailcow_running )); then
    pass "All $mailcow_running Mailcow containers are running"
  else
    fail "Mailcow container state differs: $mailcow_running running of $mailcow_total total"
  fi
fi

if [[ -d /opt/mailcow-dockerized/.git ]]; then
  mailcow_changes=$("${SUDO[@]}" git -C /opt/mailcow-dockerized status --porcelain 2>/dev/null | awk 'NF { count++ } END { print count + 0 }')
  if (( mailcow_changes == 0 )); then
    pass "Mailcow checkout is clean"
  else
    warn "Mailcow has $mailcow_changes tracked/untracked change(s); preserve and review them before maintenance"
  fi
fi

if require_command pg_lsclusters; then
  offline_clusters=$(pg_lsclusters -h | awk '$4 != "online" { count++ } END { print count + 0 }')
  online_clusters=$(pg_lsclusters -h | awk '$4 == "online" { count++ } END { print count + 0 }')
  if (( offline_clusters == 0 && online_clusters > 0 )); then
    pass "All $online_clusters PostgreSQL cluster(s) are online"
  else
    fail "PostgreSQL cluster state is not fully online"
  fi
fi

nginx_dump=$("${SUDO[@]}" nginx -T 2>/dev/null || true)
legacy_php_refs=$(grep -c 'php8\.4-fpm' <<<"$nginx_dump" || true)
if [[ "$MODE" == "pre" && "$legacy_php_refs" -gt 0 ]]; then
  warn "Nginx contains $legacy_php_refs PHP 8.4 socket reference(s); migrate them during maintenance"
elif [[ "$MODE" == "post" && "$legacy_php_refs" -gt 0 ]]; then
  fail "Nginx still contains $legacy_php_refs PHP 8.4 socket reference(s)"
else
  pass "Nginx has no obsolete PHP 8.4 socket references"
fi

if require_command curl && curl --fail --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  --resolve imageeditor.micutu.com:443:127.0.0.1 \
  https://imageeditor.micutu.com/ >/dev/null; then
  pass "Image editor origin responds over HTTPS"
else
  fail "Image editor origin HTTPS check failed"
fi

if [[ "$MODE" == "pre" ]]; then
  release_check=$("${SUDO[@]}" do-release-upgrade -c 2>&1 || true)
  if grep -q "New release '26.04 LTS' available" <<<"$release_check"; then
    pass "Ubuntu 26.04 LTS is offered by the release upgrader"
  else
    fail "Ubuntu 26.04 LTS is not currently offered by the release upgrader"
  fi

  require_confirmation PROVIDER_SNAPSHOT_CONFIRMED "Provider snapshot"
  require_confirmation RESCUE_CONSOLE_CONFIRMED "Provider rescue/serial console access"
  require_confirmation OFFHOST_BACKUP_CONFIRMED "Restorable off-host data backup"
  require_confirmation MAINTENANCE_WINDOW_CONFIRMED "Maintenance window"
fi

echo
echo "Summary: $errors failure(s), $warnings warning(s)"
if (( errors > 0 )); then
  exit 1
fi
