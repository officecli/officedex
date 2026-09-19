import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const outputDir = process.env.OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT || "test-results/playwright";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  /*
   * Five minutes, not an hour.
   *
   * This was `60 * 60 * 1000`, which meant a test that hung — waiting on a menu
   * that never opened, or a click intercepted by an element laid over its
   * target — burned a full hour before anyone was told. Two of those happened
   * during the 2026-09 UI audit, and both read as "still running" rather than
   * as a failure.
   *
   * The real-bridge suites are the slow ones (they build documents), and the
   * slowest observed case is well under two minutes. Override per-test with
   * `test.setTimeout()` where a case genuinely needs longer, so the exception
   * is visible at the case rather than hidden in the config.
   */
  timeout: 5 * 60 * 1000,
  expect: {
    timeout: 60 * 1000,
  },
  outputDir,
  reporter: process.env.OFFICEDEX_E2E_JSON_REPORT
    ? [["json", { outputFile: process.env.OFFICEDEX_E2E_JSON_REPORT }], ["list"]]
    : "list",
  use: {
    ...devices["Desktop Chrome"],
    ...(process.env.PLAYWRIGHT_CHROME_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL }
      : {}),
    baseURL,
    actionTimeout: 60 * 1000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
