/**
 * Mobile visual baselines for the public sign-in page at three
 * viewport widths called out in `feedback_embedded_mobile_design`:
 *   - 393 px (Pixel 5 / iPhone 14 Pro)
 *   - 375 px (iPhone SE / older iPhone width)
 *   - 320 px (iPhone 5 / smallest practical width)
 *
 * Same shape as `auth-signin.spec.ts` (desktop) — static page, no
 * auth, no dynamic data. Catches responsive layout regressions in
 * shared form components (AuthCard, TextField, PasswordField, Button).
 *
 * One test per width so a regression at e.g. 320 px doesn't mask
 * regressions at 393 px in the same run.
 */

import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "393", width: 393, height: 851 },
  { name: "375", width: 375, height: 667 },
  { name: "320", width: 320, height: 568 },
] as const;

test.describe("visual: /auth/sign-in (mobile)", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} px layout matches baseline`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const res = await page.goto("/auth/sign-in", {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      expect(res?.status()).toBe(200);

      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });

      await expect(page).toHaveScreenshot(`signin-mobile-${vp.name}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
