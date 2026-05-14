/**
 * Route-level Playwright spec for POST /api/packs/:packId/save-to-shopify.
 *
 * Closes the CI half of the gap from RELEASE_TESTING_PLAN.md §12 — "the
 * merchant clicks Save → server runs end-to-end" — without touching
 * auth code or the embedded `/app/*` surface.
 *
 * Approach: re-uses the same Supabase Auth sign-in path as
 * `e2e/portal-sections.spec.ts` (browser-driven, sets cookies), then
 * uses the authenticated `page.request` context to POST directly to
 * the API. No `/app/*` rendering, no Shopify session token, no Shopify
 * mutation — just middleware → route → service-client gate validation.
 *
 * What this spec catches that the unit/integration suite cannot:
 *   - middleware.ts portal fallback for /api/packs/* breaks
 *     (e.g. accidental removal from PORTAL_API_PREFIXES)
 *   - Supabase Auth → user resolution → service-client lookup chain
 *     stops returning rows
 *   - The route handler is no longer registered or returns the wrong
 *     error shape
 *
 * Shop context: the 404 path requires the request to carry a real
 * shop id (not the `"demo"` placeholder middleware injects when there
 * is no active shop). The route's first guard rejects `"demo"` with a
 * 401 SHOP_CONTEXT_REQUIRED, so we set the `dd_active_shop` cookie to
 * the test user's first connected shop before probing — that lets the
 * request reach the route's pack-lookup → 404 path. Without this, the
 * cross-shop-ownership filter (security commit 3e8317f, B4) short-
 * circuits before the lookup even runs.
 *
 * Deliberately out of scope (covered by save-to-shopify-seeded.spec.ts):
 *   - Seed a real `evidence_packs` row with status="ready" and assert
 *     202 + jobs.insert + pack flip to "saving".
 *   - The actual click-the-button browser test for /app/disputes/[id]
 *     — blocked on a Shopify test-mode session bridge (see plan §12).
 */

import { test, expect, type Page } from "@playwright/test";
import { openSb, getFirstShopIdForUser } from "./helpers/dbFixtures";

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Mirror of the portal-sections sign-in helper. We don't share the
 * function because that file's helper throws strings tailored to its
 * own assertions; copying it here keeps each spec independently
 * runnable and lets future contributors edit one without thinking
 * about the other.
 */
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
  await expect(emailInput).toHaveValue(E2E_EMAIL!, { timeout: 5_000 });

  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.click();
  await passwordInput.fill(E2E_PASSWORD!);
  await expect(passwordInput).toHaveValue(E2E_PASSWORD!, { timeout: 5_000 });

  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the redirect to a portal route — confirms cookies are set.
  await page.waitForURL(/\/portal\//, { timeout: 25_000 });
}

test.describe("POST /api/packs/:packId/save-to-shopify — route-level", () => {
  test.beforeEach(async () => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD,
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD required in .env.local",
    );
  });

  test("returns 404 with the documented error shape for an unknown pack", async ({ page, baseURL }) => {
    test.skip(
      !SB_URL || !SB_KEY,
      "404 path needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to look up the test user's shop",
    );

    // The route's first guard (security commit 3e8317f, B4) refuses
    // shopId === "demo" with 401 SHOP_CONTEXT_REQUIRED. Middleware's
    // portal fallback injects "demo" when no `dd_active_shop` cookie is
    // set, so we pre-resolve the test user's first connected shop and
    // plant the cookie before signing in. With a real shop id in the
    // x-shop-id header, the route reaches its pack lookup and returns
    // 404 for the unknown id.
    const conn = openSb();
    const realShopId = await getFirstShopIdForUser(conn, E2E_EMAIL!);

    const url = new URL(baseURL ?? "http://localhost:3000");
    await page.context().addCookies([
      {
        name: "dd_active_shop",
        value: realShopId,
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);

    await portalSignIn(page);

    // Random-but-well-formed UUID. The route looks up by id and returns
    // 404 when the row is missing — this exercises the middleware path,
    // route registration, and Supabase service-client read in one shot.
    const fakePackId = "00000000-0000-4000-8000-000000000000";

    const res = await page.request.post(
      `/api/packs/${fakePackId}/save-to-shopify`,
      {
        data: {},
        failOnStatusCode: false,
      },
    );

    expect(
      res.status(),
      `unexpected status ${res.status()} for unknown pack — ` +
        "middleware portal fallback or route handler regression?",
    ).toBe(404);

    const body = await res.json();
    expect(body).toMatchObject({ error: "Pack not found" });
  });

  test("rejects unauthenticated requests with 401", async ({ request, baseURL }) => {
    // Fresh APIRequestContext — no Supabase session cookie. Middleware
    // must reject this with SESSION_REQUIRED.
    const fakePackId = "00000000-0000-4000-8000-000000000001";
    const res = await request.post(
      `${baseURL}/api/packs/${fakePackId}/save-to-shopify`,
      {
        data: {},
        failOnStatusCode: false,
      },
    );

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: "SESSION_REQUIRED" });
  });
});
