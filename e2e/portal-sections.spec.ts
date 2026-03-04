import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;

async function portalSignIn(page: import("@playwright/test").Page) {
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

  const navOrError = await Promise.race([
    page.waitForURL(/\/portal\//, { timeout: 25_000 }).then(() => "portal" as const),
    page.getByTestId("sign-in-error").waitFor({ state: "visible", timeout: 15_000 }).then(() => "error" as const),
  ]).catch(() => null);

  if (navOrError === "error") {
    const errorText = await page.getByTestId("sign-in-error").first().textContent();
    throw new Error(`Sign-in failed: ${errorText?.trim() ?? "Unknown error"}. Check E2E_TEST_EMAIL, E2E_TEST_PASSWORD and Supabase (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).`);
  }
  if (navOrError !== "portal") {
    throw new Error(
      "Sign-in did not redirect to portal and no error was shown. " +
      "Ensure Supabase is configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local) and E2E_TEST_EMAIL / E2E_TEST_PASSWORD are valid."
    );
  }
}

/**
 * Portal sections that should load after sign-in.
 * Each path must render at least one h1 so we detect missing/broken sections.
 */
const PORTAL_SECTIONS: { path: string; name: string }[] = [
  { path: "/portal/dashboard", name: "Dashboard" },
  { path: "/portal/disputes", name: "Disputes" },
  { path: "/portal/packs", name: "Packs" },
  { path: "/portal/rules", name: "Rules" },
  { path: "/portal/policies", name: "Policies" },
  { path: "/portal/billing", name: "Billing" },
  { path: "/portal/team", name: "Team" },
  { path: "/portal/settings", name: "Settings" },
  { path: "/portal/help", name: "Help" },
  { path: "/portal/connect-shopify", name: "Connect Shopify" },
  { path: "/portal/select-store", name: "Select store" },
];

test.describe("Portal sections smoke", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD,
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD required in .env.local"
    );
    await portalSignIn(page);
  });

  for (const { path, name } of PORTAL_SECTIONS) {
    test(`${name} (${path}) loads and shows content`, async ({ page }) => {
      const res = await page.goto(path, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      expect(res?.status()).toBe(200);

      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));

      const heading = page.getByRole("heading", { level: 1 }).or(page.getByRole("heading", { level: 2 }));
      await expect(heading.first()).toBeVisible({ timeout: 10_000 });
    });
  }
});
