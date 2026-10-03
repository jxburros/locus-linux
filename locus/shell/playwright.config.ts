import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/*
 * Real-browser integration tests (stabilization Wave 4). jsdom cannot exercise
 * the Dev sandbox iframe/Worker, multi-tab storage races, or the service-worker
 * offline launch — these run in a real Chromium against two servers:
 *
 *  - the Vite DEV server (4173): serves and transpiles Core ES modules
 *    (resolving the `@/` alias), so sandbox.spec and multitab.spec drive real
 *    Core source directly, with no test-only harness in the production bundle;
 *  - the production PREVIEW (4174): the only build where the service worker
 *    registers, for pwa.spec's offline-launch gate.
 *
 * The environment ships a Playwright-managed Chromium under
 * PLAYWRIGHT_BROWSERS_PATH and blocks re-downloads; this never calls
 * `playwright install`.
 */

const DEV = "http://localhost:4173/locus-os/";

// Locally, the environment provisions a full Chromium under
// PLAYWRIGHT_BROWSERS_PATH but blocks re-downloads, and the pinned build may
// differ from the installed @playwright/test's expected revision — so point
// launch straight at the provisioned binary. On CI (GitHub Actions), that
// path does not exist; `playwright install chromium` provides a managed
// browser and `executablePath: undefined` uses it.
const PINNED = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const CHROMIUM =
  PINNED && existsSync(PINNED)
    ? PINNED
    : existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
      ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
      : undefined;
const launchOptions = { args: ["--no-sandbox"], executablePath: CHROMIUM };

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: DEV,
    headless: true,
    launchOptions,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 4173 --strictPort",
      url: DEV,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run build && npm run preview -- --port 4174 --strictPort",
      url: "http://localhost:4174/locus-os/",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
