import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const outputDir = process.env.OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT || "test-results/playwright";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60 * 60 * 1000,
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
