/**
 * Smoke check that every public legal/support route returns 200 and
 * renders its expected `<h1>` title.
 *
 * Closes a regression class that almost shipped: middleware was routing
 * `/privacy` through next-intl, which produced a 404 against the new
 * app/(marketing)/privacy/page.tsx. Build / lint / tsc / vitest all
 * pass without catching middleware-runtime routing — only Playwright
 * actually hits the URL and sees what comes back.
 *
 * No auth required; pages are public.
 */

import { test, expect } from "@playwright/test";

const ROUTES: Array<{ path: string; expectedHeading: string }> = [
  { path: "/privacy", expectedHeading: "Privacy Policy" },
  { path: "/terms", expectedHeading: "Terms of Service" },
  { path: "/security", expectedHeading: "Security" },
  { path: "/data-retention", expectedHeading: "Data Retention" },
  { path: "/support", expectedHeading: "Support" },
];

test.describe("public legal/support routes", () => {
  for (const { path, expectedHeading } of ROUTES) {
    test(`${path} returns 200 and renders its title`, async ({ page }) => {
      const res = await page.goto(path, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      expect(
        res?.status(),
        `${path} returned ${res?.status()} — middleware regression?`,
      ).toBe(200);

      // Each LegalPageLayout renders a single <h1> with the page title.
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      await expect(heading).toHaveText(expectedHeading);
    });
  }
});
