import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests live next to the code in src/, and next to the Nginx site in
// deploy/. The Playwright E2E specs under tests/e2e are run by Playwright, not
// vitest, so they're excluded here.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts", "deploy/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/lib/fabricDefaults.ts"],
  },
});
