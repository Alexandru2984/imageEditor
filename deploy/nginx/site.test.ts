import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const snippet = read("./snippets/imageeditor-headers.conf");
const site = read("./sites-available/imageeditor.micutu.com-canary");

const productionHeaders = new Map(
  [...snippet.matchAll(/^add_header ([\w-]+) "([^"]*)" always;$/gm)].map(([, name, value]) => [
    name!.toLowerCase(),
    value!,
  ])
);

/** Top-level `location ... { ... }` blocks of the HTTPS server, with their bodies. */
function locationBlocks(config: string): Array<{ match: string; body: string }> {
  const blocks: Array<{ match: string; body: string }> = [];
  const pattern = /^ {4}location ([^{]+)\{/gm;
  for (const found of config.matchAll(pattern)) {
    let depth = 1;
    let index = found.index! + found[0].length;
    const start = index;
    while (depth > 0 && index < config.length) {
      if (config[index] === "{") depth += 1;
      if (config[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ match: found[1]!.trim(), body: config.slice(start, index - 1) });
  }
  return blocks;
}

describe("production Nginx site", () => {
  it("sends every header the E2E preview server is tested with, unchanged", () => {
    const preview = viteConfig.preview?.headers ?? {};
    expect(Object.keys(preview).length).toBeGreaterThan(5);
    for (const [name, value] of Object.entries(preview)) {
      expect(productionHeaders.get(name.toLowerCase()), name).toBe(value);
    }
  });

  it("adds HSTS in production", () => {
    expect(productionHeaders.get("strict-transport-security")).toMatch(/max-age=\d{8,}/);
  });

  it("re-includes the security headers wherever a location adds its own", () => {
    // nginx drops every inherited add_header in a block that declares one.
    const blocks = locationBlocks(site);
    expect(blocks.length).toBeGreaterThan(4);
    for (const block of blocks) {
      if (/\badd_header\b/.test(block.body)) {
        expect(block.body, `location ${block.match}`).toContain(
          "include snippets/imageeditor-headers.conf;"
        );
      }
    }
  });

  it("caches only content-hashed assets as immutable", () => {
    for (const block of locationBlocks(site)) {
      if (block.body.includes("immutable")) expect(block.match).toBe("^~ /assets/");
    }
  });

  it("has no SPA fallback that would turn missing files into 200 responses", () => {
    expect(site).not.toMatch(/try_files[^;]*\/index\.html;/);
    expect(site).toContain("error_page 404 /404.html;");
  });
});
