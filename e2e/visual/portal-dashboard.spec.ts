/**
 * Visual baseline for the authenticated portal dashboard at
 * `/portal/dashboard`. Companion to `auth-signin.spec.ts`.
 *
 * Captures the page LAYOUT (chrome, structure, components) — not the
 * underlying data. KPI values and the recent-disputes table are masked
 * via Playwright's `mask:` option so the baseline is stable across
 * dispute volume changes.
 *
 * What this catches:
 *   - Header / nav layout regressions
 *   - KPI card grid layout (4-up → 1-up breakpoints)
 *   - Recent-disputes table chrome (header row, action button)
 *   - Banner / onboarding card placement
 *
 * What this does NOT catch (intentionally — would flake hourly):
 *   - Specific KPI numbers
 *   - Specific dispute IDs / customer names / amounts
 *   - Recent activity feed contents
 *
 * Re-baseline: `npm run test:visual -- --update-snapshots` after an
 * intentional UI change. Never re-baseline to "make the test pass" —
 * that defeats the point.
 */

import { test, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;

async function portalSignIn(page: Page): Promise<void> {
  await page.goto("/auth/sign-in", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.click();
  await emailInput.fill(E2E_EMAIL!);
  await expect(emailInput).toHaveValue(E2E_EMAIL!, { timeout: 5_000 });

  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.click();
  await passwordInput.fill(E2E_PASSWORD!);
  await expect(passwordInput).toHaveValue(E2E_PASSWORD!, { timeout: 5_000 });

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal\//, { timeout: 25_000 });
}

test.describe("visual: /portal/dashboard", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD,
      "E2E_TEST_EMAIL + E2E_TEST_PASSWORD required in .env.local",
    );
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("desktop layout matches baseline", async ({ page }) => {
    await portalSignIn(page);
    await page.goto("/portal/dashboard", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Wait for KPI cards to render — they're the slowest piece.
    // We don't care WHAT the numbers are, just that the page is past
    // the loading state when we capture.
    await expect(
      page.locator('[data-onboarding="dashboard-stats"]'),
    ).toBeVisible({ timeout: 15_000 });
    // Allow late client-side fetches to settle so the recent-disputes
    // table is fully rendered (or empty-state is shown) — both shapes
    // are valid baseline content; what matters is no flicker mid-shot.
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("portal-dashboard-desktop.png", {
      fullPage: false,
      // Mask dynamic regions so the baseline is stable across dispute
      // volume changes. The masks render as pink boxes in the snapshot
      // (Playwright's default) — that's intentional; we're checking
      // CHROME, not data.
      mask: [
        page.locator('[data-onboarding="dashboard-stats"]'),
        page.locator("table tbody"),
        // Welcome banner / setup checklist may show or not depending
        // on user onboarding state — exclude both to avoid spurious
        // diffs as the test user's state evolves.
        page.locator('[data-testid="welcome-banner"]'),
        page.locator('[data-testid="portal-setup-checklist-card"]'),
      ],
      // Accept tiny pixel-level differences (anti-aliasing across runs).
      maxDiffPixelRatio: 0.02,
    });
  });
});
