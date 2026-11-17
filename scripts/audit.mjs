#!/usr/bin/env node
// Dependency audit gate (npm run audit).
//
// Fails on any advisory, at any severity, with two narrow exceptions listed in
// scripts/audit-allowlist.json. An allowlisted advisory passes only while
// - it affects development dependencies alone (nothing shipped to browsers),
// - and its entry has not expired.
// Advisories in production dependencies can never be allowlisted. If the
// registry cannot be reached the gate fails closed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowlist = JSON.parse(readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);

function audit(extraArgs) {
  let output;
  try {
    output = execFileSync("npm", ["audit", "--json", ...extraArgs], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // npm exits non-zero when it finds advisories; the report is still on stdout.
    output = error.stdout;
  }
  const report = JSON.parse(output || "{}");
  if (!report.vulnerabilities) {
    throw new Error(`npm audit returned no report: ${report.error?.summary ?? "unknown error"}`);
  }
  const advisories = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    for (const via of entry.via) {
      if (typeof via !== "object") continue;
      const id = String(via.url ?? via.source).split("/").pop();
      advisories.set(id, { id, name, severity: via.severity, title: via.title, range: via.range });
    }
  }
  return advisories;
}

const all = audit([]);
const production = audit(["--omit=dev"]);
const failures = [];
const allowed = [];

for (const advisory of all.values()) {
  const label = `${advisory.id} ${advisory.severity} ${advisory.name}${advisory.range ? ` ${advisory.range}` : ""}: ${advisory.title}`;
  if (production.has(advisory.id)) {
    failures.push(`${label} (shipped to browsers; cannot be allowlisted)`);
    continue;
  }
  const entry = allowlist.find((candidate) => candidate.id === advisory.id);
  if (!entry) {
    failures.push(label);
  } else if (!(entry.expires >= today)) {
    failures.push(`${label} (allowlist entry expired on ${entry.expires}; re-review it)`);
  } else {
    allowed.push(`${label}\n    allowed until ${entry.expires}: ${entry.reason}`);
  }
}

for (const entry of allowlist) {
  if (!all.has(entry.id)) {
    console.log(`note: ${entry.id} no longer appears in npm audit; remove it from scripts/audit-allowlist.json`);
  }
}
if (allowed.length) {
  console.log(`Allowlisted development-only advisories (${allowed.length}):`);
  for (const line of allowed) console.log(`  ${line}`);
}
if (failures.length) {
  console.error(`npm audit found ${failures.length} advisory(ies) that block this build:`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`Audit passed: no production advisories, ${all.size} total, ${allowed.length} allowlisted.`);
