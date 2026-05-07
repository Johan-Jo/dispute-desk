/**
 * Seeded happy-path Playwright spec for POST /api/packs/:id/save-to-shopify.
 *
 * Extends `e2e/save-to-shopify.spec.ts` (which only covered the 404 +
 * 401 gates) with the success path: real pack at status="ready", real
 * dispute with `dispute_evidence_gid`, expect 202 + jobs row inserted +
 * pack flipped to "saving".
 *
 * Closes backlog item 1 from RELEASE_TESTING_PLAN.md §12.
 *
 * Requirements:
 *   - E2E_TEST_EMAIL + E2E_TEST_PASSWORD (Supabase Auth credentials)
 *   - SUPABASE_URL_POSTGRES (direct Postgres access for seed/cleanup)
 *   - The test user must have at least one connected shop (portal_user_shops)
 *
 * The spec skips when any of the above are unset — runs in CI/staging
 * where the env is configured, no-ops elsewhere.
 *
 * Cleanup happens in afterEach unconditionally so a crashed test does
 * NOT leave orphan rows in the test database. The pg connection is
 * also closed in afterEach.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  openPg,
  seedReadyPackForUser,
  readPackStatus,
  countJobsForPack,
} from "./helpers/dbFixtures";

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;
const PG_URL = process.env.SUPABASE_URL_POSTGRES;

async function portalSignIn(page: Page): Promise<void> {
  await page.goto("/auth/sign-in", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.fill(E2E_EMAIL!);

  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.fill(E2E_PASSWORD!);

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal\//, { timeout: 25_000 });
}

test.describe("POST /api/packs/:packId/save-to-shopify — seeded happy path", () => {
  test.beforeEach(async () => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD || !PG_URL,
      "Seeded happy path requires E2E_TEST_EMAIL, E2E_TEST_PASSWORD, " +
        "and SUPABASE_URL_POSTGRES in .env.local",
    );
  });

  test("returns 202, enqueues a save_to_shopify job, and flips the pack to 'saving'", async ({
    page,
  }) => {
    const conn = await openPg();
    const seeded = await seedReadyPackForUser(conn, E2E_EMAIL!);

    try {
      await portalSignIn(page);

      // Sanity: the seed actually persisted as "ready" before we hit
      // the route. If this fails, the seed helper has drifted away
      // from the schema.
      expect(await readPackStatus(conn, seeded.ids.packId)).toBe("ready");

      const res = await page.request.post(
        `/api/packs/${seeded.ids.packId}/save-to-shopify`,
        { data: {}, failOnStatusCode: false },
      );

      expect(
        res.status(),
        `unexpected status ${res.status()} from save-to-shopify on a ` +
          "ready pack with completeness_score=92",
      ).toBe(202);

      const body = await res.json();
      expect(body).toMatchObject({ queued: true, packId: seeded.ids.packId });

      // Side effect 1: a save_to_shopify job row was inserted for the
      // pack. The route enqueues; the worker (not exercised here) is
      // what would actually call Shopify.
      expect(
        await countJobsForPack(conn, seeded.ids.packId, "save_to_shopify"),
      ).toBeGreaterThanOrEqual(1);

      // Side effect 2: the pack status was flipped to "saving" so the
      // UI doesn't let a second submit through while the worker runs.
      expect(await readPackStatus(conn, seeded.ids.packId)).toBe("saving");
    } finally {
      await seeded.cleanup();
      await conn.end();
    }
  });
});
