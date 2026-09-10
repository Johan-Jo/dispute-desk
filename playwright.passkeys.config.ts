import { defineConfig } from "@playwright/test";

// Isolated component/ceremony checks: no Next server, credentials, or live DB.
export default defineConfig({
  testDir: "./e2e/passkeys",
  testMatch: "*.spec.ts",
  use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL },
  reporter: "list",
});
