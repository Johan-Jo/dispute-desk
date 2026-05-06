/**
 * Visual baseline for the public sign-in page.
 *
 * This page has no dynamic content and no auth requirement, which makes
 * it the safest first surface to visual-regress. Layout / spacing / brand
 * regressions in shared components (AuthCard, Button, TextField) will
 * trip this test before they ship.
 */

import { test, expect } from "@playwright/test";

test.describe("visual: /auth/sign-in", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("desktop layout matches baseline", async ({ page }) => {
    const res = await page.goto("/auth/sign-in", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    expect(res?.status()).toBe(200);

    // Make sure the form is fully painted before snapshotting.
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("signin-desktop.png", {
      fullPage: false,
      // Default threshold is fine for a static page; we keep it explicit
      // so future maintainers see what the gate is.
      maxDiffPixelRatio: 0.01,
    });
  });
});
