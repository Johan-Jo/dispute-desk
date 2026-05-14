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
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (already in .env.local
 *     for production code paths — used here for seed/cleanup via the
 *     Supabase REST API)
 *   - The test user must have at least one connected shop (portal_user_shops)
 *
 * The spec skips when E2E credentials are unset — no-ops in environments
 * without portal auth configured.
 *
 * Cleanup happens unconditionally in `finally` so a crashed test does
 * NOT leave orphan rows in the test database.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  openSb,
  seedReadyPackForUser,
  readPackStatus,
  countJobsForPack,
} from "./helpers/dbFixtures";

// Single test combines seed (Supabase REST) + sign-in (Playwright form)
// + POST + cleanup. Each phase has its own timeout, so the per-test
// budget needs headroom for the sum. Matches portal-sections.spec.ts.
test.setTimeout(60_000);

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function portalSignIn(page: Page): Promise<void> {
  await page.goto("/auth/sign-in", {
    // networkidle (not just domcontentloaded) ensures React has
    // hydrated. Without it, fill() can race the controlled-input
    // setState call and the value silently doesn't stick.
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.click();
  await emailInput.fill(E2E_EMAIL!);
  // Verify the value actually landed — surfaces hydration races early.
  await expect(emailInput).toHaveValue(E2E_EMAIL!, { timeout: 5_000 });

  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.click();
  await passwordInput.fill(E2E_PASSWORD!);
  await expect(passwordInput).toHaveValue(E2E_PASSWORD!, { timeout: 5_000 });

  await page.getByRole("button", { name: "Sign in" }).click();

  // Race the navigation against the sign-in-error testid so a bad
  // credential surfaces as a useful message instead of a generic timeout.
  const result = await Promise.race([
    page.waitForURL(/\/portal\//, { timeout: 25_000 }).then(() => "portal" as const),
    page
      .getByTestId("sign-in-error")
      .waitFor({ state: "visible", timeout: 25_000 })
      .then(() => "error" as const),
  ]).catch(() => null);

  if (result === "error") {
    const msg = await page.getByTestId("sign-in-error").first().textContent();
    throw new Error(`Sign-in failed: "${msg?.trim() ?? "unknown"}"`);
  }
  if (result !== "portal") {
    throw new Error("Sign-in did not redirect to portal and no error appeared");
  }
}

test.describe("POST /api/packs/:packId/save-to-shopify — seeded happy path", () => {
  test.beforeEach(async () => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD || !SB_URL || !SB_KEY,
      "Seeded happy path requires E2E_TEST_EMAIL, E2E_TEST_PASSWORD, " +
        "SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  });

  test("returns 202, enqueues a save_to_shopify job, and flips the pack to 'saving'", async ({
    page,
    baseURL,
  }) => {
    const conn = openSb();
    const seeded = await seedReadyPackForUser(conn, E2E_EMAIL!);

    try {
      // The route's first guard (security commit 3e8317f, B4) refuses
      // shopId === "demo" with 401 SHOP_CONTEXT_REQUIRED. Middleware's
      // portal fallback injects "demo" when no `dd_active_shop` cookie
      // is set, so plant the cookie before signing in so the request
      // carries the real shop id the seeded pack belongs to.
      const url = new URL(baseURL ?? "http://localhost:3000");
      const shopCookie = {
        name: "dd_active_shop",
        value: seeded.ids.shopId,
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        secure: url.protocol === "https:",
        sameSite: "Lax" as const,
      };
      await page.context().addCookies([shopCookie]);

      await portalSignIn(page);

      // Re-plant after sign-in. The portal layout reads dd_active_shop
      // and, when missing for a user with linked shops, can navigate to
      // /portal/select-store which sets its own cookie. Re-asserting
      // our value after sign-in guarantees the POST below sees the seed's
      // shopId regardless of what the portal landing flow did.
      await page.context().addCookies([shopCookie]);

      // Sanity: the seed actually persisted as "ready" before we hit
      // the route. If this fails, the seed helper has drifted away
      // from the schema.
      expect(await readPackStatus(conn, seeded.ids.packId)).toBe("ready");

      // Sanity: the cookie we planted at the start of the test survived
      // sign-in. Supabase Auth Set-Cookie can clear or partition the
      // jar; without `dd_active_shop` the middleware portal fallback
      // injects "demo" and the route's first guard returns 401
      // SHOP_CONTEXT_REQUIRED — the exact symptom that's been recurring
      // in CI. Capture the cookie state so the next failure is
      // diagnostic instead of opaque.
      const cookiesAfterSignIn = await page.context().cookies();
      const ddActiveShopCookie = cookiesAfterSignIn.find(
        (c) => c.name === "dd_active_shop",
      );
      expect(
        ddActiveShopCookie?.value,
        `dd_active_shop cookie missing after sign-in. Jar contained: ${cookiesAfterSignIn
          .map((c) => c.name)
          .join(", ")}`,
      ).toBe(seeded.ids.shopId);

      const res = await page.request.post(
        `/api/packs/${seeded.ids.packId}/save-to-shopify`,
        { data: {}, failOnStatusCode: false },
      );

      const responseBody = await res.text();
      expect(
        res.status(),
        `unexpected status ${res.status()} from save-to-shopify on a ` +
          `ready pack with completeness_score=92. ` +
          `Response body: ${responseBody}. ` +
          `dd_active_shop cookie value at POST time: ${ddActiveShopCookie?.value ?? "MISSING"}`,
      ).toBe(202);

      const body = JSON.parse(responseBody);
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
    }
  });
});
