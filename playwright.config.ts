import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

/**
 * Playwright E2E config for DisputeDesk.
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env.local for portal auth tests.
 * Test user must have at least one connected shop (portal_user_shops).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3099",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer:
    process.env.PLAYWRIGHT_BASE_URL && !process.env.CI
      ? undefined
      : {
          command: "npx next dev -p 3099",
          url: "http://localhost:3099",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
});
