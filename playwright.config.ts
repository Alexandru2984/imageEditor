import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dev server. Chromium: set E2E_CHROMIUM_PATH to a browser
// binary (this repo's CI/dev machine has one cached), otherwise Playwright uses
// its own managed download (`npx playwright install chromium`).
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "on-first-retry",
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    // A fixed, rarely-used port with strictPort so the dev server never drifts
    // to another port (this machine has many services on 8080+).
    command: "npm run dev -- --host 127.0.0.1 --port 5199 --strictPort",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
